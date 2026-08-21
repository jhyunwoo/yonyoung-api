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
  ApiCreateLinktreeItemSchema,
  ApiCreateLinktreeSchema,
  ApiLinktreeItemSchema,
  ApiLinktreeSchema,
  ApiUpdateLinktreeItemSchema,
  ApiUpdateLinktreeSchema,
} from "./linktree.contract";
import {
  ApiIdParamSchema,
  ApiItemIdParamSchema,
} from "../../shared/openapi/common.contract";
import { AppError } from "../../shared/errors/AppError";

type App = OpenAPIHono<HonoAppType>;

const listLinktreesRoute = createRoute({
  method: "get",
  path: "/api/linktree",
  tags: ["Linktree"],
  operationId: "listLinktrees",
  security: [{ cookieAuth: [] }],
  responses: {
    200: dataResponse(ApiLinktreeSchema.array(), "링크트리 목록 조회 성공"),
    401: errorResponses[401],
    403: errorResponses[403],
  },
});

const createLinktreeRoute = createRoute({
  method: "post",
  path: "/api/linktree",
  tags: ["Linktree"],
  operationId: "createLinktree",
  security: [{ cookieAuth: [] }],
  request: {
    body: jsonBody(ApiCreateLinktreeSchema, "링크트리 생성 요청"),
  },
  responses: {
    201: createdResponse(ApiLinktreeSchema, "링크트리 생성 성공"),
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
  },
});

const getLinktreeByIdRoute = createRoute({
  method: "get",
  path: "/api/linktree/{id}",
  tags: ["Linktree"],
  operationId: "getLinktreeById",
  security: [{ cookieAuth: [] }],
  request: {
    params: ApiIdParamSchema,
  },
  responses: {
    200: dataResponse(ApiLinktreeSchema, "링크트리 상세 조회 성공"),
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
  },
});

const updateLinktreeRoute = createRoute({
  method: "patch",
  path: "/api/linktree/{id}",
  tags: ["Linktree"],
  operationId: "updateLinktree",
  security: [{ cookieAuth: [] }],
  request: {
    params: ApiIdParamSchema,
    body: jsonBody(ApiUpdateLinktreeSchema, "링크트리 수정 요청"),
  },
  responses: {
    200: dataResponse(ApiLinktreeSchema, "링크트리 수정 성공"),
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
  },
});

const deleteLinktreeRoute = createRoute({
  method: "delete",
  path: "/api/linktree/{id}",
  tags: ["Linktree"],
  operationId: "deleteLinktree",
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

const addLinktreeItemRoute = createRoute({
  method: "post",
  path: "/api/linktree/{id}/items",
  tags: ["Linktree"],
  operationId: "addLinktreeItem",
  security: [{ cookieAuth: [] }],
  request: {
    params: ApiIdParamSchema,
    body: jsonBody(ApiCreateLinktreeItemSchema, "링크트리 아이템 생성 요청"),
  },
  responses: {
    201: createdResponse(ApiLinktreeItemSchema, "링크트리 아이템 생성 성공"),
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
  },
});

const updateLinktreeItemRoute = createRoute({
  method: "patch",
  path: "/api/linktree/{id}/items/{itemId}",
  tags: ["Linktree"],
  operationId: "updateLinktreeItem",
  security: [{ cookieAuth: [] }],
  request: {
    params: ApiItemIdParamSchema,
    body: jsonBody(ApiUpdateLinktreeItemSchema, "링크트리 아이템 수정 요청"),
  },
  responses: {
    200: dataResponse(ApiLinktreeItemSchema, "링크트리 아이템 수정 성공"),
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
  },
});

const deleteLinktreeItemRoute = createRoute({
  method: "delete",
  path: "/api/linktree/{id}/items/{itemId}",
  tags: ["Linktree"],
  operationId: "deleteLinktreeItem",
  security: [{ cookieAuth: [] }],
  request: {
    params: ApiItemIdParamSchema,
  },
  responses: {
    204: noContentResponse,
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
  },
});

export const registerLinktreeRoutes = (
  app: App,
  dependencies: AppDependencies,
) => {
  app.openapi(listLinktreesRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);
    assertPermission(actor, "linktree", "read");

    const data = await dependencies.getDataService(c).listLinktrees();
    return ok(c, data);
  });

  app.openapi(createLinktreeRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);
    assertPermission(actor, "linktree", "create");

    const body = readValidated(c, "json", ApiCreateLinktreeSchema);

    const dataService = dependencies.getDataService(c);
    const data = await dataService.createLinktree(body);
    await recordAuditLog({
      dataService,
      actor: actor,
      resourceType: "linktree",
      resourceId: data.id,
      action: "create",
      changedFields: readChangedFields(body, ["name"]),
    });
    return ok(c, withUpdatedByActor(data, actor), 201);
  });

  app.openapi(getLinktreeByIdRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);
    assertPermission(actor, "linktree", "read");

    const params = readValidated(c, "param", ApiIdParamSchema);

    const data = await dependencies
      .getDataService(c)
      .getLinktreeById(params.id);
    if (!data) {
      throw AppError.notFound();
    }
    return ok(c, data);
  });

  app.openapi(updateLinktreeRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);
    assertPermission(actor, "linktree", "update");

    const params = readValidated(c, "param", ApiIdParamSchema);
    const body = readValidated(c, "json", ApiUpdateLinktreeSchema);
    if (Object.keys(body).length === 0) {
      throw AppError.badRequest("수정할 필드를 하나 이상 전달해야 합니다.");
    }

    const dataService = dependencies.getDataService(c);
    const data = await dataService.updateLinktree(params.id, body);
    if (!data) {
      throw AppError.notFound();
    }
    await recordAuditLog({
      dataService,
      actor: actor,
      resourceType: "linktree",
      resourceId: data.id,
      action: "update",
      changedFields: readChangedFields(body, ["updatedAt"]),
    });
    return ok(c, withUpdatedByActor(data, actor));
  });

  app.openapi(deleteLinktreeRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);
    assertPermission(actor, "linktree", "delete");

    const params = readValidated(c, "param", ApiIdParamSchema);

    const dataService = dependencies.getDataService(c);
    const deleted = await dataService.deleteLinktree(params.id);
    if (!deleted) {
      throw AppError.notFound();
    }
    await recordAuditLog({
      dataService,
      actor: actor,
      resourceType: "linktree",
      resourceId: params.id,
      action: "delete",
      changedFields: ["deletedAt"],
    });
    return noContent(c);
  });

  app.openapi(addLinktreeItemRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);
    assertPermission(actor, "linktree", "update");

    const params = readValidated(c, "param", ApiIdParamSchema);
    const body = readValidated(c, "json", ApiCreateLinktreeItemSchema);

    const dataService = dependencies.getDataService(c);
    const data = await dataService.addLinktreeItem(params.id, body);
    if (!data) {
      throw AppError.notFound("링크트리를 찾을 수 없습니다.");
    }
    await recordAuditLog({
      dataService,
      actor: actor,
      resourceType: "linktree_item",
      resourceId: data.id,
      action: "create",
      changedFields: readChangedFields(body, ["name", "link"]),
    });
    return ok(c, withUpdatedByActor(data, actor), 201);
  });

  app.openapi(updateLinktreeItemRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);
    assertPermission(actor, "linktree", "update");

    const params = readValidated(c, "param", ApiItemIdParamSchema);
    const body = readValidated(c, "json", ApiUpdateLinktreeItemSchema);
    if (Object.keys(body).length === 0) {
      throw AppError.badRequest("수정할 필드를 하나 이상 전달해야 합니다.");
    }

    const dataService = dependencies.getDataService(c);
    const data = await dataService.updateLinktreeItem(
      params.id,
      params.itemId,
      body,
    );
    if (!data) {
      throw AppError.notFound("링크 아이템을 찾을 수 없습니다.");
    }
    await recordAuditLog({
      dataService,
      actor: actor,
      resourceType: "linktree_item",
      resourceId: data.id,
      action: "update",
      changedFields: readChangedFields(body, ["updatedAt"]),
    });
    return ok(c, withUpdatedByActor(data, actor));
  });

  app.openapi(deleteLinktreeItemRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);
    assertPermission(actor, "linktree", "delete");

    const params = readValidated(c, "param", ApiItemIdParamSchema);

    const dataService = dependencies.getDataService(c);
    const deleted = await dataService.deleteLinktreeItem(
      params.id,
      params.itemId,
    );
    if (!deleted) {
      throw AppError.notFound("링크 아이템을 찾을 수 없습니다.");
    }
    await recordAuditLog({
      dataService,
      actor: actor,
      resourceType: "linktree_item",
      resourceId: params.itemId,
      action: "delete",
      changedFields: ["deletedAt"],
    });
    return noContent(c);
  });
};
