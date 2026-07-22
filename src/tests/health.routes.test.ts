import { beforeEach, describe, expect, it, vi } from "vitest";

const runInfrastructureHealthChecksMock = vi.hoisted(() =>
  vi.fn(async () => ({
    status: "healthy" as const,
    checkedAt: "2030-01-01T00:00:00.000Z",
    durationMs: 1,
    summary: {
      total: 1,
      healthy: 1,
      unhealthy: 0,
      skipped: 0,
    },
    checks: [
      {
        service: "d1" as const,
        binding: "db",
        status: "healthy" as const,
        detail: "SELECT 1 succeeded",
        latencyMs: 1,
      },
    ],
  })),
);

vi.mock("../lib/health/check", () => ({
  runInfrastructureHealthChecks: runInfrastructureHealthChecksMock,
}));

import {
  IDs,
  createActor,
  createTestApp,
  expectErrorCode,
  readJson,
} from "./test-helpers";

describe("health routes", () => {
  beforeEach(() => {
    runInfrastructureHealthChecksMock.mockClear();
  });

  it("공개 liveness는 인프라 점검 함수나 상세 binding 정보를 사용하지 않는다", async () => {
    const app = createTestApp({ actor: null });

    const response = await app.request("/health");

    expect(response.status).toBe(200);
    const body = await readJson<{
      status: string;
      summary: Record<string, number>;
      checks: unknown[];
    }>(response);
    expect(body.status).toBe("healthy");
    expect(body.summary).toEqual({
      total: 0,
      healthy: 0,
      unhealthy: 0,
      skipped: 0,
    });
    expect(body.checks).toEqual([]);
    expect(JSON.stringify(body)).not.toContain('"binding"');
    expect(JSON.stringify(body)).not.toContain('"detail"');
    expect(runInfrastructureHealthChecksMock).not.toHaveBeenCalled();
  });

  it("인증되지 않은 요청은 401이며 인프라 점검을 실행하지 않는다", async () => {
    const app = createTestApp({ actor: null });

    const response = await app.request("/api/health/readiness");

    expect(response.status).toBe(401);
    await expectErrorCode(response, "UNAUTHORIZED");
    expect(runInfrastructureHealthChecksMock).not.toHaveBeenCalled();
  });

  it("일반 회원 요청은 403이며 인프라 점검을 실행하지 않는다", async () => {
    const app = createTestApp({
      actor: createActor("regular_member", IDs.member),
    });

    const response = await app.request("/api/health/readiness");

    expect(response.status).toBe(403);
    await expectErrorCode(response, "FORBIDDEN");
    expect(runInfrastructureHealthChecksMock).not.toHaveBeenCalled();
  });

  it.each([
    ["manager", IDs.manager],
    ["vice_president", IDs.vicePresident],
    ["president", IDs.president],
  ] as const)("%s 역할은 상세 readiness를 조회할 수 있다", async (role, id) => {
    const app = createTestApp({ actor: createActor(role, id) });

    const response = await app.request("/api/health/readiness");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "no-store, no-cache, must-revalidate",
    );
    const body = await readJson<{
      status: string;
      checks: Array<{ binding: string; detail: string }>;
    }>(response);
    expect(body.status).toBe("healthy");
    expect(body.checks).toEqual([
      expect.objectContaining({
        binding: "db",
        detail: "SELECT 1 succeeded",
      }),
    ]);
    expect(runInfrastructureHealthChecksMock).toHaveBeenCalledTimes(1);
  });
});
