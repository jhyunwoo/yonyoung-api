import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import type HonoAppType from "../types/honoAppType";
import {
  badRequest,
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
import { requireActor } from "../lib/http/authz";
import { can, isMemberLikeRole } from "../lib/authorization/policy";
import type { Actor, Resource, Role } from "../lib/authorization/types";
import { MissingStorageConfigError } from "../lib/storage/presign";
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
  parseManagedObjectKey,
} from "../lib/storage/presign";
import type { ManagedUploadResourcePath, ManagedUploadSlot } from "../lib/storage/presign";
import { R2_STORAGE_LIMIT_BYTES } from "../lib/storage/usage";

type App = OpenAPIHono<HonoAppType>;
type ManagedResource = Extract<
  Resource,
  "activity" | "exhibition" | "site_setting"
>;
type UploadResourcePath = ManagedUploadResourcePath;
type UploadSlot = ManagedUploadSlot;

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

const ensureStorageCapacityBeforeUpload = async (input: {
  c: Parameters<typeof badRequest>[0];
  dependencies: AppDependencies;
  fileSize: number;
}): Promise<Response | null> => {
  try {
    const usedBytes = await input.dependencies.readR2TotalUsageBytes(input.c);
    if (usedBytes + input.fileSize > R2_STORAGE_LIMIT_BYTES) {
      return payloadTooLarge(
        input.c,
        "버킷 저장공간 10GB 한도를 초과할 수 있어 업로드를 차단했습니다.",
      );
    }

    return null;
  } catch {
    return internalError(
      input.c,
      "버킷 저장공간 사용량을 확인할 수 없어 업로드를 차단했습니다.",
    );
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

    const storageCapacityResponse = await ensureStorageCapacityBeforeUpload({
      c,
      dependencies,
      fileSize: body.data.fileSize,
    });
    if (storageCapacityResponse) {
      return storageCapacityResponse;
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

    const storageCapacityResponse = await ensureStorageCapacityBeforeUpload({
      c,
      dependencies,
      fileSize: body.data.fileSize,
    });
    if (storageCapacityResponse) {
      return storageCapacityResponse;
    }

    try {
      const data = await dependencies.getPresignService(c).initiateMultipartUpload({
        actorId: actorResult.actor.id,
        resource: options.uploadResourcePath,
        slot: options.slot,
        fileName: body.data.fileName,
        contentType: body.data.contentType,
        fileSize: body.data.fileSize,
      });
      return ok(c, data, 201);
    } catch (error) {
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

    const storageCapacityResponse = await ensureStorageCapacityBeforeUpload({
      c,
      dependencies,
      fileSize: body.data.fileSize,
    });
    if (storageCapacityResponse) {
      return storageCapacityResponse;
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

    const storageCapacityResponse = await ensureStorageCapacityBeforeUpload({
      c,
      dependencies,
      fileSize: body.data.fileSize,
    });
    if (storageCapacityResponse) {
      return storageCapacityResponse;
    }

    try {
      const data = await dependencies.getPresignService(c).initiateMultipartUpload({
        actorId: actorResult.actor.id,
        resource: "users",
        slot: "profile",
        fileName: body.data.fileName,
        contentType: body.data.contentType,
        fileSize: body.data.fileSize,
      });
      return ok(c, data, 201);
    } catch (error) {
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
      const data = await dependencies
        .getPresignService(c)
        .issueMultipartUploadPartUrl(body.data);
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
      const data = await dependencies
        .getPresignService(c)
        .completeMultipartUpload(body.data);
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
      await dependencies.getPresignService(c).abortMultipartUpload(body.data);
      return noContent(c);
    } catch {
      return internalError(c, "멀티파트 업로드 중단 처리에 실패했습니다.");
    }
  });
};
