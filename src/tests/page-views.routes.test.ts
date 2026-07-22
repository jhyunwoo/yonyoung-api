import { describe, expect, it } from "vitest";
import {
  IDs,
  createActor,
  createDataServiceMock,
  createTestApp,
  expectErrorCode,
  fn,
  readJson,
} from "./test-helpers";

describe("page-views routes", () => {
  describe("POST /api/public/page-views", () => {
    it("홈 방문을 기록할 수 있다", async () => {
      const recordPageView = fn(async () => undefined);
      const app = createTestApp({
        actor: null,
        dataService: createDataServiceMock({ recordPageView }),
      });

      const response = await app.request("/api/public/page-views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageType: "home" }),
      });

      expect(response.status).toBe(200);
      const body = await readJson<{ ok: boolean }>(response);
      expect(body.ok).toBe(true);
      expect(recordPageView).toHaveBeenCalledWith("home", "home");
    });

    it("활동 방문을 기록할 수 있다", async () => {
      const recordPageView = fn(async () => undefined);
      const app = createTestApp({
        actor: createActor("regular_member", IDs.member),
        dataService: createDataServiceMock({ recordPageView }),
      });

      const response = await app.request("/api/public/page-views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageType: "activity", resourceId: IDs.activity }),
      });

      expect(response.status).toBe(200);
      const body = await readJson<{ ok: boolean }>(response);
      expect(body.ok).toBe(true);
      expect(recordPageView).toHaveBeenCalledWith("activity", IDs.activity);
    });

    it("전시 방문을 기록할 수 있다", async () => {
      const recordPageView = fn(async () => undefined);
      const app = createTestApp({
        actor: createActor("regular_member", IDs.member),
        dataService: createDataServiceMock({ recordPageView }),
      });

      const response = await app.request("/api/public/page-views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageType: "exhibition",
          resourceId: IDs.exhibition,
        }),
      });

      expect(response.status).toBe(200);
      const body = await readJson<{ ok: boolean }>(response);
      expect(body.ok).toBe(true);
      expect(recordPageView).toHaveBeenCalledWith("exhibition", IDs.exhibition);
    });

    it("인증 없이도 방문 기록이 가능하다", async () => {
      const recordPageView = fn(async () => undefined);
      const app = createTestApp({
        actor: null,
        dataService: createDataServiceMock({ recordPageView }),
      });

      const response = await app.request("/api/public/page-views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageType: "home" }),
      });

      expect(response.status).toBe(200);
      expect(recordPageView).toHaveBeenCalled();
    });

    it("잘못된 pageType이면 400 에러를 반환한다", async () => {
      const app = createTestApp({
        actor: null,
        dataService: createDataServiceMock(),
      });

      const response = await app.request("/api/public/page-views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageType: "invalid" }),
      });

      expect(response.status).toBe(400);
      await expectErrorCode(response, "BAD_REQUEST");
    });

    it("활동/전시는 유효한 UUID를 필수로 요구한다", async () => {
      const recordPageView = fn(async () => undefined);
      const app = createTestApp({
        actor: null,
        dataService: createDataServiceMock({ recordPageView }),
      });

      for (const payload of [
        { pageType: "activity" },
        { pageType: "exhibition", resourceId: "arbitrary-row-key" },
      ]) {
        const response = await app.request("/api/public/page-views", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        expect(response.status).toBe(400);
      }
      expect(recordPageView).not.toHaveBeenCalled();
    });

    it("존재하지 않거나 삭제된 리소스는 성공 응답만 반환하고 기록하지 않는다", async () => {
      const recordPageView = fn(async () => undefined);
      const recordView = fn(async () => undefined);
      const isActiveViewResource = fn(async () => false);
      const app = createTestApp({
        actor: null,
        dataService: createDataServiceMock({
          isActiveViewResource,
          recordPageView,
        }),
        viewCountStore: {
          recordView,
          getViewCounts: async () => ({}),
        },
      });

      const response = await app.request("/api/public/page-views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageType: "activity",
          resourceId: IDs.otherUuid,
        }),
      });

      expect(response.status).toBe(200);
      expect(isActiveViewResource).toHaveBeenCalledWith(
        "activity",
        IDs.otherUuid,
      );
      expect(recordPageView).not.toHaveBeenCalled();
      expect(recordView).not.toHaveBeenCalled();
    });

    it("singleton 페이지의 임의 resourceId는 고정 ID로 정규화한다", async () => {
      const recordPageView = fn(async () => undefined);
      const app = createTestApp({
        actor: null,
        dataService: createDataServiceMock({ recordPageView }),
      });

      const response = await app.request("/api/public/page-views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageType: "notice", resourceId: "random" }),
      });

      expect(response.status).toBe(200);
      expect(recordPageView).toHaveBeenCalledWith("notice", "notice");
    });

    it("rate limit을 초과하면 성공 응답을 유지하고 어떤 조회수도 기록하지 않는다", async () => {
      const recordPageView = fn(async () => undefined);
      const recordView = fn(async () => undefined);
      const isActiveViewResource = fn(async () => true);
      const app = createTestApp({
        actor: null,
        allowPageViewWrite: async () => false,
        dataService: createDataServiceMock({
          isActiveViewResource,
          recordPageView,
        }),
        viewCountStore: {
          recordView,
          getViewCounts: async () => ({}),
        },
      });

      const response = await app.request("/api/public/page-views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageType: "home" }),
      });

      expect(response.status).toBe(200);
      expect(isActiveViewResource).not.toHaveBeenCalled();
      expect(recordPageView).not.toHaveBeenCalled();
      expect(recordView).not.toHaveBeenCalled();
    });
  });

  describe("GET /api/admin/page-views/stats", () => {
    it("관리자는 방문 통계를 조회할 수 있다", async () => {
      const getPageViewStats = fn(async () => ({
        totalViews: 100,
        homeViews: 50,
        activityViews: 30,
        exhibitionViews: 20,
        noticeViews: 0,
        topActivities: [{ resourceId: "act-1", count: 10 }],
        topExhibitions: [{ resourceId: "exh-1", count: 5 }],
        dailyTrend: [{ date: "2030-01-01", count: 12 }],
      }));

      const app = createTestApp({
        actor: createActor("manager", IDs.manager),
        dataService: createDataServiceMock({ getPageViewStats }),
      });

      const response = await app.request("/api/admin/page-views/stats");
      expect(response.status).toBe(200);
      const body = await readJson<{
        data: {
          totalViews: number;
          homeViews: number;
          activityViews: number;
          exhibitionViews: number;
          topActivities: Array<{ resourceId: string; count: number }>;
          topExhibitions: Array<{ resourceId: string; count: number }>;
          dailyTrend: Array<{ date: string; count: number }>;
        };
      }>(response);
      expect(body.data.totalViews).toBe(100);
      expect(body.data.homeViews).toBe(50);
      expect(body.data.activityViews).toBe(30);
      expect(body.data.exhibitionViews).toBe(20);
      expect(body.data.topActivities).toEqual([
        { resourceId: "act-1", count: 10 },
      ]);
      expect(body.data.topExhibitions).toEqual([
        { resourceId: "exh-1", count: 5 },
      ]);
      expect(body.data.dailyTrend).toEqual([
        { date: "2030-01-01", count: 12 },
      ]);
      expect(getPageViewStats).toHaveBeenCalled();
    });

    it("인증되지 않은 사용자는 통계를 조회할 수 없다", async () => {
      const app = createTestApp({ actor: null });
      const response = await app.request("/api/admin/page-views/stats");
      expect(response.status).toBe(401);
      await expectErrorCode(response, "UNAUTHORIZED");
    });

    it("권한이 없는 사용자는 통계를 조회할 수 없다", async () => {
      const app = createTestApp({
        actor: createActor("unverified", IDs.member),
        dataService: createDataServiceMock(),
      });

      const response = await app.request("/api/admin/page-views/stats");
      expect(response.status).toBe(403);
      await expectErrorCode(response, "FORBIDDEN");
    });

    it.each(["new_member", "associate_member", "regular_member"] as const)(
      "일반 회원 역할 %s는 통계 집계 서비스를 호출할 수 없다",
      async (role) => {
        const getPageViewStats = fn(async () => ({
          totalViews: 0,
          homeViews: 0,
          activityViews: 0,
          exhibitionViews: 0,
          noticeViews: 0,
          topActivities: [],
          topExhibitions: [],
          dailyTrend: [],
        }));
        const app = createTestApp({
          actor: createActor(role, IDs.member),
          dataService: createDataServiceMock({ getPageViewStats }),
        });

        const response = await app.request("/api/admin/page-views/stats");

        expect(response.status).toBe(403);
        await expectErrorCode(response, "FORBIDDEN");
        expect(getPageViewStats).not.toHaveBeenCalled();
      },
    );
  });
});
