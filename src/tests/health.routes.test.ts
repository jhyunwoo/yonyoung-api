import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HealthReport } from "../lib/health/check";

const runInfrastructureHealthChecksMock = vi.hoisted(() =>
  vi.fn(async (): Promise<HealthReport> => ({
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

vi.mock("../lib/health/check", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/health/check")>();
  return {
    ...actual,
    runInfrastructureHealthChecks: runInfrastructureHealthChecksMock,
  };
});

import {
  IDs,
  createActor,
  createTestApp,
  expectErrorCode,
  readJson,
} from "./test-helpers";

/** 점검 함수에 전달된 depth 옵션을 읽는다(테스트 환경에서 첫 인자 env는 undefined다). */
const readCheckDepth = (): unknown =>
  (runInfrastructureHealthChecksMock.mock.calls[0] as unknown[] | undefined)?.[1];

describe("health routes", () => {
  beforeEach(() => {
    runInfrastructureHealthChecksMock.mockClear();
  });

  it("공개 liveness는 실제 shallow 점검을 실행하고 상세 정보는 감춘다", async () => {
    const app = createTestApp({ actor: null });

    const response = await app.request("/health");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "no-store, no-cache, must-revalidate",
    );
    const body = await readJson<{
      status: string;
      summary: Record<string, number>;
      checks: Array<Record<string, unknown>>;
    }>(response);
    expect(body.status).toBe("healthy");
    expect(body.summary.total).toBeGreaterThan(0);
    expect(body.checks).toEqual([
      { service: "d1", status: "healthy", latencyMs: 1 },
    ]);
    // 인프라 구성이 공개 응답으로 새지 않아야 한다.
    expect(JSON.stringify(body)).not.toContain('"binding"');
    expect(JSON.stringify(body)).not.toContain('"detail"');
    expect(JSON.stringify(body)).not.toContain('"error"');
    expect(readCheckDepth()).toEqual({ depth: "shallow" });
  });

  it("공개 liveness는 점검 실패 시 503과 축약된 결과를 반환한다", async () => {
    runInfrastructureHealthChecksMock.mockResolvedValueOnce({
      status: "unhealthy" as const,
      checkedAt: "2030-01-01T00:00:00.000Z",
      durationMs: 4,
      summary: { total: 1, healthy: 0, unhealthy: 1, skipped: 0 },
      checks: [
        {
          service: "r2" as const,
          binding: "r2",
          status: "unhealthy" as const,
          detail: "R2 list 읽기 프로브",
          error: "R2 unavailable",
          latencyMs: 4,
        },
      ],
    });
    const app = createTestApp({ actor: null });

    const response = await app.request("/health");

    expect(response.status).toBe(503);
    const body = await readJson<{
      status: string;
      checks: Array<Record<string, unknown>>;
    }>(response);
    expect(body.status).toBe("unhealthy");
    expect(body.checks).toEqual([
      { service: "r2", status: "unhealthy", latencyMs: 4 },
    ]);
    expect(JSON.stringify(body)).not.toContain("R2 unavailable");
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
    expect(readCheckDepth()).toEqual({ depth: "deep" });
    expect(runInfrastructureHealthChecksMock).toHaveBeenCalledTimes(1);
  });

  it("공개 liveness는 짧은 시간 내 반복 호출에서 점검을 재실행하지 않는다", async () => {
    const app = createTestApp({ actor: null });

    await app.request("/health");
    await app.request("/health");

    expect(runInfrastructureHealthChecksMock).toHaveBeenCalledTimes(1);
  });
});
