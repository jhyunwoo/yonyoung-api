import { type OpenAPIHono, createRoute } from "@hono/zod-openapi";
import type HonoAppType from "../../types/honoAppType";
import { ok } from "../../lib/http/response";
import type { AppDependencies } from "../../lib/services/dependencies";
import { requireAuthenticatedActor } from "../../shared/http/route-guards";
import { readValidated } from "../../shared/http/validated-input";
import { isManagerLikeRole } from "../../lib/authorization/policy";
import { dataResponse, errorResponses } from "../../lib/openapi/responses";
import {
  ApiAuditLogSchema,
  ApiAuditParamSchema,
  ApiAuditQuerySchema,
} from "./audit.contract";
import { AppError } from "../../shared/errors/AppError";

type App = OpenAPIHono<HonoAppType>;

/**
 * 이 feature 가 실제로 쓰는 것만 선언한다.
 * 애플리케이션 전체 dependency bag 을 받으면 무엇에 의존하는지 파일을 다 읽어야 알 수 있다.
 */
export type AuditRouteDependencies = Pick<
  AppDependencies,
  "resolveActor" | "getDataService"
>;

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

export const registerAuditRoutes = (
  app: App,
  dependencies: AuditRouteDependencies,
) => {
  app.openapi(listAuditLogsRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);

    if (!isManagerLikeRole(actor.role)) {
      throw AppError.forbidden();
    }

    const params = readValidated(c, "param", ApiAuditParamSchema);

    const query = readValidated(c, "query", ApiAuditQuerySchema);

    const logs = await dependencies
      .getDataService(c)
      .listAuditLogs(params.resourceType, params.resourceId, query.limit);

    return ok(c, logs);
  });
};
