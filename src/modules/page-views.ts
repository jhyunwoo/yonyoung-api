import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import {
  ApiPageViewStatsSchema,
  ApiRecordPageViewRequestSchema,
} from "../lib/openapi/schemas";
import { dataResponse, errorResponses, jsonBody } from "../lib/openapi/responses";
import { z } from "@hono/zod-openapi";
import { badRequest, forbidden, ok } from "../lib/http/response";
import { AppDependencies } from "../lib/services/dependencies";
import { requireActor } from "../lib/http/authz";
import { can } from "../lib/authorization/policy";
import HonoAppType from "../types/honoAppType";

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

/**
 * registerPageViewRoutes 생성/등록 절차를 수행해 시스템 상태를 갱신합니다.
 * @param app 함수 로직에서 사용하는 입력값입니다.
 * @param dependencies 함수 로직에서 사용하는 입력값입니다.
 * @returns 처리 결과 값을 반환합니다.
 * @remarks fire-and-forget 방식이므로 기록 단계의 에러는 무시하고 항상 200으로 응답합니다.
 */
export const registerPageViewRoutes = (
  app: App,
  dependencies: AppDependencies,
) => {
  app.openapi(recordPageViewRoute, async (c): Promise<any> => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return badRequest(c, "잘못된 요청 본문입니다.");
    }

    const parsed = ApiRecordPageViewRequestSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest(c, parsed.error.issues[0]?.message ?? "잘못된 요청입니다.");
    }

    try {
      await dependencies
        .getDataService(c)
        .recordPageView(parsed.data.pageType, parsed.data.resourceId);
    } catch {
      // fire-and-forget: 기록 실패는 무시
    }

    // 2. aggregated count 업데이트 (public display용)
    // activity, exhibition, notice, home 타입에 대해 통합 관리
    try {
      const store = dependencies.getViewCountStore(c);
      const { pageType, resourceId } = parsed.data;
      await store.recordView(pageType, resourceId ?? pageType);
    } catch {
      // fire-and-forget: 기록 실패는 무시
    }

    return c.json({ ok: true } as const, 200);
  });

  app.openapi(getPageViewStatsRoute, async (c): Promise<any> => {
    const actorResult = await requireActor(c, dependencies);
    if ("response" in actorResult) {
      return actorResult.response;
    }

    if (!can(actorResult.actor.role, "user", "read")) {
      return forbidden(c);
    }

    const stats = await dependencies.getDataService(c).getPageViewStats();
    return ok(c, stats);
  });
};
