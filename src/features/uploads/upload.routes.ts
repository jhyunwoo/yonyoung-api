import { type OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { noContent, ok } from "../../lib/http/response";
import type { AppDependencies } from "../../lib/services/dependencies";
import { MissingStorageConfigError } from "../../lib/storage/presign";
import {
  ALLOWED_ATTACHMENT_CONTENT_TYPES,
  UPLOAD_LIMITS,
  isNoSuchMultipartUploadError,
} from "../../lib/storage/presign";
import {
  MULTIPART_UPLOAD_STATE_TTL_MS,
  MultipartUploadLimitError,
} from "../../lib/uploads/multipart-state";
import {
  createdResponse,
  dataResponse,
  errorResponses,
  jsonBody,
  noContentResponse,
} from "../../lib/openapi/responses";
import { AppError, isAppError } from "../../shared/errors/AppError";
import { requireAuthenticatedActor } from "../../shared/http/route-guards";
import { readValidated } from "../../shared/http/validated-input";
import type HonoAppType from "../../types/honoAppType";
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
} from "./upload.contract";
import {
  MULTIPART_UPLOAD_CAPACITY_RESERVATION_TTL_MS,
  SINGLE_UPLOAD_CAPACITY_RESERVATION_TTL_MS,
  SINGLE_UPLOAD_GRANT_TTL_MS,
  releaseUploadReservation,
  reserveStorageCapacityForUpload,
  settleUploadReservation,
} from "./upload-capacity";
import {
  assertMultipartCapacityAvailable,
  initiateTrackedMultipartUpload,
  requireActiveMultipartSession,
} from "./multipart-upload";
import {
  assertCanCreateOrUpdate,
  assertMultipartOwnership,
  assertUploadPayloadAllowed,
  isUserProfileUploadAllowed,
  type ManagedResource,
  type UploadResourcePath,
  type UploadSlot,
} from "./upload.policy";

type App = OpenAPIHono<HonoAppType>;

const STORAGE_CONFIG_MISSING_MESSAGE =
  "업로드 스토리지 설정이 누락되었습니다. R2_* 환경변수와 공개 URL 서명 시크릿을 확인해 주세요.";

/** presign/멀티파트 초기화 실패를 기존 응답 문구 그대로 매핑한다. */
const toUploadFailureError = (error: unknown, fallbackMessage: string) => {
  if (error instanceof MultipartUploadLimitError) {
    return AppError.conflict(error.message);
  }
  if (error instanceof MissingStorageConfigError) {
    return AppError.internalWithReason(STORAGE_CONFIG_MISSING_MESSAGE);
  }
  return AppError.internalWithReason(fallbackMessage);
};

/**
 * 멀티파트 후속 핸들러는 실패를 통째로 500으로 강등해 왔다. 그 동작은 유지하되,
 * 핸들러가 의도적으로 던진 도메인 에러(403/422 등)까지 덮지 않도록 구분한다.
 */
const toMultipartOperationError = (error: unknown, fallbackMessage: string) => {
  if (isAppError(error)) {
    return error;
  }
  return AppError.internalWithReason(fallbackMessage);
};

const assertMultipartPartCountWithinLimit = (fileSize: number): number => {
  const expectedPartCount = Math.ceil(
    fileSize / UPLOAD_LIMITS.multipartPartSizeBytes,
  );
  if (expectedPartCount > UPLOAD_LIMITS.multipartMaxParts) {
    throw AppError.payloadTooLarge(
      `파트 수가 허용 범위(${UPLOAD_LIMITS.multipartMaxParts})를 초과합니다.`,
    );
  }
  return expectedPartCount;
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

  app.openapi(route, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);
    assertCanCreateOrUpdate(actor.role, options.resource);

    const body = readValidated(c, "json", ApiPresignRequestSchema);
    assertUploadPayloadAllowed(body, {
      maxFileSizeBytes: UPLOAD_LIMITS.maxSinglePartBytes,
      allowedContentTypes: options.allowedContentTypes,
    });

    const reservation = await reserveStorageCapacityForUpload({
      c,
      dependencies,
      actorId: actor.id,
      fileSize: body.fileSize,
      grantTtlMs: SINGLE_UPLOAD_GRANT_TTL_MS,
      capacityTtlMs: SINGLE_UPLOAD_CAPACITY_RESERVATION_TTL_MS,
    });

    try {
      const data = await dependencies
        .getPresignService(c)
        .issuePresignedPutUrl({
          actorId: actor.id,
          resource: options.uploadResourcePath,
          slot: options.slot,
          fileName: body.fileName,
          contentType: body.contentType,
          fileSize: body.fileSize,
        });
      return ok(c, data, 201);
    } catch (error) {
      await releaseUploadReservation(reservation);
      throw toUploadFailureError(error, "업로드 URL 발급에 실패했습니다.");
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

  app.openapi(route, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);
    assertCanCreateOrUpdate(actor.role, options.resource);

    const body = readValidated(c, "json", ApiMultipartUploadInitRequestSchema);
    assertUploadPayloadAllowed(body, {
      maxFileSizeBytes: UPLOAD_LIMITS.maxMultipartBytes,
      allowedContentTypes: options.allowedContentTypes,
    });

    const expectedPartCount = assertMultipartPartCountWithinLimit(
      body.fileSize,
    );

    await assertMultipartCapacityAvailable({
      c,
      dependencies,
      actorId: actor.id,
    });

    const reservation = await reserveStorageCapacityForUpload({
      c,
      dependencies,
      actorId: actor.id,
      fileSize: body.fileSize,
      grantTtlMs: MULTIPART_UPLOAD_STATE_TTL_MS,
      capacityTtlMs: MULTIPART_UPLOAD_CAPACITY_RESERVATION_TTL_MS,
    });

    try {
      const data = await initiateTrackedMultipartUpload({
        c,
        dependencies,
        actorId: actor.id,
        upload: {
          resource: options.uploadResourcePath,
          slot: options.slot,
          fileName: body.fileName,
          contentType: body.contentType,
          fileSize: body.fileSize,
        },
        expectedPartCount,
        reservation,
      });
      return ok(c, data, 201);
    } catch (error) {
      throw toUploadFailureError(
        error,
        "멀티파트 업로드 초기화에 실패했습니다.",
      );
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
    body: jsonBody(
      ApiPresignRequestSchema,
      "프로필 업로드 Presigned URL 발급 요청",
    ),
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

  app.openapi(userProfilePresignRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);
    if (!isUserProfileUploadAllowed(actor.role)) {
      throw AppError.forbidden();
    }

    const body = readValidated(c, "json", ApiPresignRequestSchema);
    assertUploadPayloadAllowed(body, {
      maxFileSizeBytes: UPLOAD_LIMITS.maxSinglePartBytes,
    });

    const reservation = await reserveStorageCapacityForUpload({
      c,
      dependencies,
      actorId: actor.id,
      fileSize: body.fileSize,
      grantTtlMs: SINGLE_UPLOAD_GRANT_TTL_MS,
      capacityTtlMs: SINGLE_UPLOAD_CAPACITY_RESERVATION_TTL_MS,
    });

    try {
      const data = await dependencies
        .getPresignService(c)
        .issuePresignedPutUrl({
          actorId: actor.id,
          resource: "users",
          slot: "profile",
          fileName: body.fileName,
          contentType: body.contentType,
          fileSize: body.fileSize,
        });
      return ok(c, data, 201);
    } catch (error) {
      await releaseUploadReservation(reservation);
      throw toUploadFailureError(error, "업로드 URL 발급에 실패했습니다.");
    }
  });

  app.openapi(userProfileMultipartInitRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);
    if (!isUserProfileUploadAllowed(actor.role)) {
      throw AppError.forbidden();
    }

    const body = readValidated(c, "json", ApiMultipartUploadInitRequestSchema);
    assertUploadPayloadAllowed(body, {
      maxFileSizeBytes: UPLOAD_LIMITS.maxMultipartBytes,
    });

    const expectedPartCount = assertMultipartPartCountWithinLimit(
      body.fileSize,
    );

    await assertMultipartCapacityAvailable({
      c,
      dependencies,
      actorId: actor.id,
    });

    const reservation = await reserveStorageCapacityForUpload({
      c,
      dependencies,
      actorId: actor.id,
      fileSize: body.fileSize,
      grantTtlMs: MULTIPART_UPLOAD_STATE_TTL_MS,
      capacityTtlMs: MULTIPART_UPLOAD_CAPACITY_RESERVATION_TTL_MS,
    });

    try {
      const data = await initiateTrackedMultipartUpload({
        c,
        dependencies,
        actorId: actor.id,
        upload: {
          resource: "users",
          slot: "profile",
          fileName: body.fileName,
          contentType: body.contentType,
          fileSize: body.fileSize,
        },
        expectedPartCount,
        reservation,
      });
      return ok(c, data, 201);
    } catch (error) {
      throw toUploadFailureError(
        error,
        "멀티파트 업로드 초기화에 실패했습니다.",
      );
    }
  });

  app.openapi(multipartPartRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);
    const body = readValidated(c, "json", ApiMultipartUploadPartRequestSchema);
    assertMultipartOwnership({ actor, objectKey: body.objectKey });

    try {
      const { state } = await requireActiveMultipartSession({
        c,
        dependencies,
        actor,
        uploadId: body.uploadId,
        objectKey: body.objectKey,
      });

      if (body.partNumber > state.maxPartNumber) {
        throw AppError.unprocessableEntity(
          "partNumber가 초기화된 파트 범위를 벗어났습니다.",
        );
      }

      // 마지막 파트만 나머지 바이트를 갖고, 그 앞은 모두 고정 파트 크기다.
      const contentLength =
        body.partNumber === state.maxPartNumber
          ? state.fileSize - state.partSize * (state.maxPartNumber - 1)
          : state.partSize;
      const data = await dependencies
        .getPresignService(c)
        .issueMultipartUploadPartUrl({ ...body, contentLength });
      return ok(c, data);
    } catch (error) {
      throw toMultipartOperationError(
        error,
        "멀티파트 파트 URL 발급에 실패했습니다.",
      );
    }
  });

  app.openapi(multipartCompleteRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);
    const body = readValidated(
      c,
      "json",
      ApiMultipartUploadCompleteRequestSchema,
    );
    assertMultipartOwnership({ actor, objectKey: body.objectKey });

    const uniquePartCount = new Set(body.parts.map((part) => part.partNumber))
      .size;
    if (uniquePartCount !== body.parts.length) {
      throw AppError.unprocessableEntity("중복된 partNumber가 존재합니다.");
    }

    try {
      const { state, stateStore } = await requireActiveMultipartSession({
        c,
        dependencies,
        actor,
        uploadId: body.uploadId,
        objectKey: body.objectKey,
      });

      const sortedPartNumbers = body.parts
        .map((part) => part.partNumber)
        .sort((left, right) => left - right);
      const hasExactPartSet =
        sortedPartNumbers.length === state.maxPartNumber &&
        sortedPartNumbers.every(
          (partNumber, index) => partNumber === index + 1,
        );
      if (!hasExactPartSet) {
        throw AppError.unprocessableEntity(
          "초기화 시 확정된 모든 파트를 빠짐없이 제출해야 합니다.",
        );
      }

      let data;
      try {
        data = await dependencies
          .getPresignService(c)
          .completeMultipartUpload(body);
      } catch (error) {
        if (!isNoSuchMultipartUploadError(error)) {
          throw error;
        }

        // The remote upload is already terminal (completed, aborted, or
        // lifecycle-expired). Drop stale local state so retries cannot remain
        // permanently wedged behind an upload that no longer exists.
        await stateStore.remove(body.uploadId, body.objectKey);
        if (state.reservationId) {
          await settleUploadReservation(
            dependencies.getUploadReservationStore(c),
            state.reservationId,
            c,
          );
        }
        throw AppError.badRequest(
          "멀티파트 업로드가 이미 종료되었거나 만료되었습니다.",
        );
      }
      await stateStore.remove(body.uploadId, body.objectKey);
      if (state.reservationId) {
        await settleUploadReservation(
          dependencies.getUploadReservationStore(c),
          state.reservationId,
          c,
        );
      }
      return ok(c, data);
    } catch (error) {
      throw toMultipartOperationError(
        error,
        "멀티파트 업로드 완료 처리에 실패했습니다.",
      );
    }
  });

  app.openapi(multipartAbortRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);
    const body = readValidated(c, "json", ApiMultipartUploadAbortRequestSchema);
    assertMultipartOwnership({ actor, objectKey: body.objectKey });

    try {
      const { state, stateStore } = await requireActiveMultipartSession({
        c,
        dependencies,
        actor,
        uploadId: body.uploadId,
        objectKey: body.objectKey,
      });

      let terminalStateIsAmbiguous = false;
      try {
        await dependencies.getPresignService(c).abortMultipartUpload(body);
      } catch (error) {
        if (!isNoSuchMultipartUploadError(error)) {
          throw error;
        }
        terminalStateIsAmbiguous = true;
      }
      await stateStore.remove(body.uploadId, body.objectKey);
      if (state.reservationId) {
        const reservationStore = dependencies.getUploadReservationStore(c);
        if (terminalStateIsAmbiguous) {
          await settleUploadReservation(
            reservationStore,
            state.reservationId,
            c,
          );
        } else {
          await reservationStore
            .remove(state.reservationId)
            .catch(() => undefined);
        }
      }
      return noContent(c);
    } catch (error) {
      throw toMultipartOperationError(
        error,
        "멀티파트 업로드 중단 처리에 실패했습니다.",
      );
    }
  });
};
