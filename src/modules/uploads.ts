import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import type HonoAppType from "../types/honoAppType";
import {
  badRequest,
  conflict,
  forbidden,
  internalError,
  noContent,
  ok,
  payloadTooLarge,
  unprocessableEntity,
  unsupportedMediaType,
} from "../lib/http/response";
import { parseBody } from "../lib/validation/request";
import type { AppDependencies } from "../lib/services/dependencies";
import type { PresignService } from "../lib/services/types";
import { requireActor } from "../lib/http/authz";
import { can, isMemberLikeRole } from "../lib/authorization/policy";
import type { Actor, Resource, Role } from "../lib/authorization/types";
import { MissingStorageConfigError } from "../lib/storage/presign";
import { invalidateR2UsageCache } from "../lib/storage/usage";
import {
  createdResponse,
  dataResponse,
  errorResponses,
  jsonBody,
  noContentResponse,
} from "../lib/openapi/responses";
import {
  ApiMultipartUploadAbortRequestSchema,
  ApiMultipartUploadCompleteRequestSchema,
  ApiMultipartUploadCompleteResponseSchema,
  ApiMultipartUploadInitRequestSchema,
  ApiMultipartUploadInitResponseSchema,
  ApiMultipartUploadPartRequestSchema,
  ApiMultipartUploadPartResponseSchema,
  ApiPresignRequestSchema,
  ApiPresignResponseSchema,
} from "../lib/openapi/schemas";
import {
  ALLOWED_ATTACHMENT_CONTENT_TYPES,
  ALLOWED_IMAGE_CONTENT_TYPES,
  UPLOAD_LIMITS,
  PRESIGNED_URL_EXPIRES_IN_SECONDS,
  isNoSuchMultipartUploadError,
  parseManagedObjectKey,
} from "../lib/storage/presign";
import type { ManagedUploadResourcePath, ManagedUploadSlot } from "../lib/storage/presign";
import {
  MULTIPART_UPLOAD_EXPIRED_CLEANUP_LIMIT,
  MULTIPART_UPLOAD_STATE_TTL_MS,
  MultipartUploadLimitError,
  type MultipartUploadState,
  type MultipartUploadStateStore,
} from "../lib/uploads/multipart-state";
import {
  UPLOAD_RESERVATION_OBSERVATION_MAX_AGE_MS,
  UPLOAD_RESERVATION_SETTLEMENT_GRACE_MS,
  UploadReservationLimitError,
  UploadStorageCapacityError,
  type UploadReservationStore,
} from "../lib/uploads/upload-reservation";

type App = OpenAPIHono<HonoAppType>;
type ManagedResource = Extract<
  Resource,
  "activity" | "exhibition" | "site_setting"
>;
type UploadResourcePath = ManagedUploadResourcePath;
type UploadSlot = ManagedUploadSlot;

// Direct PUT has no application completion callback, so retain its capacity
// substantially longer than the one-hour signature. Incomplete R2 multipart
// uploads are retained for seven days by default; keep their reservation for
// an extra day unless an explicit abort/completion releases it first.
const SINGLE_UPLOAD_CAPACITY_RESERVATION_TTL_MS = 24 * 60 * 60 * 1000;
const MULTIPART_UPLOAD_CAPACITY_RESERVATION_TTL_MS = 8 * 24 * 60 * 60 * 1000;
const SINGLE_UPLOAD_GRANT_TTL_MS = PRESIGNED_URL_EXPIRES_IN_SECONDS * 1000;

const canCreateOrUpdate = (role: Role, resource: Resource) => {
  return can(role, resource, "create") || can(role, resource, "update");
};

const resourceByPath: Record<UploadResourcePath, Resource | "user"> = {
  activities: "activity",
  exhibitions: "exhibition",
  users: "user",
  // notices 경로는 모집(recruiting) 이미지와 레거시 공지 이미지가 사용한다
  notices: "site_setting",
  site: "site_setting",
};

const validateUploadPayload = (
  input: { contentType: string; fileSize: number },
  options: {
    maxFileSizeBytes: number;
    allowedContentTypes?: readonly string[];
  },
): { code: "unsupported_type" | "too_large"; message: string } | null => {
  const allowedContentTypes =
    options.allowedContentTypes ?? ALLOWED_IMAGE_CONTENT_TYPES;
  if (!allowedContentTypes.includes(input.contentType)) {
    return {
      code: "unsupported_type",
      message: `지원하지 않는 파일 형식입니다. (${allowedContentTypes.join(", ")})`,
    };
  }

  if (input.fileSize > options.maxFileSizeBytes) {
    return {
      code: "too_large",
      message: `업로드 최대 크기(${options.maxFileSizeBytes} bytes)를 초과했습니다.`,
    };
  }

  return null;
};

const readUploadValidationResponse = (
  c: Parameters<typeof badRequest>[0],
  validationResult: ReturnType<typeof validateUploadPayload>,
): Response | null => {
  if (!validationResult) {
    return null;
  }

  if (validationResult.code === "unsupported_type") {
    return unsupportedMediaType(c, validationResult.message);
  }

  return payloadTooLarge(c, validationResult.message);
};

type ActiveUploadReservation = {
  id: string;
  store: UploadReservationStore;
};

type UploadReservationResult =
  | { reservation: ActiveUploadReservation; response?: never }
  | { response: Response; reservation?: never };

const reserveStorageCapacityBeforeUpload = async (input: {
  c: Parameters<typeof badRequest>[0];
  dependencies: AppDependencies;
  actorId: string;
  fileSize: number;
  grantTtlMs: number;
  capacityTtlMs: number;
}): Promise<UploadReservationResult> => {
  let store: UploadReservationStore;
  try {
    store = input.dependencies.getUploadReservationStore(input.c);
    await store.assertActorCapacity(input.actorId, input.fileSize, Date.now());
  } catch (error) {
    if (error instanceof UploadReservationLimitError) {
      return { response: conflict(input.c, error.message) };
    }
    return {
      response: internalError(
        input.c,
        "업로드 용량 예약 상태를 확인할 수 없어 업로드를 차단했습니다.",
      ),
    };
  }

  const observedAt = Date.now();
  let observedUsedBytes: number;
  try {
    const usageScan = await input.dependencies.readR2TotalUsageBytes(input.c);
    // 부분 스캔 합계는 실제 사용량의 하한값이므로 한도 판정에 쓸 수 없다.
    if (!usageScan.complete) {
      return {
        response: internalError(
          input.c,
          "버킷 저장공간 사용량을 모두 확인하지 못해 업로드를 차단했습니다.",
        ),
      };
    }
    observedUsedBytes = usageScan.totalUsageBytes;
  } catch {
    return {
      response: internalError(
        input.c,
        "버킷 저장공간 사용량을 확인할 수 없어 업로드를 차단했습니다.",
      ),
    };
  }
  if (!Number.isSafeInteger(observedUsedBytes) || observedUsedBytes < 0) {
    return {
      response: internalError(
        input.c,
        "버킷 저장공간 사용량 응답이 올바르지 않아 업로드를 차단했습니다.",
      ),
    };
  }
  if (Date.now() - observedAt > UPLOAD_RESERVATION_OBSERVATION_MAX_AGE_MS) {
    return {
      response: internalError(
        input.c,
        "버킷 저장공간 확인 시간이 초과되어 업로드를 차단했습니다.",
      ),
    };
  }

  const id = crypto.randomUUID();
  const now = Date.now();
  const grantExpiresAt = now + input.grantTtlMs;
  const expiresAt = now + input.capacityTtlMs;
  try {
    await store.reserve({
      id,
      actorId: input.actorId,
      fileSize: input.fileSize,
      observedUsedBytes,
      observedAt,
      grantExpiresAt,
      expiresAt,
    });
    return { reservation: { id, store } };
  } catch (error) {
    if (error instanceof UploadReservationLimitError) {
      return { response: conflict(input.c, error.message) };
    }
    if (error instanceof UploadStorageCapacityError) {
      return { response: payloadTooLarge(input.c, error.message) };
    }
    return {
      response: internalError(
        input.c,
        "업로드 용량 예약을 생성할 수 없어 업로드를 차단했습니다.",
      ),
    };
  }
};

const releaseUploadReservation = async (
  reservation: ActiveUploadReservation,
): Promise<void> => {
  await reservation.store.remove(reservation.id).catch(() => undefined);
};

const settleUploadReservation = async (
  store: UploadReservationStore,
  reservationId: string,
  c?: Parameters<typeof badRequest>[0],
): Promise<void> => {
  await store
    .settle(
      reservationId,
      Date.now() + UPLOAD_RESERVATION_SETTLEMENT_GRACE_MS,
    )
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

const resolveWaitUntil = (
  c: Parameters<typeof badRequest>[0],
): ((promise: Promise<unknown>) => void) | undefined => {
  try {
    const executionCtx = c.executionCtx;
    return executionCtx?.waitUntil?.bind(executionCtx);
  } catch {
    return undefined;
  }
};

const isUserProfileUploadAllowed = (role: Role): boolean => {
  return can(role, "user", "update") || isMemberLikeRole(role);
};

const ensureMultipartOwnership = (input: {
  actor: Pick<Actor, "id" | "role">;
  objectKey: string;
  c: Parameters<typeof badRequest>[0];
}): Response | null => {
  const parsed = parseManagedObjectKey(input.objectKey);
  if (!parsed) {
    return badRequest(input.c, "objectKey 형식이 올바르지 않습니다.");
  }

  if (parsed.actorId !== input.actor.id) {
    return forbidden(input.c, "본인 소유 업로드만 처리할 수 있습니다.");
  }

  const mappedResource = resourceByPath[parsed.resourcePath];
  if (mappedResource === "user") {
    if (!isUserProfileUploadAllowed(input.actor.role)) {
      return forbidden(input.c);
    }
    return null;
  }

  if (!canCreateOrUpdate(input.actor.role, mappedResource)) {
    return forbidden(input.c);
  }

  return null;
};

const cleanupExpiredMultipartUploadsForActor = async (input: {
  stateStore: MultipartUploadStateStore;
  reservationStore: UploadReservationStore;
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

const prepareMultipartUploadForReservation = async (input: {
  c: Parameters<typeof badRequest>[0];
  dependencies: AppDependencies;
  actorId: string;
}): Promise<Response | null> => {
  try {
    const stateStore = input.dependencies.getMultipartUploadStateStore(input.c);
    await cleanupExpiredMultipartUploadsForActor({
      stateStore,
      reservationStore:
        input.dependencies.getUploadReservationStore(input.c),
      presignService: input.dependencies.getPresignService(input.c),
      actorId: input.actorId,
      now: Date.now(),
    });
    await stateStore.assertActorCapacity(input.actorId, Date.now());
    return null;
  } catch (error) {
    if (error instanceof MultipartUploadLimitError) {
      return conflict(input.c, error.message);
    }
    return internalError(
      input.c,
      "멀티파트 업로드 상태를 확인할 수 없어 업로드를 차단했습니다.",
    );
  }
};

const initiateTrackedMultipartUpload = async (input: {
  c: Parameters<typeof badRequest>[0];
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

type ActiveMultipartStateResult =
  | {
      state: MultipartUploadState;
      stateStore: MultipartUploadStateStore;
      response?: never;
    }
  | {
      response: Response;
      state?: never;
      stateStore?: never;
    };

const readActiveMultipartState = async (input: {
  c: Parameters<typeof badRequest>[0];
  dependencies: AppDependencies;
  actor: Pick<Actor, "id">;
  uploadId: string;
  objectKey: string;
}): Promise<ActiveMultipartStateResult> => {
  const stateStore = input.dependencies.getMultipartUploadStateStore(input.c);
  const state = await stateStore.get(input.uploadId, input.objectKey);
  if (!state) {
    return {
      response: badRequest(
        input.c,
        "멀티파트 업로드 세션이 유효하지 않거나 만료되었습니다.",
      ),
    };
  }

  if (state.actorId !== input.actor.id) {
    return {
      response: forbidden(input.c, "본인 소유 업로드만 처리할 수 있습니다."),
    };
  }

  if (state.expiresAt <= Date.now()) {
    let remoteAbortSucceeded = false;
    let terminalStateIsAmbiguous = false;
    try {
      try {
        await input.dependencies.getPresignService(input.c).abortMultipartUpload({
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
        const reservationStore =
          input.dependencies.getUploadReservationStore(input.c);
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
    return {
      response: badRequest(
        input.c,
        "멀티파트 업로드 세션이 유효하지 않거나 만료되었습니다.",
      ),
    };
  }

  return { state, stateStore };
};

type ResourcePresignRouteOptions = {
  routePath: string;
  operationId: string;
  // 권한 판정에 사용할 정책 리소스
  resource: ManagedResource;
  // R2 objectKey의 최상위 경로
  uploadResourcePath: UploadResourcePath;
  slot: Exclude<UploadSlot, "profile">;
  // 생략 시 이미지 형식만 허용
  allowedContentTypes?: readonly string[];
};

const registerResourcePresignRoute = (
  app: App,
  dependencies: AppDependencies,
  options: ResourcePresignRouteOptions,
) => {
  const route = createRoute({
    method: "post",
    path: options.routePath,
    tags: ["Uploads"],
    operationId: options.operationId,
    security: [{ cookieAuth: [] }],
    request: {
      body: jsonBody(ApiPresignRequestSchema, "Presigned URL 발급 요청"),
    },
    responses: {
      201: createdResponse(ApiPresignResponseSchema, "Presigned URL 발급 성공"),
      400: errorResponses[400],
      401: errorResponses[401],
      403: errorResponses[403],
      409: errorResponses[409],
      413: errorResponses[413],
      415: errorResponses[415],
      500: errorResponses[500],
    },
  });

  app.openapi(route, async (c): Promise<any> => {
    const actorResult = await requireActor(c, dependencies);
    if ("response" in actorResult) {
      return actorResult.response;
    }

    if (!canCreateOrUpdate(actorResult.actor.role, options.resource)) {
      return forbidden(c);
    }

    const body = await parseBody(c, ApiPresignRequestSchema);
    if (!body.success) {
      return badRequest(c, body.message);
    }

    const validation = validateUploadPayload(body.data, {
      maxFileSizeBytes: UPLOAD_LIMITS.maxSinglePartBytes,
      allowedContentTypes: options.allowedContentTypes,
    });
    const validationResponse = readUploadValidationResponse(c, validation);
    if (validationResponse) {
      return validationResponse;
    }

    const reservationResult = await reserveStorageCapacityBeforeUpload({
      c,
      dependencies,
      actorId: actorResult.actor.id,
      fileSize: body.data.fileSize,
      grantTtlMs: SINGLE_UPLOAD_GRANT_TTL_MS,
      capacityTtlMs: SINGLE_UPLOAD_CAPACITY_RESERVATION_TTL_MS,
    });
    if (reservationResult.response) {
      return reservationResult.response;
    }

    try {
      const data = await dependencies.getPresignService(c).issuePresignedPutUrl({
        actorId: actorResult.actor.id,
        resource: options.uploadResourcePath,
        slot: options.slot,
        fileName: body.data.fileName,
        contentType: body.data.contentType,
        fileSize: body.data.fileSize,
      });
      return ok(c, data, 201);
    } catch (error) {
      await releaseUploadReservation(reservationResult.reservation);
      if (error instanceof MissingStorageConfigError) {
        return internalError(
          c,
          "업로드 스토리지 설정이 누락되었습니다. R2_* 환경변수와 공개 URL 서명 시크릿을 확인해 주세요.",
        );
      }
      return internalError(c, "업로드 URL 발급에 실패했습니다.");
    }
  });
};

const registerResourceMultipartInitRoute = (
  app: App,
  dependencies: AppDependencies,
  options: ResourcePresignRouteOptions,
) => {
  const route = createRoute({
    method: "post",
    path: options.routePath,
    tags: ["Uploads"],
    operationId: options.operationId,
    security: [{ cookieAuth: [] }],
    request: {
      body: jsonBody(
        ApiMultipartUploadInitRequestSchema,
        "멀티파트 업로드 초기화 요청",
      ),
    },
    responses: {
      201: createdResponse(
        ApiMultipartUploadInitResponseSchema,
        "멀티파트 업로드 초기화 성공",
      ),
      400: errorResponses[400],
      401: errorResponses[401],
      403: errorResponses[403],
      409: errorResponses[409],
      413: errorResponses[413],
      415: errorResponses[415],
      500: errorResponses[500],
    },
  });

  app.openapi(route, async (c): Promise<any> => {
    const actorResult = await requireActor(c, dependencies);
    if ("response" in actorResult) {
      return actorResult.response;
    }

    if (!canCreateOrUpdate(actorResult.actor.role, options.resource)) {
      return forbidden(c);
    }

    const body = await parseBody(c, ApiMultipartUploadInitRequestSchema);
    if (!body.success) {
      return badRequest(c, body.message);
    }

    const validation = validateUploadPayload(body.data, {
      maxFileSizeBytes: UPLOAD_LIMITS.maxMultipartBytes,
      allowedContentTypes: options.allowedContentTypes,
    });
    const validationResponse = readUploadValidationResponse(c, validation);
    if (validationResponse) {
      return validationResponse;
    }

    const expectedPartCount = Math.ceil(
      body.data.fileSize / UPLOAD_LIMITS.multipartPartSizeBytes,
    );
    if (expectedPartCount > UPLOAD_LIMITS.multipartMaxParts) {
      return payloadTooLarge(
        c,
        `파트 수가 허용 범위(${UPLOAD_LIMITS.multipartMaxParts})를 초과합니다.`,
      );
    }

    const preparationResponse = await prepareMultipartUploadForReservation({
      c,
      dependencies,
      actorId: actorResult.actor.id,
    });
    if (preparationResponse) {
      return preparationResponse;
    }

    const reservationResult = await reserveStorageCapacityBeforeUpload({
      c,
      dependencies,
      actorId: actorResult.actor.id,
      fileSize: body.data.fileSize,
      grantTtlMs: MULTIPART_UPLOAD_STATE_TTL_MS,
      capacityTtlMs: MULTIPART_UPLOAD_CAPACITY_RESERVATION_TTL_MS,
    });
    if (reservationResult.response) {
      return reservationResult.response;
    }

    try {
      const data = await initiateTrackedMultipartUpload({
        c,
        dependencies,
        actorId: actorResult.actor.id,
        upload: {
          resource: options.uploadResourcePath,
          slot: options.slot,
          fileName: body.data.fileName,
          contentType: body.data.contentType,
          fileSize: body.data.fileSize,
        },
        expectedPartCount,
        reservation: reservationResult.reservation,
      });
      return ok(c, data, 201);
    } catch (error) {
      if (error instanceof MultipartUploadLimitError) {
        return conflict(c, error.message);
      }
      if (error instanceof MissingStorageConfigError) {
        return internalError(
          c,
          "업로드 스토리지 설정이 누락되었습니다. R2_* 환경변수와 공개 URL 서명 시크릿을 확인해 주세요.",
        );
      }
      return internalError(c, "멀티파트 업로드 초기화에 실패했습니다.");
    }
  });
};

const userProfilePresignRoute = createRoute({
  method: "post",
  path: "/api/users/presign/profile",
  tags: ["Uploads"],
  operationId: "issueUserProfilePresign",
  security: [{ cookieAuth: [] }],
  request: {
    body: jsonBody(ApiPresignRequestSchema, "프로필 업로드 Presigned URL 발급 요청"),
  },
  responses: {
    201: createdResponse(ApiPresignResponseSchema, "Presigned URL 발급 성공"),
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    409: errorResponses[409],
    413: errorResponses[413],
    415: errorResponses[415],
    500: errorResponses[500],
  },
});

const userProfileMultipartInitRoute = createRoute({
  method: "post",
  path: "/api/users/multipart/profile/init",
  tags: ["Uploads"],
  operationId: "initUserProfileMultipartUpload",
  security: [{ cookieAuth: [] }],
  request: {
    body: jsonBody(
      ApiMultipartUploadInitRequestSchema,
      "프로필 멀티파트 업로드 초기화 요청",
    ),
  },
  responses: {
    201: createdResponse(
      ApiMultipartUploadInitResponseSchema,
      "멀티파트 업로드 초기화 성공",
    ),
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    409: errorResponses[409],
    413: errorResponses[413],
    415: errorResponses[415],
    500: errorResponses[500],
  },
});

const multipartPartRoute = createRoute({
  method: "post",
  path: "/api/uploads/multipart/part",
  tags: ["Uploads"],
  operationId: "issueMultipartUploadPartPresign",
  security: [{ cookieAuth: [] }],
  request: {
    body: jsonBody(
      ApiMultipartUploadPartRequestSchema,
      "멀티파트 개별 파트 presigned URL 발급 요청",
    ),
  },
  responses: {
    200: dataResponse(
      ApiMultipartUploadPartResponseSchema,
      "파트 업로드 URL 발급 성공",
    ),
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    422: errorResponses[422],
    500: errorResponses[500],
  },
});

const multipartCompleteRoute = createRoute({
  method: "post",
  path: "/api/uploads/multipart/complete",
  tags: ["Uploads"],
  operationId: "completeMultipartUpload",
  security: [{ cookieAuth: [] }],
  request: {
    body: jsonBody(
      ApiMultipartUploadCompleteRequestSchema,
      "멀티파트 업로드 완료 요청",
    ),
  },
  responses: {
    200: dataResponse(
      ApiMultipartUploadCompleteResponseSchema,
      "멀티파트 업로드 완료 성공",
    ),
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    422: errorResponses[422],
    500: errorResponses[500],
  },
});

const multipartAbortRoute = createRoute({
  method: "post",
  path: "/api/uploads/multipart/abort",
  tags: ["Uploads"],
  operationId: "abortMultipartUpload",
  security: [{ cookieAuth: [] }],
  request: {
    body: jsonBody(
      ApiMultipartUploadAbortRequestSchema,
      "멀티파트 업로드 중단 요청",
    ),
  },
  responses: {
    204: noContentResponse,
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    500: errorResponses[500],
  },
});

export const registerUploadRoutes = (
  app: App,
  dependencies: AppDependencies,
) => {
  registerResourcePresignRoute(app, dependencies, {
    routePath: "/api/activities/presign/cover",
    operationId: "issueActivityCoverPresign",
    resource: "activity",
    uploadResourcePath: "activities",
    slot: "cover",
  });
  registerResourcePresignRoute(app, dependencies, {
    routePath: "/api/activities/presign/detail",
    operationId: "issueActivityDetailPresign",
    resource: "activity",
    uploadResourcePath: "activities",
    slot: "detail",
  });
  registerResourcePresignRoute(app, dependencies, {
    routePath: "/api/exhibitions/presign/cover",
    operationId: "issueExhibitionCoverPresign",
    resource: "exhibition",
    uploadResourcePath: "exhibitions",
    slot: "cover",
  });
  registerResourcePresignRoute(app, dependencies, {
    routePath: "/api/exhibitions/presign/detail",
    operationId: "issueExhibitionDetailPresign",
    resource: "exhibition",
    uploadResourcePath: "exhibitions",
    slot: "detail",
  });
  registerResourcePresignRoute(app, dependencies, {
    routePath: "/api/recruiting/presign/image",
    operationId: "issueRecruitingImagePresign",
    // 모집 계획 관리(회장/부회장)와 동일한 권한을 요구한다
    resource: "site_setting",
    uploadResourcePath: "notices",
    slot: "image",
  });
  registerResourcePresignRoute(app, dependencies, {
    routePath: "/api/activities/presign/file",
    operationId: "issueActivityFilePresign",
    resource: "activity",
    uploadResourcePath: "activities",
    slot: "file",
    allowedContentTypes: ALLOWED_ATTACHMENT_CONTENT_TYPES,
  });
  registerResourcePresignRoute(app, dependencies, {
    routePath: "/api/site/presign/file",
    operationId: "issueSiteFilePresign",
    resource: "site_setting",
    uploadResourcePath: "site",
    slot: "file",
    allowedContentTypes: ALLOWED_ATTACHMENT_CONTENT_TYPES,
  });

  registerResourceMultipartInitRoute(app, dependencies, {
    routePath: "/api/activities/multipart/cover/init",
    operationId: "initActivityCoverMultipartUpload",
    resource: "activity",
    uploadResourcePath: "activities",
    slot: "cover",
  });
  registerResourceMultipartInitRoute(app, dependencies, {
    routePath: "/api/activities/multipart/detail/init",
    operationId: "initActivityDetailMultipartUpload",
    resource: "activity",
    uploadResourcePath: "activities",
    slot: "detail",
  });
  registerResourceMultipartInitRoute(app, dependencies, {
    routePath: "/api/exhibitions/multipart/cover/init",
    operationId: "initExhibitionCoverMultipartUpload",
    resource: "exhibition",
    uploadResourcePath: "exhibitions",
    slot: "cover",
  });
  registerResourceMultipartInitRoute(app, dependencies, {
    routePath: "/api/exhibitions/multipart/detail/init",
    operationId: "initExhibitionDetailMultipartUpload",
    resource: "exhibition",
    uploadResourcePath: "exhibitions",
    slot: "detail",
  });

  app.openapi(userProfilePresignRoute, async (c): Promise<any> => {
    const actorResult = await requireActor(c, dependencies);
    if ("response" in actorResult) {
      return actorResult.response;
    }

    if (!isUserProfileUploadAllowed(actorResult.actor.role)) {
      return forbidden(c);
    }

    const body = await parseBody(c, ApiPresignRequestSchema);
    if (!body.success) {
      return badRequest(c, body.message);
    }

    const validation = validateUploadPayload(body.data, {
      maxFileSizeBytes: UPLOAD_LIMITS.maxSinglePartBytes,
    });
    const validationResponse = readUploadValidationResponse(c, validation);
    if (validationResponse) {
      return validationResponse;
    }

    const reservationResult = await reserveStorageCapacityBeforeUpload({
      c,
      dependencies,
      actorId: actorResult.actor.id,
      fileSize: body.data.fileSize,
      grantTtlMs: SINGLE_UPLOAD_GRANT_TTL_MS,
      capacityTtlMs: SINGLE_UPLOAD_CAPACITY_RESERVATION_TTL_MS,
    });
    if (reservationResult.response) {
      return reservationResult.response;
    }

    try {
      const data = await dependencies.getPresignService(c).issuePresignedPutUrl({
        actorId: actorResult.actor.id,
        resource: "users",
        slot: "profile",
        fileName: body.data.fileName,
        contentType: body.data.contentType,
        fileSize: body.data.fileSize,
      });
      return ok(c, data, 201);
    } catch (error) {
      await releaseUploadReservation(reservationResult.reservation);
      if (error instanceof MissingStorageConfigError) {
        return internalError(
          c,
          "업로드 스토리지 설정이 누락되었습니다. R2_* 환경변수와 공개 URL 서명 시크릿을 확인해 주세요.",
        );
      }
      return internalError(c, "업로드 URL 발급에 실패했습니다.");
    }
  });

  app.openapi(userProfileMultipartInitRoute, async (c): Promise<any> => {
    const actorResult = await requireActor(c, dependencies);
    if ("response" in actorResult) {
      return actorResult.response;
    }

    if (!isUserProfileUploadAllowed(actorResult.actor.role)) {
      return forbidden(c);
    }

    const body = await parseBody(c, ApiMultipartUploadInitRequestSchema);
    if (!body.success) {
      return badRequest(c, body.message);
    }

    const validation = validateUploadPayload(body.data, {
      maxFileSizeBytes: UPLOAD_LIMITS.maxMultipartBytes,
    });
    const validationResponse = readUploadValidationResponse(c, validation);
    if (validationResponse) {
      return validationResponse;
    }

    const expectedPartCount = Math.ceil(
      body.data.fileSize / UPLOAD_LIMITS.multipartPartSizeBytes,
    );
    if (expectedPartCount > UPLOAD_LIMITS.multipartMaxParts) {
      return payloadTooLarge(
        c,
        `파트 수가 허용 범위(${UPLOAD_LIMITS.multipartMaxParts})를 초과합니다.`,
      );
    }

    const preparationResponse = await prepareMultipartUploadForReservation({
      c,
      dependencies,
      actorId: actorResult.actor.id,
    });
    if (preparationResponse) {
      return preparationResponse;
    }

    const reservationResult = await reserveStorageCapacityBeforeUpload({
      c,
      dependencies,
      actorId: actorResult.actor.id,
      fileSize: body.data.fileSize,
      grantTtlMs: MULTIPART_UPLOAD_STATE_TTL_MS,
      capacityTtlMs: MULTIPART_UPLOAD_CAPACITY_RESERVATION_TTL_MS,
    });
    if (reservationResult.response) {
      return reservationResult.response;
    }

    try {
      const data = await initiateTrackedMultipartUpload({
        c,
        dependencies,
        actorId: actorResult.actor.id,
        upload: {
          resource: "users",
          slot: "profile",
          fileName: body.data.fileName,
          contentType: body.data.contentType,
          fileSize: body.data.fileSize,
        },
        expectedPartCount,
        reservation: reservationResult.reservation,
      });
      return ok(c, data, 201);
    } catch (error) {
      if (error instanceof MultipartUploadLimitError) {
        return conflict(c, error.message);
      }
      if (error instanceof MissingStorageConfigError) {
        return internalError(
          c,
          "업로드 스토리지 설정이 누락되었습니다. R2_* 환경변수와 공개 URL 서명 시크릿을 확인해 주세요.",
        );
      }
      return internalError(c, "멀티파트 업로드 초기화에 실패했습니다.");
    }
  });

  app.openapi(multipartPartRoute, async (c): Promise<any> => {
    const actorResult = await requireActor(c, dependencies);
    if ("response" in actorResult) {
      return actorResult.response;
    }

    const body = await parseBody(c, ApiMultipartUploadPartRequestSchema);
    if (!body.success) {
      return badRequest(c, body.message);
    }

    const ownership = ensureMultipartOwnership({
      actor: actorResult.actor,
      objectKey: body.data.objectKey,
      c,
    });
    if (ownership) {
      return ownership;
    }

    try {
      const activeState = await readActiveMultipartState({
        c,
        dependencies,
        actor: actorResult.actor,
        uploadId: body.data.uploadId,
        objectKey: body.data.objectKey,
      });
      if (activeState.response) {
        return activeState.response;
      }

      if (body.data.partNumber > activeState.state.maxPartNumber) {
        return unprocessableEntity(c, "partNumber가 초기화된 파트 범위를 벗어났습니다.");
      }

      const contentLength =
        body.data.partNumber === activeState.state.maxPartNumber
          ? activeState.state.fileSize -
            activeState.state.partSize * (activeState.state.maxPartNumber - 1)
          : activeState.state.partSize;
      const data = await dependencies
        .getPresignService(c)
        .issueMultipartUploadPartUrl({ ...body.data, contentLength });
      return ok(c, data);
    } catch {
      return internalError(c, "멀티파트 파트 URL 발급에 실패했습니다.");
    }
  });

  app.openapi(multipartCompleteRoute, async (c): Promise<any> => {
    const actorResult = await requireActor(c, dependencies);
    if ("response" in actorResult) {
      return actorResult.response;
    }

    const body = await parseBody(c, ApiMultipartUploadCompleteRequestSchema);
    if (!body.success) {
      return badRequest(c, body.message);
    }

    const ownership = ensureMultipartOwnership({
      actor: actorResult.actor,
      objectKey: body.data.objectKey,
      c,
    });
    if (ownership) {
      return ownership;
    }

    const uniquePartCount = new Set(body.data.parts.map((part) => part.partNumber)).size;
    if (uniquePartCount !== body.data.parts.length) {
      return unprocessableEntity(c, "중복된 partNumber가 존재합니다.");
    }

    try {
      const activeState = await readActiveMultipartState({
        c,
        dependencies,
        actor: actorResult.actor,
        uploadId: body.data.uploadId,
        objectKey: body.data.objectKey,
      });
      if (activeState.response) {
        return activeState.response;
      }

      const sortedPartNumbers = body.data.parts
        .map((part) => part.partNumber)
        .sort((left, right) => left - right);
      const hasExactPartSet =
        sortedPartNumbers.length === activeState.state.maxPartNumber &&
        sortedPartNumbers.every((partNumber, index) => partNumber === index + 1);
      if (!hasExactPartSet) {
        return unprocessableEntity(
          c,
          "초기화 시 확정된 모든 파트를 빠짐없이 제출해야 합니다.",
        );
      }

      let data;
      try {
        data = await dependencies
          .getPresignService(c)
          .completeMultipartUpload(body.data);
      } catch (error) {
        if (!isNoSuchMultipartUploadError(error)) {
          throw error;
        }

        // The remote upload is already terminal (completed, aborted, or
        // lifecycle-expired). Drop stale local state so retries cannot remain
        // permanently wedged behind an upload that no longer exists.
        await activeState.stateStore.remove(
          body.data.uploadId,
          body.data.objectKey,
        );
        if (activeState.state.reservationId) {
          await settleUploadReservation(
            dependencies.getUploadReservationStore(c),
            activeState.state.reservationId,
            c,
          );
        }
        return badRequest(c, "멀티파트 업로드가 이미 종료되었거나 만료되었습니다.");
      }
      await activeState.stateStore.remove(body.data.uploadId, body.data.objectKey);
      if (activeState.state.reservationId) {
        await settleUploadReservation(
          dependencies.getUploadReservationStore(c),
          activeState.state.reservationId,
          c,
        );
      }
      return ok(c, data);
    } catch {
      return internalError(c, "멀티파트 업로드 완료 처리에 실패했습니다.");
    }
  });

  app.openapi(multipartAbortRoute, async (c): Promise<any> => {
    const actorResult = await requireActor(c, dependencies);
    if ("response" in actorResult) {
      return actorResult.response;
    }

    const body = await parseBody(c, ApiMultipartUploadAbortRequestSchema);
    if (!body.success) {
      return badRequest(c, body.message);
    }

    const ownership = ensureMultipartOwnership({
      actor: actorResult.actor,
      objectKey: body.data.objectKey,
      c,
    });
    if (ownership) {
      return ownership;
    }

    try {
      const activeState = await readActiveMultipartState({
        c,
        dependencies,
        actor: actorResult.actor,
        uploadId: body.data.uploadId,
        objectKey: body.data.objectKey,
      });
      if (activeState.response) {
        return activeState.response;
      }

      let terminalStateIsAmbiguous = false;
      try {
        await dependencies.getPresignService(c).abortMultipartUpload(body.data);
      } catch (error) {
        if (!isNoSuchMultipartUploadError(error)) {
          throw error;
        }
        terminalStateIsAmbiguous = true;
      }
      await activeState.stateStore.remove(body.data.uploadId, body.data.objectKey);
      if (activeState.state.reservationId) {
        const reservationStore = dependencies.getUploadReservationStore(c);
        if (terminalStateIsAmbiguous) {
          await settleUploadReservation(
            reservationStore,
            activeState.state.reservationId,
            c,
          );
        } else {
          await reservationStore
            .remove(activeState.state.reservationId)
            .catch(() => undefined);
        }
      }
      return noContent(c);
    } catch {
      return internalError(c, "멀티파트 업로드 중단 처리에 실패했습니다.");
    }
  });
};
