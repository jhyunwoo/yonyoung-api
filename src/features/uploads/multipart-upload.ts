import type { Context } from "hono";
import type { Actor } from "../../lib/authorization/types";
import type { AppDependencies } from "../../lib/services/dependencies";
import type { PresignService } from "../../lib/services/types";
import {
  UPLOAD_LIMITS,
  isNoSuchMultipartUploadError,
} from "../../lib/storage/presign";
import {
  MULTIPART_UPLOAD_EXPIRED_CLEANUP_LIMIT,
  MULTIPART_UPLOAD_STATE_TTL_MS,
  MultipartUploadLimitError,
  type MultipartUploadState,
  type MultipartUploadStateStore,
} from "../../lib/uploads/multipart-state";
import { AppError } from "../../shared/errors/AppError";
import type HonoAppType from "../../types/honoAppType";
import {
  releaseUploadReservation,
  settleUploadReservation,
  type ActiveUploadReservation,
} from "./upload-capacity";
import type { UploadResourcePath, UploadSlot } from "./upload.policy";

type RequestContext = Context<HonoAppType>;

const MULTIPART_SESSION_INVALID_MESSAGE =
  "멀티파트 업로드 세션이 유효하지 않거나 만료되었습니다.";

/**
 * 만료된 멀티파트 세션을 원격/로컬 양쪽에서 정리한다.
 * 원격 정리에 실패하면 로컬 상태를 남겨 다음 요청이 재시도하게 한다.
 */
const cleanupExpiredMultipartUploadsForActor = async (input: {
  stateStore: MultipartUploadStateStore;
  reservationStore: ReturnType<AppDependencies["getUploadReservationStore"]>;
  presignService: PresignService;
  actorId: string;
  now: number;
}): Promise<void> => {
  const expiredStates = await input.stateStore.listExpiredByActor(
    input.actorId,
    input.now,
    MULTIPART_UPLOAD_EXPIRED_CLEANUP_LIMIT,
  );

  for (const state of expiredStates) {
    try {
      let terminalStateIsAmbiguous = false;
      try {
        await input.presignService.abortMultipartUpload({
          uploadId: state.uploadId,
          objectKey: state.objectKey,
        });
      } catch (error) {
        if (!isNoSuchMultipartUploadError(error)) {
          throw error;
        }
        terminalStateIsAmbiguous = true;
      }
      await input.stateStore.remove(state.uploadId, state.objectKey);
      if (state.reservationId) {
        if (terminalStateIsAmbiguous) {
          await settleUploadReservation(
            input.reservationStore,
            state.reservationId,
          );
        } else {
          await input.reservationStore
            .remove(state.reservationId)
            .catch(() => undefined);
        }
      }
    } catch {
      // Keep local state when remote cleanup fails so a later request can retry.
    }
  }
};

/** 새 멀티파트 세션을 열기 전에 만료분을 청소하고 동시 세션 한도를 확인한다. */
export const assertMultipartCapacityAvailable = async (input: {
  c: RequestContext;
  dependencies: AppDependencies;
  actorId: string;
}): Promise<void> => {
  try {
    const stateStore = input.dependencies.getMultipartUploadStateStore(input.c);
    await cleanupExpiredMultipartUploadsForActor({
      stateStore,
      reservationStore: input.dependencies.getUploadReservationStore(input.c),
      presignService: input.dependencies.getPresignService(input.c),
      actorId: input.actorId,
      now: Date.now(),
    });
    await stateStore.assertActorCapacity(input.actorId, Date.now());
  } catch (error) {
    if (error instanceof MultipartUploadLimitError) {
      throw AppError.conflict(error.message);
    }
    throw AppError.internalWithReason(
      "멀티파트 업로드 상태를 확인할 수 없어 업로드를 차단했습니다.",
    );
  }
};

/**
 * 원격 멀티파트 업로드를 열고 로컬 상태와 짝을 맞춘다.
 * 어느 단계에서 실패하든 원격 업로드와 용량 예약이 고아로 남지 않게 되돌린다.
 */
export const initiateTrackedMultipartUpload = async (input: {
  c: RequestContext;
  dependencies: AppDependencies;
  actorId: string;
  upload: {
    resource: UploadResourcePath;
    slot: UploadSlot;
    fileName: string;
    contentType: string;
    fileSize: number;
  };
  expectedPartCount: number;
  reservation: ActiveUploadReservation;
}) => {
  const stateStore = input.dependencies.getMultipartUploadStateStore(input.c);
  const presignService = input.dependencies.getPresignService(input.c);
  const now = Date.now();
  try {
    const data = await presignService.initiateMultipartUpload({
      actorId: input.actorId,
      ...input.upload,
    });

    try {
      await stateStore.reserve({
        uploadId: data.uploadId,
        objectKey: data.objectKey,
        reservationId: input.reservation.id,
        actorId: input.actorId,
        contentType: input.upload.contentType,
        fileSize: input.upload.fileSize,
        partSize: UPLOAD_LIMITS.multipartPartSizeBytes,
        maxPartNumber: input.expectedPartCount,
        expiresAt: now + MULTIPART_UPLOAD_STATE_TTL_MS,
      });
    } catch (error) {
      try {
        await presignService.abortMultipartUpload({
          uploadId: data.uploadId,
          objectKey: data.objectKey,
        });
      } catch {
        // State reservation failed, so the remote upload is cleaned up best-effort.
      }
      throw error;
    }

    return data;
  } catch (error) {
    await releaseUploadReservation(input.reservation);
    throw error;
  }
};

export type ActiveMultipartSession = {
  state: MultipartUploadState;
  stateStore: MultipartUploadStateStore;
};

/**
 * 멀티파트 후속 요청이 참조하는 세션을 확인한다.
 * 만료된 세션은 여기서 정리한 뒤 "유효하지 않음"으로 응답한다.
 */
export const requireActiveMultipartSession = async (input: {
  c: RequestContext;
  dependencies: AppDependencies;
  actor: Pick<Actor, "id">;
  uploadId: string;
  objectKey: string;
}): Promise<ActiveMultipartSession> => {
  const stateStore = input.dependencies.getMultipartUploadStateStore(input.c);
  const state = await stateStore.get(input.uploadId, input.objectKey);
  if (!state) {
    throw AppError.badRequest(MULTIPART_SESSION_INVALID_MESSAGE);
  }

  if (state.actorId !== input.actor.id) {
    throw AppError.forbidden("본인 소유 업로드만 처리할 수 있습니다.");
  }

  if (state.expiresAt <= Date.now()) {
    let remoteAbortSucceeded = false;
    let terminalStateIsAmbiguous = false;
    try {
      try {
        await input.dependencies
          .getPresignService(input.c)
          .abortMultipartUpload({
            uploadId: input.uploadId,
            objectKey: input.objectKey,
          });
      } catch (error) {
        if (!isNoSuchMultipartUploadError(error)) {
          throw error;
        }
        terminalStateIsAmbiguous = true;
      }
      remoteAbortSucceeded = true;
    } catch {
      // Keep local state so a later request can retry remote cleanup.
    }
    if (remoteAbortSucceeded) {
      await stateStore.remove(input.uploadId, input.objectKey);
      if (state.reservationId) {
        const reservationStore = input.dependencies.getUploadReservationStore(
          input.c,
        );
        if (terminalStateIsAmbiguous) {
          await settleUploadReservation(
            reservationStore,
            state.reservationId,
            input.c,
          );
        } else {
          await reservationStore
            .remove(state.reservationId)
            .catch(() => undefined);
        }
      }
    }
    throw AppError.badRequest(MULTIPART_SESSION_INVALID_MESSAGE);
  }

  return { state, stateStore };
};
