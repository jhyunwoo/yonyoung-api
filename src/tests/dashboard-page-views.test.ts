import { describe, expect, it, vi } from "vitest";
import { createDataServiceMock, createTestApp, readJson, createActor } from "./test-helpers";
import { DashboardPageViewStatsEntity } from "../lib/services/types";

describe("Dashboard Page View Stats API", () => {
  it("관리자는 대시보드 통계를 조회할 수 있다", async () => {
    const mockStats: DashboardPageViewStatsEntity = {
      today: { count: 10, prevCount: 5 },
      thisWeek: { count: 50, prevCount: 40 },
      dailyTrend: [{ date: "2026-05-16", count: 10 }]
    };

    const getDashboardPageViewStats = vi.fn(async () => mockStats);
    const dataService = createDataServiceMock({ getDashboardPageViewStats });
    
    const app = createTestApp({
      actor: createActor("president", "admin-id"),
      dataService
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
      dataService: createDataServiceMock()
    });

    const response = await app.request("/api/admin/page-views/dashboard");
    expect(response.status).toBe(403);
  });

  it("비로그인 사용자는 대시보드 통계를 조회할 수 없다", async () => {
    const app = createTestApp({
      actor: null,
      dataService: createDataServiceMock()
    });

    const response = await app.request("/api/admin/page-views/dashboard");
    expect(response.status).toBe(401);
  });
});
