import { type OpenAPIHono, createRoute } from "@hono/zod-openapi";
import type HonoAppType from "../../types/honoAppType";
import type { Actor } from "../../lib/authorization/types";
import { noContent, ok } from "../../lib/http/response";
import { type AppDependencies } from "../../lib/services/dependencies";
import { AppError } from "../../shared/errors/AppError";
import {
  assertPermission,
  requireAuthenticatedActor,
} from "../../shared/http/route-guards";
import { readValidated } from "../../shared/http/validated-input";
import {
  recordAuditLog,
  readChangedFields,
  withUpdatedByActor,
} from "../../lib/audit";
import {
  hasMeaningfulRichTextHtml,
  sanitizeRichTextHtml,
} from "../../lib/content/rich-text";
import {
  createdResponse,
  dataResponse,
  errorResponses,
  jsonBody,
  noContentResponse,
} from "../../lib/openapi/responses";
import {
  ApiActivityImageSchema,
  ApiActivitySchema,
  ApiCreateActivityImageBatchSchema,
  ApiCreateActivityImageSchema,
  ApiCreateActivitySchema,
  ApiListActivitiesQuerySchema,
  ApiUpdateActivityImageBatchSchema,
  ApiUpdateActivityImageSchema,
  ApiUpdateActivitySchema,
} from "./activity.contract";
import {
  ApiIdParamSchema,
  ApiImageIdParamSchema,
} from "../../shared/openapi/common.contract";

type App = OpenAPIHono<HonoAppType>;

const sanitizeActivityDescriptionField = <T extends { description: string }>(
  activity: T,
): T => ({
  ...activity,
  description: sanitizeRichTextHtml(activity.description),
});

const listActivitiesRoute = createRoute({
  method: "get",
  path: "/api/activities",
  tags: ["Activities"],
  operationId: "listActivities",
  security: [{ cookieAuth: [] }],
  request: {
    query: ApiListActivitiesQuerySchema,
  },
  responses: {
    200: dataResponse(ApiActivitySchema.array(), "활동 목록 조회 성공"),
    401: errorResponses[401],
    403: errorResponses[403],
  },
});

const createActivityRoute = createRoute({
  method: "post",
  path: "/api/activities",
  tags: ["Activities"],
  operationId: "createActivity",
  security: [{ cookieAuth: [] }],
  request: {
    body: jsonBody(ApiCreateActivitySchema, "활동 생성 요청"),
  },
  responses: {
    201: createdResponse(ApiActivitySchema, "활동 생성 성공"),
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
  },
});

const getActivityByIdRoute = createRoute({
  method: "get",
  path: "/api/activities/{id}",
  tags: ["Activities"],
  operationId: "getActivityById",
  security: [{ cookieAuth: [] }],
  request: { params: ApiIdParamSchema },
  responses: {
    200: dataResponse(ApiActivitySchema, "활동 상세 조회 성공"),
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
  },
});

const updateActivityRoute = createRoute({
  method: "patch",
  path: "/api/activities/{id}",
  tags: ["Activities"],
  operationId: "updateActivity",
  security: [{ cookieAuth: [] }],
  request: {
    params: ApiIdParamSchema,
    body: jsonBody(ApiUpdateActivitySchema, "활동 수정 요청"),
  },
  responses: {
    200: dataResponse(ApiActivitySchema, "활동 수정 성공"),
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
  },
});

const deleteActivityRoute = createRoute({
  method: "delete",
  path: "/api/activities/{id}",
  tags: ["Activities"],
  operationId: "deleteActivity",
  security: [{ cookieAuth: [] }],
  request: { params: ApiIdParamSchema },
  responses: {
    204: noContentResponse,
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
  },
});

const addActivityImageRoute = createRoute({
  method: "post",
  path: "/api/activities/{id}/images",
  tags: ["Activities"],
  operationId: "addActivityImage",
  security: [{ cookieAuth: [] }],
  request: {
    params: ApiIdParamSchema,
    body: jsonBody(ApiCreateActivityImageSchema, "활동 이미지 추가 요청"),
  },
  responses: {
    201: createdResponse(ApiActivityImageSchema, "활동 이미지 생성 성공"),
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
  },
});

const updateActivityImageRoute = createRoute({
  method: "patch",
  path: "/api/activities/{id}/images/{imageId}",
  tags: ["Activities"],
  operationId: "updateActivityImage",
  security: [{ cookieAuth: [] }],
  request: {
    params: ApiImageIdParamSchema,
    body: jsonBody(ApiUpdateActivityImageSchema, "활동 이미지 수정 요청"),
  },
  responses: {
    200: dataResponse(ApiActivityImageSchema, "활동 이미지 수정 성공"),
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
  },
});

const addActivityImagesBatchRoute = createRoute({
  method: "post",
  path: "/api/activities/{id}/images/batch",
  tags: ["Activities"],
  operationId: "addActivityImagesBatch",
  security: [{ cookieAuth: [] }],
  request: {
    params: ApiIdParamSchema,
    body: jsonBody(
      ApiCreateActivityImageBatchSchema,
      "활동 이미지 일괄 추가 요청",
    ),
  },
  responses: {
    201: createdResponse(
      ApiActivityImageSchema.array(),
      "활동 이미지 일괄 생성 성공",
    ),
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
  },
});

const updateActivityImagesBatchRoute = createRoute({
  method: "patch",
  path: "/api/activities/{id}/images/batch",
  tags: ["Activities"],
  operationId: "updateActivityImagesBatch",
  security: [{ cookieAuth: [] }],
  request: {
    params: ApiIdParamSchema,
    body: jsonBody(
      ApiUpdateActivityImageBatchSchema,
      "활동 이미지 일괄 수정 요청",
    ),
  },
  responses: {
    200: dataResponse(
      ApiActivityImageSchema.array(),
      "활동 이미지 일괄 수정 성공",
    ),
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
  },
});

const deleteActivityImageRoute = createRoute({
  method: "delete",
  path: "/api/activities/{id}/images/{imageId}",
  tags: ["Activities"],
  operationId: "deleteActivityImage",
  security: [{ cookieAuth: [] }],
  request: {
    params: ApiImageIdParamSchema,
  },
  responses: {
    204: noContentResponse,
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
  },
});

/** 설명은 sanitize 후에도 의미 있는 내용이 남아 있어야 한다. */
const requireMeaningfulDescription = (description: string): string => {
  const sanitized = sanitizeRichTextHtml(description);
  if (!hasMeaningfulRichTextHtml(sanitized)) {
    throw AppError.badRequest("활동 설명은 비워둘 수 없습니다.");
  }
  return sanitized;
};

// 세부 이미지 변경은 어떤 연산이든 상위 활동의 detailImages 수정으로 기록한다.
const recordDetailImageAudit = (
  dataService: ReturnType<AppDependencies["getDataService"]>,
  actor: Actor,
  activityId: string,
) =>
  recordAuditLog({
    dataService,
    actor,
    resourceType: "activity",
    resourceId: activityId,
    action: "update",
    changedFields: ["detailImages"],
  });

export const registerActivityRoutes = (
  app: App,
  dependencies: AppDependencies,
) => {
  app.openapi(listActivitiesRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);
    assertPermission(actor, "activity", "read");

    const { generationId } = readValidated(
      c,
      "query",
      ApiListActivitiesQuerySchema,
    );

    const data = await dependencies
      .getDataService(c)
      .listActivities(generationId);
    return ok(c, data.map(sanitizeActivityDescriptionField));
  });

  app.openapi(createActivityRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);
    assertPermission(actor, "activity", "create");

    const input = readValidated(c, "json", ApiCreateActivitySchema);
    const description = requireMeaningfulDescription(input.description);

    const dataService = dependencies.getDataService(c);
    const data = await dataService.createActivity({ ...input, description });

    await recordAuditLog({
      dataService,
      actor,
      resourceType: "activity",
      resourceId: data.id,
      action: "create",
      changedFields: readChangedFields(input, [
        "title",
        "description",
        "startDate",
        "endDate",
        "coverImageUrl",
        "generationId",
      ]),
    });

    return ok(
      c,
      withUpdatedByActor(sanitizeActivityDescriptionField(data), actor),
      201,
    );
  });

  app.openapi(getActivityByIdRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);
    assertPermission(actor, "activity", "read");

    const { id } = readValidated(c, "param", ApiIdParamSchema);

    const data = await dependencies.getDataService(c).getActivityById(id);
    if (!data) {
      throw AppError.notFound();
    }
    return ok(c, sanitizeActivityDescriptionField(data));
  });

  app.openapi(updateActivityRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);
    assertPermission(actor, "activity", "update");

    const { id } = readValidated(c, "param", ApiIdParamSchema);
    const input = readValidated(c, "json", ApiUpdateActivitySchema);

    const patch = { ...input };
    if (patch.description !== undefined) {
      patch.description = requireMeaningfulDescription(patch.description);
    }

    if (Object.keys(patch).length === 0) {
      throw AppError.badRequest("수정할 필드를 하나 이상 전달해야 합니다.");
    }

    const dataService = dependencies.getDataService(c);
    const data = await dataService.updateActivity(id, patch);
    if (!data) {
      throw AppError.notFound();
    }

    await recordAuditLog({
      dataService,
      actor,
      resourceType: "activity",
      resourceId: data.id,
      action: "update",
      changedFields: readChangedFields(patch, ["updatedAt"]),
    });

    return ok(
      c,
      withUpdatedByActor(sanitizeActivityDescriptionField(data), actor),
    );
  });

  app.openapi(deleteActivityRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);
    assertPermission(actor, "activity", "delete");

    const { id } = readValidated(c, "param", ApiIdParamSchema);

    const dataService = dependencies.getDataService(c);
    const deleted = await dataService.deleteActivity(id);
    if (!deleted) {
      throw AppError.notFound();
    }

    await recordAuditLog({
      dataService,
      actor,
      resourceType: "activity",
      resourceId: id,
      action: "delete",
      changedFields: ["deletedAt"],
    });

    return noContent(c);
  });

  // 세부 이미지는 활동 본문 수정과 동일 권한으로 분리 관리한다.
  app.openapi(addActivityImageRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);
    assertPermission(actor, "activity", "update");

    const { id } = readValidated(c, "param", ApiIdParamSchema);
    const input = readValidated(c, "json", ApiCreateActivityImageSchema);

    const dataService = dependencies.getDataService(c);
    const data = await dataService.addActivityImage(id, input);
    if (!data) {
      throw AppError.notFound("활동을 찾을 수 없습니다.");
    }

    await recordDetailImageAudit(dataService, actor, id);

    return ok(c, data, 201);
  });

  app.openapi(addActivityImagesBatchRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);
    assertPermission(actor, "activity", "update");

    const { id } = readValidated(c, "param", ApiIdParamSchema);
    const input = readValidated(c, "json", ApiCreateActivityImageBatchSchema);

    const dataService = dependencies.getDataService(c);
    const data = await dataService.addActivityImages(id, input);
    if (!data) {
      throw AppError.notFound("활동을 찾을 수 없습니다.");
    }

    await recordDetailImageAudit(dataService, actor, id);

    return ok(c, data, 201);
  });

  app.openapi(updateActivityImagesBatchRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);
    assertPermission(actor, "activity", "update");

    const { id } = readValidated(c, "param", ApiIdParamSchema);
    const input = readValidated(c, "json", ApiUpdateActivityImageBatchSchema);

    const dataService = dependencies.getDataService(c);
    const data = await dataService.updateActivityImages(id, input);
    if (!data) {
      throw AppError.notFound("세부 이미지를 찾을 수 없습니다.");
    }

    await recordDetailImageAudit(dataService, actor, id);

    return ok(c, data);
  });

  app.openapi(updateActivityImageRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);
    assertPermission(actor, "activity", "update");

    const { id, imageId } = readValidated(c, "param", ApiImageIdParamSchema);
    const input = readValidated(c, "json", ApiUpdateActivityImageSchema);
    if (Object.keys(input).length === 0) {
      throw AppError.badRequest("수정할 필드를 하나 이상 전달해야 합니다.");
    }

    const dataService = dependencies.getDataService(c);
    const data = await dataService.updateActivityImage(id, imageId, input);
    if (!data) {
      throw AppError.notFound("세부 이미지를 찾을 수 없습니다.");
    }

    await recordDetailImageAudit(dataService, actor, id);

    return ok(c, data);
  });

  app.openapi(deleteActivityImageRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);
    assertPermission(actor, "activity", "delete");

    const { id, imageId } = readValidated(c, "param", ApiImageIdParamSchema);

    const dataService = dependencies.getDataService(c);
    const deleted = await dataService.deleteActivityImage(id, imageId);
    if (!deleted) {
      throw AppError.notFound("세부 이미지를 찾을 수 없습니다.");
    }

    await recordDetailImageAudit(dataService, actor, id);

    return noContent(c);
  });
};
