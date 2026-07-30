import { describe, expect, it, vi } from "vitest";
import worker from "../../src/index";
import type { Bindings } from "../../src/bindings/types";

describe("public API cached entrypoint", () => {
  it("공개 GET 요청만 인증 헤더를 제거해 캐시 전용 entrypoint로 전달한다", async () => {
    const publicFetch = vi.fn(async (request: Request) => {
      expect(request.headers.get("authorization")).toBeNull();
      expect(request.headers.get("cookie")).toBeNull();
      expect(request.headers.get("origin")).toBe("https://yonyoung.yonsei.ac.kr");
      expect(request.headers.get("x-request-id")).toBe("incoming-request-id");

      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-request-id": "cached-request-id",
          "x-correlation-id": "cached-request-id",
          "x-response-time": "999ms",
        },
      });
    });
    const ctx = {
      exports: {
        PublicApi: {
          fetch: publicFetch,
        },
      },
    } as unknown as ExecutionContext;

    const response = await worker.fetch(
      new Request("https://api.example.com/api/public/activities", {
        headers: {
          authorization: "Bearer secret",
          cookie: "better-auth.session_token=session",
          origin: "https://yonyoung.yonsei.ac.kr",
          "x-request-id": "incoming-request-id",
        },
      }),
      {} as Bindings,
      ctx,
    );

    expect(publicFetch).toHaveBeenCalledTimes(1);
    expect(response.headers.get("x-request-id")).toBe("incoming-request-id");
    expect(response.headers.get("x-correlation-id")).toBe(
      "incoming-request-id",
    );
    expect(response.headers.get("x-response-time")).not.toBe("999ms");
    expect(response.headers.get("server-timing")).toMatch(/^total;dur=/);
  });
});
