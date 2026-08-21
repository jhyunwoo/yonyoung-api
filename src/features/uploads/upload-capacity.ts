import type { Context } from "hono";
import type { AppDependencies } from "../../lib/services/dependencies";
import { PRESIGNED_URL_EXPIRES_IN_SECONDS } from "../../lib/storage/presign";
import { invalidateR2UsageCache } from "../../lib/storage/usage";
import {
  UPLOAD_RESERVATION_OBSERVATION_MAX_AGE_MS,
  UPLOAD_RESERVATION_SETTLEMENT_GRACE_MS,
  UploadReservationLimitError,
  UploadStorageCapacityError,
  type UploadReservationStore,
} from "../../lib/uploads/upload-reservation";
import { AppError } from "../../shared/errors/AppError";
import type HonoAppType from "../../types/honoAppType";

type RequestContext = Context<HonoAppType>;

// Direct PUT has no application completion callback, so retain its capacity
// substantially longer than the one-hour signature. Incomplete R2 multipart
// uploads are retained for seven days by default; keep their reservation for
// an extra day unless an explicit abort/completion releases it first.
export const SINGLE_UPLOAD_CAPACITY_RESERVATION_TTL_MS = 24 * 60 * 60 * 1000;
export const MULTIPART_UPLOAD_CAPACITY_RESERVATION_TTL_MS =
  8 * 24 * 60 * 60 * 1000;
export const SINGLE_UPLOAD_GRANT_TTL_MS =
  PRESIGNED_URL_EXPIRES_IN_SECONDS * 1000;

export type ActiveUploadReservation = {
  id: string;
  store: UploadReservationStore;
};

export const resolveWaitUntil = (
  c: RequestContext,
): ((promise: Promise<unknown>) => void) | undefined => {
  try {
    const executionCtx = c.executionCtx;
    return executionCtx?.waitUntil?.bind(executionCtx);
  } catch {
    return undefined;
  }
};

/**
 * 업로드 URL을 내주기 전에 버킷 용량을 선점한다. 용량 상태를 확신할 수 없으면
 * 업로드를 허용하지 않는다(fail-closed) — 한도를 넘긴 채로 발급하면 되돌릴 방법이 없다.
 */
export const reserveStorageCapacityForUpload = async (input: {
  c: RequestContext;
  dependencies: AppDependencies;
  actorId: string;
  fileSize: number;
  grantTtlMs: number;
  capacityTtlMs: number;
}): Promise<ActiveUploadReservation> => {
  let store: UploadReservationStore;
  try {
    store = input.dependencies.getUploadReservationStore(input.c);
    await store.assertActorCapacity(input.actorId, input.fileSize, Date.now());
  } catch (error) {
    if (error instanceof UploadReservationLimitError) {
      throw AppError.conflict(error.message);
    }
    throw AppError.internalWithReason(
      "업로드 용량 예약 상태를 확인할 수 없어 업로드를 차단했습니다.",
    );
  }

  let observedUsedBytes: number;
  let observedAt: number;
  try {
    const usageScan = await input.dependencies.readR2TotalUsageBytes(input.c);
    // 부분 스캔 합계는 실제 사용량의 하한값이므로 한도 판정에 쓸 수 없다.
    if (!usageScan.complete) {
      throw AppError.internalWithReason(
        "버킷 저장공간 사용량을 모두 확인하지 못해 업로드를 차단했습니다.",
      );
    }
    observedUsedBytes = usageScan.totalUsageBytes;
    // 사용량은 캐시를 거쳐 올 수 있다. 요청 시각을 관측 시각으로 기록하면 D1 신선도
    // 트리거가 항상 통과해, 오래된 수치로 10GB 한도를 판정하게 된다.
    observedAt = usageScan.observedAt;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw AppError.internalWithReason(
      "버킷 저장공간 사용량을 확인할 수 없어 업로드를 차단했습니다.",
    );
  }

  if (!Number.isSafeInteger(observedUsedBytes) || observedUsedBytes < 0) {
    throw AppError.internalWithReason(
      "버킷 저장공간 사용량 응답이 올바르지 않아 업로드를 차단했습니다.",
    );
  }
  if (
    !Number.isFinite(observedAt) ||
    observedAt > Date.now() + 5_000 ||
    Date.now() - observedAt > UPLOAD_RESERVATION_OBSERVATION_MAX_AGE_MS
  ) {
    throw AppError.internalWithReason(
      "버킷 저장공간 확인 시간이 초과되어 업로드를 차단했습니다.",
    );
  }

  const id = crypto.randomUUID();
  const now = Date.now();
  try {
    await store.reserve({
      id,
      actorId: input.actorId,
      fileSize: input.fileSize,
      observedUsedBytes,
      observedAt,
      grantExpiresAt: now + input.grantTtlMs,
      expiresAt: now + input.capacityTtlMs,
    });
    return { id, store };
  } catch (error) {
    if (error instanceof UploadReservationLimitError) {
      throw AppError.conflict(error.message);
    }
    if (error instanceof UploadStorageCapacityError) {
      throw AppError.payloadTooLarge(error.message);
    }
    throw AppError.internalWithReason(
      "업로드 용량 예약을 생성할 수 없어 업로드를 차단했습니다.",
    );
  }
};

export const releaseUploadReservation = async (
  reservation: ActiveUploadReservation,
): Promise<void> => {
  await reservation.store.remove(reservation.id).catch(() => undefined);
};

export const settleUploadReservation = async (
  store: UploadReservationStore,
  reservationId: string,
  c?: RequestContext,
): Promise<void> => {
  await store
    .settle(reservationId, Date.now() + UPLOAD_RESERVATION_SETTLEMENT_GRACE_MS)
    .catch(() => undefined);

  // 정산은 업로드가 실제로 용량을 소비했다는 뜻이므로 캐시된 사용량을 버린다.
  // 캐시 무효화 실패가 정산 응답을 깨뜨려서는 안 된다.
  if (c) {
    try {
      await invalidateR2UsageCache({
        bucketName: c.env?.R2_BUCKET,
        waitUntil: resolveWaitUntil(c),
      });
    } catch {
      // 무시한다.
    }
  }
};
