import { describe, expect, it, vi } from "vitest";
import { DashboardPageViewStatsEntity } from "../lib/services/types";
import {
  IDs,
  createActor,
  createDataServiceMock,
  createTestApp,
  expectErrorCode,
  readJson,
} from "./test-helpers";

describe("Dashboard Page View Stats API", () => {
  it("관리자는 대시보드 통계를 조회할 수 있다", async () => {
    const mockStats: DashboardPageViewStatsEntity = {
      today: { count: 10, prevCount: 5 },
      thisWeek: { count: 50, prevCount: 40 },
      dailyTrend: [{ date: "2026-05-16", count: 10 }],
    };

    const getDashboardPageViewStats = vi.fn(async () => mockStats);
    const dataService = createDataServiceMock({ getDashboardPageViewStats });
    
    const app = createTestApp({
      actor: createActor("president", "admin-id"),
      dataService,
    });

    const response = await app.request("/api/admin/page-views/dashboard");
    expect(response.status).toBe(200);

    const body = await readJson<{ data: DashboardPageViewStatsEntity }>(response);
    expect(body.data).toEqual(mockStats);
    expect(getDashboardPageViewStats).toHaveBeenCalled();
  });

  it("인증되지 않은 사용자는 대시보드 통계를 조회할 수 없다", async () => {
    const app = createTestApp({
      actor: createActor("unverified", "user-id"),
      dataService: createDataServiceMock(),
    });

    const response = await app.request("/api/admin/page-views/dashboard");
    expect(response.status).toBe(403);
  });

  it("비로그인 사용자는 대시보드 통계를 조회할 수 없다", async () => {
    const app = createTestApp({
      actor: null,
      dataService: createDataServiceMock(),
    });

    const response = await app.request("/api/admin/page-views/dashboard");
    expect(response.status).toBe(401);
  });

  it.each(["new_member", "associate_member", "regular_member"] as const)(
    "일반 회원 역할 %s는 대시보드 방문 통계 서비스를 호출할 수 없다",
    async (role) => {
      const getDashboardPageViewStats = vi.fn(async () => ({
        today: { count: 0, prevCount: 0 },
        thisWeek: { count: 0, prevCount: 0 },
        dailyTrend: [],
      }));
      const app = createTestApp({
        actor: createActor(role, IDs.member),
        dataService: createDataServiceMock({ getDashboardPageViewStats }),
      });

      const response = await app.request("/api/admin/page-views/dashboard");

      expect(response.status).toBe(403);
      await expectErrorCode(response, "FORBIDDEN");
      expect(getDashboardPageViewStats).not.toHaveBeenCalled();
    },
  );
});
