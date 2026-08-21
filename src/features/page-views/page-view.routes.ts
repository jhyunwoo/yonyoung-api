import { type OpenAPIHono, createRoute } from "@hono/zod-openapi";
import {
  ApiDashboardPageViewStatsSchema,
  ApiPageViewStatsSchema,
  ApiRecordPageViewRequestSchema,
} from "./page-view.contract";
import {
  dataResponse,
  errorResponses,
  jsonBody,
} from "../../lib/openapi/responses";
import { z } from "../../shared/openapi/zod";
import { ok } from "../../lib/http/response";
import { type AppDependencies } from "../../lib/services/dependencies";
import { requireAuthenticatedActor } from "../../shared/http/route-guards";
import { isManagerLikeRole } from "../../lib/authorization/policy";
import type HonoAppType from "../../types/honoAppType";
import { normalizePageViewResourceId } from "../../lib/views/page-view-target";
import { AppError } from "../../shared/errors/AppError";

type App = OpenAPIHono<HonoAppType>;

const RecordPageViewResponseSchema = z
  .object({ ok: z.literal(true) })
  .openapi("ApiRecordPageViewResponse");

const recordPageViewRoute = createRoute({
  method: "post",
  path: "/api/public/page-views",
  tags: ["Public"],
  operationId: "recordPageView",
  request: {
    body: jsonBody(ApiRecordPageViewRequestSchema, "방문 기록 요청 본문"),
  },
  responses: {
    200: {
      description: "방문 기록 처리 결과 (실패해도 200으로 응답)",
      content: {
        "application/json": {
          schema: RecordPageViewResponseSchema,
        },
      },
    },
    400: errorResponses[400],
  },
});

const getPageViewStatsRoute = createRoute({
  method: "get",
  path: "/api/admin/page-views/stats",
  tags: ["Dashboard"],
  operationId: "getPageViewStats",
  security: [{ cookieAuth: [] }],
  responses: {
    200: dataResponse(ApiPageViewStatsSchema, "방문 통계 조회 성공"),
    401: errorResponses[401],
    403: errorResponses[403],
  },
});

const getDashboardPageViewStatsRoute = createRoute({
  method: "get",
  path: "/api/admin/page-views/dashboard",
  tags: ["Dashboard"],
  operationId: "getDashboardPageViewStats",
  security: [{ cookieAuth: [] }],
  responses: {
    200: dataResponse(
      ApiDashboardPageViewStatsSchema,
      "대시보드 방문 통계 조회 성공",
    ),
    401: errorResponses[401],
    403: errorResponses[403],
  },
});

// 조회수 기록은 fire-and-forget이다. 기록 단계의 실패는 무시하고 항상 200으로 응답한다.
export const registerPageViewRoutes = (
  app: App,
  dependencies: AppDependencies,
) => {
  app.openapi(recordPageViewRoute, async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw AppError.badRequest("잘못된 요청 본문입니다.");
    }

    const parsed = ApiRecordPageViewRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw AppError.badRequest(
        parsed.error.issues[0]?.message ?? "잘못된 요청입니다.",
      );
    }

    if (!(await dependencies.allowPageViewWrite(c))) {
      return c.json({ ok: true } as const, 200);
    }

    const dataService = dependencies.getDataService(c);
    const { pageType } = parsed.data;
    const resourceId = normalizePageViewResourceId(
      pageType,
      parsed.data.resourceId,
    );

    let isActiveTarget = false;
    try {
      isActiveTarget = await dataService.isActiveViewResource(
        pageType,
        resourceId,
      );
    } catch {
      // Validation lookup failure is fail-closed, while preserving the public API.
    }
    if (!isActiveTarget) {
      return c.json({ ok: true } as const, 200);
    }

    try {
      await dataService.recordPageView(pageType, resourceId);
    } catch {
      // fire-and-forget: 기록 실패는 무시
    }

    // 2. aggregated count 업데이트 (public display용)
    // activity, exhibition, notice, home 타입에 대해 통합 관리
    try {
      const store = dependencies.getViewCountStore(c);
      await store.recordView(pageType, resourceId);
    } catch {
      // fire-and-forget: 기록 실패는 무시
    }

    return c.json({ ok: true } as const, 200);
  });

  app.openapi(getPageViewStatsRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);

    if (!isManagerLikeRole(actor.role)) {
      throw AppError.forbidden();
    }

    const stats = await dependencies.getDataService(c).getPageViewStats();
    return ok(c, stats);
  });

  app.openapi(getDashboardPageViewStatsRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);

    if (!isManagerLikeRole(actor.role)) {
      throw AppError.forbidden();
    }

    const stats = await dependencies
      .getDataService(c)
      .getDashboardPageViewStats();
    return ok(c, stats);
  });
};
