import { type OpenAPIHono, createRoute } from "@hono/zod-openapi";
import type HonoAppType from "../../types/honoAppType";
import { ok } from "../../lib/http/response";
import type { AppDependencies } from "../../lib/services/dependencies";
import { requireAuthenticatedActor } from "../../shared/http/route-guards";
import { readValidated } from "../../shared/http/validated-input";
import {
  hasMeaningfulRichTextHtml,
  sanitizeRichTextHtml,
} from "../../lib/content/rich-text";
import {
  dataResponse,
  errorResponses,
  jsonBody,
} from "../../lib/openapi/responses";
import {
  ApiRecruitingPlanSchema,
  ApiUpsertCurrentRecruitingPlanSchema,
} from "./recruiting-plan.contract";
import { AppError } from "../../shared/errors/AppError";

type App = OpenAPIHono<HonoAppType>;

const isPrivilegedActor = (role: string): boolean =>
  role === "president" || role === "vice_president";

const sanitizeRecruitingPlanContentField = <T extends { content: string }>(
  plan: T,
): T => ({
  ...plan,
  content: sanitizeRichTextHtml(plan.content),
});

const getCurrentRecruitingPlanRoute = createRoute({
  method: "get",
  path: "/api/recruiting-plan/current",
  tags: ["RecruitingPlan"],
  operationId: "getCurrentRecruitingPlan",
  security: [{ cookieAuth: [] }],
  responses: {
    200: dataResponse(
      ApiRecruitingPlanSchema.nullable(),
      "현재 연도 모집 계획 조회 성공",
    ),
    401: errorResponses[401],
    403: errorResponses[403],
  },
});

const upsertCurrentRecruitingPlanRoute = createRoute({
  method: "patch",
  path: "/api/recruiting-plan/current",
  tags: ["RecruitingPlan"],
  operationId: "upsertCurrentRecruitingPlan",
  security: [{ cookieAuth: [] }],
  request: {
    body: jsonBody(
      ApiUpsertCurrentRecruitingPlanSchema,
      "현재 연도 모집 계획 수정 요청",
    ),
  },
  responses: {
    200: dataResponse(ApiRecruitingPlanSchema, "현재 연도 모집 계획 수정 성공"),
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
  },
});

export const registerRecruitingPlanRoutes = (
  app: App,
  dependencies: AppDependencies,
) => {
  app.openapi(getCurrentRecruitingPlanRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);

    if (!isPrivilegedActor(actor.role)) {
      throw AppError.forbidden();
    }

    const data = await dependencies
      .getDataService(c)
      .getCurrentRecruitingPlan();
    return ok(c, data ? sanitizeRecruitingPlanContentField(data) : null);
  });

  app.openapi(upsertCurrentRecruitingPlanRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);

    if (!isPrivilegedActor(actor.role)) {
      throw AppError.forbidden();
    }

    const body = readValidated(c, "json", ApiUpsertCurrentRecruitingPlanSchema);

    const sanitizedContent = sanitizeRichTextHtml(body.content);
    if (!hasMeaningfulRichTextHtml(sanitizedContent)) {
      throw AppError.badRequest("세부 내용은 비워둘 수 없습니다.");
    }

    if (body.recruitmentStartAt > body.recruitmentEndAt) {
      throw AppError.badRequest(
        "모집 시작 일시는 모집 종료 일시보다 늦을 수 없습니다.",
      );
    }

    const data = await dependencies
      .getDataService(c)
      .upsertCurrentRecruitingPlan({
        title: body.title.trim(),
        content: sanitizedContent,
        promotionImageUrls: body.promotionImageUrls,
        recruitmentStartAt: new Date(body.recruitmentStartAt),
        recruitmentEndAt: new Date(body.recruitmentEndAt),
      });
    return ok(c, sanitizeRecruitingPlanContentField(data));
  });
};
