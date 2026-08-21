import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import type HonoAppType from "../types/honoAppType";
import { badRequest, forbidden, ok } from "../lib/http/response";
import { parseParams } from "../lib/validation/request";
import type { AppDependencies } from "../lib/services/dependencies";
import { requireActor } from "../lib/http/authz";
import { isManagerLikeRole } from "../lib/authorization/policy";
import { dataResponse, errorResponses } from "../lib/openapi/responses";
import {
  ApiAuditLogSchema,
  ApiAuditParamSchema,
  ApiAuditQuerySchema,
} from "../lib/openapi/schemas";

type App = OpenAPIHono<HonoAppType>;

const listAuditLogsRoute = createRoute({
  method: "get",
  path: "/api/audit/{resourceType}/{resourceId}",
  tags: ["Audit"],
  operationId: "listAuditLogs",
  security: [{ cookieAuth: [] }],
  request: {
    params: ApiAuditParamSchema,
    query: ApiAuditQuerySchema,
  },
  responses: {
    200: dataResponse(ApiAuditLogSchema.array(), "감사 로그 조회 성공"),
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
  },
});

export const registerAuditRoutes = (app: App, dependencies: AppDependencies) => {
  app.openapi(listAuditLogsRoute, async (c): Promise<any> => {
    const actorResult = await requireActor(c, dependencies);
    if ("response" in actorResult) {
      return actorResult.response;
    }

    if (!isManagerLikeRole(actorResult.actor.role)) {
      return forbidden(c);
    }

    const params = parseParams(c, ApiAuditParamSchema);
    if (!params.success) {
      return badRequest(c, params.message);
    }

    const query = ApiAuditQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return badRequest(c, query.error.issues[0]?.message ?? "잘못된 요청입니다.");
    }

    const logs = await dependencies
      .getDataService(c)
      .listAuditLogs(params.data.resourceType, params.data.resourceId, query.data.limit);

    return ok(c, logs);
  });
};
