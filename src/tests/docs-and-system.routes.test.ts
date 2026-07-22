import { describe, expect, it } from "vitest";
import packageJson from "../../package.json";
import { createTestApp, expectErrorCode, readJson } from "./test-helpers";

describe("docs and system routes", /** describe 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @returns 함수 실행 결과를 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ () => {
  it("/api/openapi.json 생성 중 예외가 발생하면 500을 반환한다", /** it 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @returns 비동기 처리 결과를 Promise로 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ async () => {
    const app = createTestApp({
      actor: null,
      isDocsEnabled: true,
            /**
       * getAuthOpenApiSchema 값을 조회하거나 입력을 가공해 필요한 결과를 생성합니다.
       * @returns 조회/계산된 결과 값을 반환합니다.
       * @remarks 호출부와의 계약(입력 검증, null 처리, 에러 전파 규칙)을 일관되게 유지해야 합니다.
       */
      getAuthOpenApiSchema: async () => {
        throw new Error("auth openapi unavailable");
      },
    });

    const response = await app.request("/api/openapi.json");
    expect(response.status).toBe(500);
    await expectErrorCode(response, "INTERNAL_ERROR");
  });

  it("/health는 binding 점검 없이 얕은 liveness 결과만 반환한다", /** it 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @returns 비동기 처리 결과를 Promise로 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ async () => {
    const app = createTestApp({ actor: null, isDocsEnabled: true });

    const response = await app.request("/health");
    expect(response.status).toBe(200);
    expect(response.headers.get("server-timing")).toContain("total;dur=");
    expect(response.headers.get("x-response-time")).toMatch(/ms$/);
    expect(response.headers.get("cache-control")).toBe(
      "no-store, no-cache, must-revalidate",
    );
    const body = await readJson<{
      status: string;
      checkedAt: string;
      durationMs: number;
      checks: unknown[];
      summary: {
        total: number;
        healthy: number;
        unhealthy: number;
        skipped: number;
      };
    }>(response);
    expect(body.status).toBe("healthy");
    expect(Number.isNaN(Date.parse(body.checkedAt))).toBe(false);
    expect(body.durationMs).toBe(0);
    expect(body.summary).toEqual({
      total: 0,
      healthy: 0,
      unhealthy: 0,
      skipped: 0,
    });
    expect(body.checks).toEqual([]);
    expect(JSON.stringify(body)).not.toContain('"binding"');
    expect(JSON.stringify(body)).not.toContain('"detail"');
  });

  it("/는 API 메타 정보를 JSON으로 반환한다", async () => {
    const app = createTestApp({ actor: null, isDocsEnabled: true });

    const response = await app.request("/");
    expect(response.status).toBe(200);

    const body = await readJson<{
      status: string;
      api: string;
      version: string;
      serverTime: string;
    }>(response);

    expect(body.status).toBe("ok");
    expect(body.api).toBe("yonyoung-api");
    expect(body.version).toBe(packageJson.version);
    expect(Number.isNaN(Date.parse(body.serverTime))).toBe(false);
  });
});
