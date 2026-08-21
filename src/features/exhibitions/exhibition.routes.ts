import { type OpenAPIHono, createRoute } from "@hono/zod-openapi";
import type HonoAppType from "../../types/honoAppType";
import { noContent, ok } from "../../lib/http/response";
import { type AppDependencies } from "../../lib/services/dependencies";
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
  createdResponse,
  dataResponse,
  errorResponses,
  jsonBody,
  noContentResponse,
} from "../../lib/openapi/responses";
import {
  ApiCreateExhibitionImageBatchSchema,
  ApiCreateExhibitionImageSchema,
  ApiCreateExhibitionSchema,
  ApiExhibitionImageSchema,
  ApiExhibitionSchema,
  ApiListExhibitionsQuerySchema,
  ApiUpdateExhibitionImageBatchSchema,
  ApiUpdateExhibitionImageSchema,
  ApiUpdateExhibitionSchema,
} from "./exhibition.contract";
import {
  ApiIdParamSchema,
  ApiImageIdParamSchema,
} from "../../shared/openapi/common.contract";
import {
  hasMeaningfulExhibitionRichText,
  sanitizeExhibitionRichText,
} from "../../lib/content/exhibition-rich-text";
import { AppError } from "../../shared/errors/AppError";

type App = OpenAPIHono<HonoAppType>;

const sanitizeExhibitionDescriptionField = <T extends { description: string }>(
  exhibition: T,
): T => ({
  ...exhibition,
  description: sanitizeExhibitionRichText(exhibition.description),
});

const listExhibitionsRoute = createRoute({
  method: "get",
  path: "/api/exhibitions",
  tags: ["Exhibitions"],
  operationId: "listExhibitions",
  security: [{ cookieAuth: [] }],
  request: {
    query: ApiListExhibitionsQuerySchema,
  },
  responses: {
    200: dataResponse(ApiExhibitionSchema.array(), "전시 목록 조회 성공"),
    401: errorResponses[401],
    403: errorResponses[403],
  },
});

const createExhibitionRoute = createRoute({
  method: "post",
  path: "/api/exhibitions",
  tags: ["Exhibitions"],
  operationId: "createExhibition",
  security: [{ cookieAuth: [] }],
  request: {
    body: jsonBody(ApiCreateExhibitionSchema, "전시 생성 요청"),
  },
  responses: {
    201: createdResponse(ApiExhibitionSchema, "전시 생성 성공"),
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
  },
});

const getExhibitionByIdRoute = createRoute({
  method: "get",
  path: "/api/exhibitions/{id}",
  tags: ["Exhibitions"],
  operationId: "getExhibitionById",
  security: [{ cookieAuth: [] }],
  request: {
    params: ApiIdParamSchema,
  },
  responses: {
    200: dataResponse(ApiExhibitionSchema, "전시 상세 조회 성공"),
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
  },
});

const updateExhibitionRoute = createRoute({
  method: "patch",
  path: "/api/exhibitions/{id}",
  tags: ["Exhibitions"],
  operationId: "updateExhibition",
  security: [{ cookieAuth: [] }],
  request: {
    params: ApiIdParamSchema,
    body: jsonBody(ApiUpdateExhibitionSchema, "전시 수정 요청"),
  },
  responses: {
    200: dataResponse(ApiExhibitionSchema, "전시 수정 성공"),
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
  },
});

const deleteExhibitionRoute = createRoute({
  method: "delete",
  path: "/api/exhibitions/{id}",
  tags: ["Exhibitions"],
  operationId: "deleteExhibition",
  security: [{ cookieAuth: [] }],
  request: {
    params: ApiIdParamSchema,
  },
  responses: {
    204: noContentResponse,
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
  },
});

const addExhibitionImageRoute = createRoute({
  method: "post",
  path: "/api/exhibitions/{id}/images",
  tags: ["Exhibitions"],
  operationId: "addExhibitionImage",
  security: [{ cookieAuth: [] }],
  request: {
    params: ApiIdParamSchema,
    body: jsonBody(ApiCreateExhibitionImageSchema, "전시 이미지 추가 요청"),
  },
  responses: {
    201: createdResponse(ApiExhibitionImageSchema, "전시 이미지 생성 성공"),
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
  },
});

const updateExhibitionImageRoute = createRoute({
  method: "patch",
  path: "/api/exhibitions/{id}/images/{imageId}",
  tags: ["Exhibitions"],
  operationId: "updateExhibitionImage",
  security: [{ cookieAuth: [] }],
  request: {
    params: ApiImageIdParamSchema,
    body: jsonBody(ApiUpdateExhibitionImageSchema, "전시 이미지 수정 요청"),
  },
  responses: {
    200: dataResponse(ApiExhibitionImageSchema, "전시 이미지 수정 성공"),
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
  },
});

const addExhibitionImagesBatchRoute = createRoute({
  method: "post",
  path: "/api/exhibitions/{id}/images/batch",
  tags: ["Exhibitions"],
  operationId: "addExhibitionImagesBatch",
  security: [{ cookieAuth: [] }],
  request: {
    params: ApiIdParamSchema,
    body: jsonBody(
      ApiCreateExhibitionImageBatchSchema,
      "전시 이미지 일괄 추가 요청",
    ),
  },
  responses: {
    201: createdResponse(
      ApiExhibitionImageSchema.array(),
      "전시 이미지 일괄 생성 성공",
    ),
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
  },
});

const updateExhibitionImagesBatchRoute = createRoute({
  method: "patch",
  path: "/api/exhibitions/{id}/images/batch",
  tags: ["Exhibitions"],
  operationId: "updateExhibitionImagesBatch",
  security: [{ cookieAuth: [] }],
  request: {
    params: ApiIdParamSchema,
    body: jsonBody(
      ApiUpdateExhibitionImageBatchSchema,
      "전시 이미지 일괄 수정 요청",
    ),
  },
  responses: {
    200: dataResponse(
      ApiExhibitionImageSchema.array(),
      "전시 이미지 일괄 수정 성공",
    ),
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
  },
});

const deleteExhibitionImageRoute = createRoute({
  method: "delete",
  path: "/api/exhibitions/{id}/images/{imageId}",
  tags: ["Exhibitions"],
  operationId: "deleteExhibitionImage",
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

export const registerExhibitionRoutes = (
  app: App,
  dependencies: AppDependencies,
) => {
  app.openapi(listExhibitionsRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);
    assertPermission(actor, "exhibition", "read");

    const query = readValidated(c, "query", ApiListExhibitionsQuerySchema);

    const data = await dependencies
      .getDataService(c)
      .listExhibitions(query.generationId);
    return ok(c, data.map(sanitizeExhibitionDescriptionField));
  });

  app.openapi(createExhibitionRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);
    assertPermission(actor, "exhibition", "create");

    const body = readValidated(c, "json", ApiCreateExhibitionSchema);

    const sanitizedDescription = sanitizeExhibitionRichText(body.description);
    if (!hasMeaningfulExhibitionRichText(sanitizedDescription)) {
      throw AppError.badRequest("전시 설명은 비워둘 수 없습니다.");
    }

    const data = await dependencies.getDataService(c).createExhibition({
      ...body,
      description: sanitizedDescription,
    });

    const dataService = dependencies.getDataService(c);
    await recordAuditLog({
      dataService,
      actor: actor,
      resourceType: "exhibition",
      resourceId: data.id,
      action: "create",
      changedFields: readChangedFields(body, [
        "title",
        "startDate",
        "endDate",
        "generationId",
        "place",
        "coverImageUrl",
        "description",
      ]),
    });

    return ok(
      c,
      withUpdatedByActor(sanitizeExhibitionDescriptionField(data), actor),
      201,
    );
  });

  app.openapi(getExhibitionByIdRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);
    assertPermission(actor, "exhibition", "read");

    const params = readValidated(c, "param", ApiIdParamSchema);

    const data = await dependencies
      .getDataService(c)
      .getExhibitionById(params.id);
    if (!data) {
      throw AppError.notFound();
    }
    return ok(c, sanitizeExhibitionDescriptionField(data));
  });

  app.openapi(updateExhibitionRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);
    assertPermission(actor, "exhibition", "update");

    const params = readValidated(c, "param", ApiIdParamSchema);

    const body = readValidated(c, "json", ApiUpdateExhibitionSchema);
    const nextBody = { ...body };
    if (nextBody.description !== undefined) {
      const sanitizedDescription = sanitizeExhibitionRichText(
        nextBody.description,
      );
      if (!hasMeaningfulExhibitionRichText(sanitizedDescription)) {
        throw AppError.badRequest("전시 설명은 비워둘 수 없습니다.");
      }
      nextBody.description = sanitizedDescription;
    }

    if (Object.keys(nextBody).length === 0) {
      throw AppError.badRequest("수정할 필드를 하나 이상 전달해야 합니다.");
    }

    const dataService = dependencies.getDataService(c);
    const data = await dataService.updateExhibition(params.id, nextBody);
    if (!data) {
      throw AppError.notFound();
    }

    await recordAuditLog({
      dataService,
      actor: actor,
      resourceType: "exhibition",
      resourceId: data.id,
      action: "update",
      changedFields: readChangedFields(nextBody, ["updatedAt"]),
    });

    return ok(
      c,
      withUpdatedByActor(sanitizeExhibitionDescriptionField(data), actor),
    );
  });

  app.openapi(deleteExhibitionRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);
    assertPermission(actor, "exhibition", "delete");

    const params = readValidated(c, "param", ApiIdParamSchema);

    const dataService = dependencies.getDataService(c);
    const deleted = await dataService.deleteExhibition(params.id);
    if (!deleted) {
      throw AppError.notFound();
    }

    await recordAuditLog({
      dataService,
      actor: actor,
      resourceType: "exhibition",
      resourceId: params.id,
      action: "delete",
      changedFields: ["deletedAt"],
    });

    return noContent(c);
  });

  // 전시 세부 이미지도 별도 엔드포인트로 분리해 부분 수정이 가능하도록 한다.
  app.openapi(addExhibitionImageRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);
    assertPermission(actor, "exhibition", "update");

    const params = readValidated(c, "param", ApiIdParamSchema);
    const body = readValidated(c, "json", ApiCreateExhibitionImageSchema);

    const dataService = dependencies.getDataService(c);
    const data = await dataService.addExhibitionImage(params.id, body);
    if (!data) {
      throw AppError.notFound("전시를 찾을 수 없습니다.");
    }

    await recordAuditLog({
      dataService,
      actor: actor,
      resourceType: "exhibition",
      resourceId: params.id,
      action: "update",
      changedFields: ["detailImages"],
    });

    return ok(c, data, 201);
  });

  app.openapi(addExhibitionImagesBatchRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);
    assertPermission(actor, "exhibition", "update");

    const params = readValidated(c, "param", ApiIdParamSchema);
    const body = readValidated(c, "json", ApiCreateExhibitionImageBatchSchema);

    const dataService = dependencies.getDataService(c);
    const data = await dataService.addExhibitionImages(params.id, body);
    if (!data) {
      throw AppError.notFound("전시를 찾을 수 없습니다.");
    }

    await recordAuditLog({
      dataService,
      actor: actor,
      resourceType: "exhibition",
      resourceId: params.id,
      action: "update",
      changedFields: ["detailImages"],
    });

    return ok(c, data, 201);
  });

  app.openapi(updateExhibitionImagesBatchRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);
    assertPermission(actor, "exhibition", "update");

    const params = readValidated(c, "param", ApiIdParamSchema);
    const body = readValidated(c, "json", ApiUpdateExhibitionImageBatchSchema);

    const dataService = dependencies.getDataService(c);
    const data = await dataService.updateExhibitionImages(params.id, body);
    if (!data) {
      throw AppError.notFound("세부 이미지를 찾을 수 없습니다.");
    }

    await recordAuditLog({
      dataService,
      actor: actor,
      resourceType: "exhibition",
      resourceId: params.id,
      action: "update",
      changedFields: ["detailImages"],
    });

    return ok(c, data);
  });

  app.openapi(updateExhibitionImageRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);
    assertPermission(actor, "exhibition", "update");

    const params = readValidated(c, "param", ApiImageIdParamSchema);
    const body = readValidated(c, "json", ApiUpdateExhibitionImageSchema);
    if (Object.keys(body).length === 0) {
      throw AppError.badRequest("수정할 필드를 하나 이상 전달해야 합니다.");
    }

    const dataService = dependencies.getDataService(c);
    const data = await dataService.updateExhibitionImage(
      params.id,
      params.imageId,
      body,
    );
    if (!data) {
      throw AppError.notFound("세부 이미지를 찾을 수 없습니다.");
    }

    await recordAuditLog({
      dataService,
      actor: actor,
      resourceType: "exhibition",
      resourceId: params.id,
      action: "update",
      changedFields: ["detailImages"],
    });

    return ok(c, data);
  });

  app.openapi(deleteExhibitionImageRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);
    assertPermission(actor, "exhibition", "update");

    const params = readValidated(c, "param", ApiImageIdParamSchema);

    const dataService = dependencies.getDataService(c);
    const deleted = await dataService.deleteExhibitionImage(
      params.id,
      params.imageId,
    );
    if (!deleted) {
      throw AppError.notFound("세부 이미지를 찾을 수 없습니다.");
    }

    await recordAuditLog({
      dataService,
      actor: actor,
      resourceType: "exhibition",
      resourceId: params.id,
      action: "update",
      changedFields: ["detailImages"],
    });

    return noContent(c);
  });
};
