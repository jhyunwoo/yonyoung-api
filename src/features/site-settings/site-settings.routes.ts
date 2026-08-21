import { type OpenAPIHono, createRoute } from "@hono/zod-openapi";
import type HonoAppType from "../../types/honoAppType";
import { ok } from "../../lib/http/response";
import type { AppDependencies } from "../../lib/services/dependencies";
import { requireAuthenticatedActor } from "../../shared/http/route-guards";
import { readValidated } from "../../shared/http/validated-input";
import { can } from "../../lib/authorization/policy";
import type { Role } from "../../lib/authorization/types";
import {
  dataResponse,
  errorResponses,
  jsonBody,
} from "../../lib/openapi/responses";
import {
  ApiSiteSettingsSchema,
  ApiUpdateSiteSettingsSchema,
} from "./site-settings.contract";
import { AppError } from "../../shared/errors/AppError";

type App = OpenAPIHono<HonoAppType>;

const isPrivilegedActor = (role: Role): boolean =>
  can(role, "site_setting", "update");

const normalizeInstagramId = (value: string): string => {
  return value.trim().replace(/^@+/, "");
};

const getSiteSettingsRoute = createRoute({
  method: "get",
  path: "/api/site-settings",
  tags: ["SiteSettings"],
  operationId: "getSiteSettings",
  security: [{ cookieAuth: [] }],
  responses: {
    200: dataResponse(ApiSiteSettingsSchema, "웹사이트 기본 설정 조회 성공"),
    401: errorResponses[401],
    403: errorResponses[403],
  },
});

const updateSiteSettingsRoute = createRoute({
  method: "patch",
  path: "/api/site-settings",
  tags: ["SiteSettings"],
  operationId: "updateSiteSettings",
  security: [{ cookieAuth: [] }],
  request: {
    body: jsonBody(ApiUpdateSiteSettingsSchema, "웹사이트 기본 설정 수정 요청"),
  },
  responses: {
    200: dataResponse(ApiSiteSettingsSchema, "웹사이트 기본 설정 수정 성공"),
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
  },
});

export const registerSiteSettingsRoutes = (
  app: App,
  dependencies: AppDependencies,
) => {
  app.openapi(getSiteSettingsRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);

    if (!isPrivilegedActor(actor.role)) {
      throw AppError.forbidden();
    }

    const data = await dependencies.getDataService(c).getSiteSettings();
    return ok(c, data);
  });

  app.openapi(updateSiteSettingsRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);

    if (!isPrivilegedActor(actor.role)) {
      throw AppError.forbidden();
    }

    const body = readValidated(c, "json", ApiUpdateSiteSettingsSchema);

    if (Object.keys(body).length === 0) {
      throw AppError.badRequest("수정할 필드를 하나 이상 전달해야 합니다.");
    }

    const normalized = {
      ...body,
      ...(body.footerInstagramId !== undefined
        ? { footerInstagramId: normalizeInstagramId(body.footerInstagramId) }
        : {}),
    };

    const data = await dependencies
      .getDataService(c)
      .updateSiteSettings(normalized);
    return ok(c, data);
  });
};
