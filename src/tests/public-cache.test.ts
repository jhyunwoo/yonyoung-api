import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PUBLIC_CACHE_CONTROL,
  respondWithPublicCache,
  withPublicCacheHeaders,
} from "../lib/http/public-cache";
import type HonoAppType from "../types/honoAppType";
import type { Context } from "hono";

type WaitUntilCollector = {
  waitUntil: (promise: Promise<unknown>) => void;
  flush: () => Promise<void>;
  calledTimes: () => number;
};

const createWaitUntilCollector = (): WaitUntilCollector => {
  const pending: Promise<unknown>[] = [];
  const waitUntilSpy = vi.fn((promise: Promise<unknown>) => {
    pending.push(promise.catch(() => undefined));
  });

  return {
    waitUntil: waitUntilSpy,
    flush: async () => {
      await Promise.all(pending);
    },
    calledTimes: () => waitUntilSpy.mock.calls.length,
  };
};

const createContext = (
  input?: {
    url?: string;
    headers?: HeadersInit;
    waitUntil?: (promise: Promise<unknown>) => void;
    kv?: KVNamespace;
  },
) => {
  const url = input?.url ?? "https://example.com/api/public/activities";
  const variables = new Map<string, unknown>();
  return {
    req: {
      url,
      raw: new Request(url, {
        headers: input?.headers,
      }),
    },
    executionCtx: input?.waitUntil
      ? {
          waitUntil: input.waitUntil,
        }
      : undefined,
    env: input?.kv
      ? {
          PUBLIC_API_CACHE: input.kv,
        }
      : {},
    set: (key: string, value: unknown) => {
      variables.set(key, value);
    },
    get: (key: string) => variables.get(key),
  } as unknown as Context<HonoAppType>;
};

const createCacheMock = () => ({
  match: vi.fn<() => Promise<Response | undefined>>(async () => undefined),
  put: vi.fn<(request: Request, response: Response) => Promise<void>>(
    async () => undefined,
  ),
  delete: vi.fn<(request: Request) => Promise<boolean>>(async () => true),
});

const createKvMock = () => {
  const store = new Map<string, string>();
  const get = vi.fn(async (key: string, options?: { type?: string }) => {
    const value = store.get(key);
    if (value === undefined) {
      return null;
    }
    return options?.type === "json" ? JSON.parse(value) : value;
  });
  const put = vi.fn(async (key: string, value: string) => {
    store.set(key, value);
  });

  return {
    binding: {
      get,
      put,
    } as unknown as KVNamespace,
    get,
    put,
    store,
  };
};

describe("public cache helpers", () => {
  const originalCaches = (globalThis as { caches?: unknown }).caches;

  afterEach(() => {
    (globalThis as { caches?: unknown }).caches = originalCaches;
    vi.restoreAllMocks();
  });

  it("cache.put 실패 시에도 정상 응답을 반환한다", async () => {
    const waitUntil = createWaitUntilCollector();
    (globalThis as { caches?: unknown }).caches = {
      default: {
        match: vi.fn(async () => undefined),
        put: vi.fn(async () => {
          throw new Error("cache write failed");
        }),
      },
    };

    const response = await respondWithPublicCache(
      createContext({ waitUntil: waitUntil.waitUntil }),
      async () =>
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(PUBLIC_CACHE_CONTROL);
    expect(waitUntil.calledTimes()).toBe(1);

    await waitUntil.flush();
  });

  it("실패 응답은 cache-control 헤더를 주입하지 않는다", async () => {
    const response = withPublicCacheHeaders(
      new Response("boom", {
        status: 500,
      }),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBeNull();
  });

  it("캐시 hit 시 데이터 빌더를 다시 호출하지 않는다", async () => {
    const cached = new Response(JSON.stringify({ data: [{ id: "cached" }] }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": PUBLIC_CACHE_CONTROL,
        "x-public-cache-cached-at": `${Date.now()}`,
      },
    });

    const buildResponse = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ id: "fresh" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    (globalThis as { caches?: unknown }).caches = {
      default: {
        match: vi.fn(async () => cached.clone()),
        put: vi.fn(async () => undefined),
      },
    };

    const response = await respondWithPublicCache(createContext(), buildResponse);

    expect(response.status).toBe(200);
    expect(buildResponse).not.toHaveBeenCalled();
    expect(response.headers.get("x-public-cache-status")).toBe("hit");
    expect(response.headers.get("x-public-cache-source")).toBe("edge");

    const body = (await response.json()) as { data: Array<{ id: string }> };
    expect(body.data[0]?.id).toBe("cached");
  });

  it("stale 캐시는 즉시 반환하고 waitUntil로 백그라운드 재검증한다", async () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);

    const cacheMock = createCacheMock();
    const waitUntil = createWaitUntilCollector();

    const staleCached = new Response(JSON.stringify({ data: [{ id: "stale" }] }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": PUBLIC_CACHE_CONTROL,
        "x-public-cache-cached-at": `${now - 130_000}`,
      },
    });

    cacheMock.match.mockResolvedValueOnce(staleCached.clone());
    (globalThis as { caches?: unknown }).caches = {
      default: cacheMock,
    };

    const buildResponse = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ id: "fresh" }] }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
    );

    const response = await respondWithPublicCache(
      createContext({ waitUntil: waitUntil.waitUntil }),
      buildResponse,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-public-cache-status")).toBe("stale");
    expect(response.headers.get("x-public-cache-source")).toBe("edge");
    expect(await response.json()).toEqual({ data: [{ id: "stale" }] });
    expect(waitUntil.calledTimes()).toBe(1);

    await waitUntil.flush();

    expect(buildResponse).toHaveBeenCalledTimes(1);
    expect(cacheMock.put).toHaveBeenCalledTimes(1);
  });

  it("Authorization/Cookie 요청은 개인화 가능성이 있어 캐시를 우회한다", async () => {
    const cacheMock = createCacheMock();
    (globalThis as { caches?: unknown }).caches = {
      default: cacheMock,
    };

    const response = await respondWithPublicCache(
      createContext({
        headers: {
          cookie: "better-auth.session_token=session-token",
        },
      }),
      async () =>
        new Response(JSON.stringify({ data: [{ id: "fresh" }] }), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        }),
    );

    expect(response.status).toBe(200);
    expect(cacheMock.match).not.toHaveBeenCalled();
    expect(cacheMock.put).not.toHaveBeenCalled();
    expect(response.headers.get("x-public-cache-status")).toBe("bypass");
    expect(response.headers.get("x-public-cache-source")).toBe("bypass");
  });

  it("Set-Cookie를 포함한 응답은 캐시하지 않는다", async () => {
    const cacheMock = createCacheMock();
    const waitUntil = createWaitUntilCollector();
    (globalThis as { caches?: unknown }).caches = {
      default: cacheMock,
    };

    const response = await respondWithPublicCache(
      createContext({ waitUntil: waitUntil.waitUntil }),
      async () =>
        new Response(JSON.stringify({ data: [{ id: "fresh" }] }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "set-cookie": "sample-token=abc; Path=/; HttpOnly",
          },
        }),
    );

    expect(response.status).toBe(200);
    expect(waitUntil.calledTimes()).toBe(0);
    expect(cacheMock.put).not.toHaveBeenCalled();
    expect(response.headers.get("x-public-cache-status")).toBe("skip-store");
  });

  it("edge cache가 없는 리전에서도 KV hit로 D1 조회를 건너뛴다", async () => {
    const kv = createKvMock();
    const firstWaitUntil = createWaitUntilCollector();
    (globalThis as { caches?: unknown }).caches = undefined;

    const firstResponse = await respondWithPublicCache(
      createContext({
        kv: kv.binding,
        waitUntil: firstWaitUntil.waitUntil,
      }),
      async () =>
        new Response(JSON.stringify({ data: [{ id: "from-origin" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    expect(firstResponse.headers.get("x-public-cache-status")).toBe("miss");
    expect(firstResponse.headers.get("x-public-cache-source")).toBe("origin");
    expect(firstWaitUntil.calledTimes()).toBe(1);
    await firstWaitUntil.flush();
    expect(kv.put).toHaveBeenCalledTimes(1);

    const buildResponse = vi.fn(async () => new Response("unexpected"));
    const secondResponse = await respondWithPublicCache(
      createContext({ kv: kv.binding }),
      buildResponse,
    );

    expect(buildResponse).not.toHaveBeenCalled();
    expect(secondResponse.headers.get("x-public-cache-status")).toBe("hit");
    expect(secondResponse.headers.get("x-public-cache-source")).toBe("kv");
    expect(await secondResponse.json()).toEqual({
      data: [{ id: "from-origin" }],
    });
  });

  it("KV hit를 현재 리전의 edge cache에 백필한다", async () => {
    const kv = createKvMock();
    const seedWaitUntil = createWaitUntilCollector();
    (globalThis as { caches?: unknown }).caches = undefined;

    await respondWithPublicCache(
      createContext({
        kv: kv.binding,
        waitUntil: seedWaitUntil.waitUntil,
      }),
      async () =>
        new Response(JSON.stringify({ data: [{ id: "kv-cached" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    await seedWaitUntil.flush();

    const edgeCache = createCacheMock();
    const backfillWaitUntil = createWaitUntilCollector();
    (globalThis as { caches?: unknown }).caches = {
      default: edgeCache,
    };
    const buildResponse = vi.fn(async () => new Response("unexpected"));

    const response = await respondWithPublicCache(
      createContext({
        kv: kv.binding,
        waitUntil: backfillWaitUntil.waitUntil,
      }),
      buildResponse,
    );

    expect(buildResponse).not.toHaveBeenCalled();
    expect(response.headers.get("x-public-cache-source")).toBe("kv");
    expect(backfillWaitUntil.calledTimes()).toBe(1);
    await backfillWaitUntil.flush();
    expect(edgeCache.put).toHaveBeenCalledTimes(1);
  });

  it("KV 장애나 손상 데이터는 원본 응답으로 안전하게 폴백한다", async () => {
    const kv = createKvMock();
    kv.get.mockResolvedValueOnce({ version: 999 });
    const buildResponse = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ id: "fresh" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    (globalThis as { caches?: unknown }).caches = undefined;

    const response = await respondWithPublicCache(
      createContext({ kv: kv.binding }),
      buildResponse,
    );

    expect(buildResponse).toHaveBeenCalledTimes(1);
    expect(response.headers.get("x-public-cache-source")).toBe("origin");
    expect(await response.json()).toEqual({ data: [{ id: "fresh" }] });
  });

  it("개인화 가능 요청은 KV도 조회하거나 기록하지 않는다", async () => {
    const kv = createKvMock();
    (globalThis as { caches?: unknown }).caches = undefined;

    const response = await respondWithPublicCache(
      createContext({
        headers: { authorization: "Bearer example-token" },
        kv: kv.binding,
      }),
      async () =>
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    expect(response.headers.get("x-public-cache-status")).toBe("bypass");
    expect(kv.get).not.toHaveBeenCalled();
    expect(kv.put).not.toHaveBeenCalled();
  });
});
