import { afterEach, describe, expect, it, vi } from "vitest";
import { loggerMiddleware, logError } from "../middlewares/logger";
import type HonoAppType from "../types/honoAppType";
import type { Context } from "hono";

const createWaitUntilCollector = () => {
  const pending: Promise<unknown>[] = [];
  return {
    waitUntil: (promise: Promise<unknown>) => {
      pending.push(promise.catch(() => undefined));
    },
    flush: async () => {
      await Promise.all(pending);
    },
  };
};

const createContext = (input?: {
  requestId?: string;
  cacheStatus?: string;
  status?: number;
  headers?: HeadersInit;
}) => {
  const variables = new Map<string, unknown>([
    ["requestId", input?.requestId ?? "request-id-1"],
    ["startedAt", 10],
    ["cacheStatus", input?.cacheStatus ?? "miss"],
  ]);
  const waitUntil = createWaitUntilCollector();

  const context = {
    req: {
      method: "GET",
      path: "/api/public/activities",
      raw: new Request("https://example.com/api/public/activities", {
        headers: input?.headers,
      }),
    },
    res: new Response("ok", { status: input?.status ?? 200 }),
    executionCtx: {
      waitUntil: waitUntil.waitUntil,
    },
    set: (key: string, value: unknown) => {
      variables.set(key, value);
    },
    get: (key: string) => variables.get(key),
  } as unknown as Context<HonoAppType>;

  return {
    context,
    flushWaitUntil: waitUntil.flush,
  };
};

describe("logger middleware", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("요청/응답 로그를 구조화 JSON으로 기록하고 민감 헤더를 마스킹한다", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { context, flushWaitUntil } = createContext({
      cacheStatus: "hit",
      headers: {
        authorization: "Bearer secret-token",
        cookie: "session=abc",
        "user-agent": "vitest-agent",
      },
    });

    await loggerMiddleware(context, async () => undefined);
    await flushWaitUntil();

    expect(consoleSpy).toHaveBeenCalledTimes(2);
    const firstLog = JSON.parse(consoleSpy.mock.calls[0]?.[0] ?? "{}") as Record<
      string,
      unknown
    >;
    const secondLog = JSON.parse(consoleSpy.mock.calls[1]?.[0] ?? "{}") as Record<
      string,
      unknown
    >;

    expect(firstLog.event).toBe("request.received");
    expect(firstLog.requestId).toBe("request-id-1");
    expect((firstLog.headers as Record<string, string>).authorization).toBe(
      "[REDACTED]",
    );
    expect((firstLog.headers as Record<string, string>).cookie).toBe("[REDACTED]");

    expect(secondLog.event).toBe("request.completed");
    expect(secondLog.requestId).toBe("request-id-1");
    expect(secondLog.status).toBe(200);
    expect(secondLog.cacheStatus).toBe("hit");
  });

  it("에러 로그는 민감정보를 마스킹한다", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { context, flushWaitUntil } = createContext({
      requestId: "error-request-id",
    });

    logError(
      context as unknown as {
        req: { method: string; path: string };
        get: (key: "requestId") => string;
        executionCtx?: ExecutionContext;
      },
      new Error("failed with AUTHORIZATION=Bearer super-secret"),
    );
    await flushWaitUntil();

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const errorLog = JSON.parse(consoleSpy.mock.calls[0]?.[0] ?? "{}") as Record<
      string,
      unknown
    >;
    expect(errorLog.event).toBe("request.failed");
    expect(errorLog.requestId).toBe("error-request-id");
    expect(String(errorLog.message)).not.toContain("super-secret");
  });
});
