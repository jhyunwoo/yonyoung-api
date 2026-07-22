import { describe, expect, it, vi } from "vitest";
import {
  createD1ViewCountStore,
  createNoopViewCountStore,
  isValidViewResourceType,
  type ViewCountStore,
} from "../lib/views/view-counts";
import {
  IDs,
  createDataServiceMock,
  createTestApp,
  readJson,
} from "./test-helpers";

type ViewCountRow = {
  resource_type: string;
  resource_id: string;
  view_count: number;
};

const createD1Result = <T>(results: T[] = []): D1Result<T> =>
  ({
    success: true,
    meta: { duration: 0, rows_read: 0, rows_written: 0 },
    results,
  }) as unknown as D1Result<T>;

const createViewCountD1Database = (): D1Database => {
  const counts = new Map<string, ViewCountRow>();

  const createKey = (resourceType: string, resourceId: string) =>
    `${resourceType}:${resourceId}`;

  const prepare = (query: string): D1PreparedStatement => {
    const normalizedQuery = query.replace(/\s+/g, " ").trim().toLowerCase();
    let boundValues: unknown[] = [];

    const statement = {
      bind: (...values: unknown[]) => {
        boundValues = values;
        return statement as unknown as D1PreparedStatement;
      },
      first: async <T = Record<string, unknown>>() => {
        if (normalizedQuery.startsWith("select 1")) {
          return { result: 1 } as T;
        }

        return null as T;
      },
      run: async <T = Record<string, unknown>>() => {
        if (normalizedQuery.startsWith("insert into view_counts")) {
          const [resourceType, resourceId] = boundValues as [string, string];
          const key = createKey(resourceType, resourceId);
          const existing = counts.get(key);

          counts.set(key, {
            resource_type: resourceType,
            resource_id: resourceId,
            view_count: (existing?.view_count ?? 0) + 1,
          });
        }

        if (normalizedQuery.startsWith("delete from view_counts")) {
          const [resourceType, resourceId] = boundValues as [string, string];
          counts.delete(createKey(resourceType, resourceId));
        }

        return createD1Result<T>();
      },
      all: async <T = Record<string, unknown>>() => {
        if (normalizedQuery.includes("from view_counts")) {
          const [resourceType, ...resourceIds] = boundValues as string[];
          const rows = resourceIds
            .map((resourceId) => counts.get(createKey(resourceType, resourceId)))
            .filter((row): row is ViewCountRow => Boolean(row))
            .map((row) => ({
              resource_id: row.resource_id,
              view_count: row.view_count,
            }));

          return createD1Result(rows as T[]);
        }

        return createD1Result<T>();
      },
      raw: async <T = unknown[]>(options?: { columnNames?: boolean }) => {
        if (options?.columnNames) {
          return ([[]] as unknown) as [string[], ...T[]];
        }

        return ([] as unknown) as T[];
      },
    };

    return statement as unknown as D1PreparedStatement;
  };

  return {
    prepare,
    batch: async <T = unknown>() => [createD1Result<T>()],
    exec: async () => ({ count: 0, duration: 0 }),
    dump: async () => new ArrayBuffer(0),
    withSession: () =>
      ({
        prepare,
        batch: async <T = unknown>() => [createD1Result<T>()],
        getBookmark: () => "bookmark",
      }) as unknown as D1DatabaseSession,
  } as unknown as D1Database;
};

describe("D1ViewCountStore", () => {
  it("D1 view_counts 테이블에 조회수를 누적 기록하고 조회한다", async () => {
    const store = createD1ViewCountStore(createViewCountD1Database());

    await store.recordView("activity", IDs.activity);
    await store.recordView("activity", IDs.activity);
    await store.recordView("exhibition", IDs.exhibition);

    await expect(
      store.getViewCounts("activity", [IDs.activity, IDs.exhibition]),
    ).resolves.toEqual({
      [IDs.activity]: 2,
    });
    await expect(
      store.getViewCounts("exhibition", [IDs.exhibition]),
    ).resolves.toEqual({
      [IDs.exhibition]: 1,
    });
  });

  it("빈 ID 목록 조회는 D1 쿼리 없이 빈 결과를 반환한다", async () => {
    const database = createViewCountD1Database();
    const prepare = vi.spyOn(database, "prepare");
    const store = createD1ViewCountStore(database);

    await expect(store.getViewCounts("activity", [])).resolves.toEqual({});
    expect(prepare).not.toHaveBeenCalled();
  });
});

describe("NoopViewCountStore", () => {
  it("기록과 조회를 안전하게 무시한다", async () => {
    const store = createNoopViewCountStore();

    await expect(store.recordView("activity", IDs.activity)).resolves.toBeUndefined();
    await expect(store.getViewCounts("activity", [IDs.activity])).resolves.toEqual(
      {},
    );
  });
});

describe("isValidViewResourceType", () => {
  it("허용된 리소스 타입만 유효하다", () => {
    expect(isValidViewResourceType("activity")).toBe(true);
    expect(isValidViewResourceType("exhibition")).toBe(true);
    expect(isValidViewResourceType("home")).toBe(true);
    expect(isValidViewResourceType("notice")).toBe(true);
    expect(isValidViewResourceType("unknown")).toBe(false);
    expect(isValidViewResourceType("")).toBe(false);
  });
});

describe("POST /api/public/views", () => {
  it("정상 요청 시 D1에 조회수를 기록하고 204를 반환한다", async () => {
    const database = createViewCountD1Database();
    const app = createTestApp({
      actor: null,
      dataService: createDataServiceMock({
        recordPageView: async () => undefined,
      }),
      viewCountStore: createD1ViewCountStore(database),
    });

    const firstResponse = await app.request(
      "/api/public/views",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resourceType: "activity",
          resourceId: IDs.activity,
        }),
      },
    );
    const secondResponse = await app.request(
      "/api/public/views",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resourceType: "activity",
          resourceId: IDs.activity,
        }),
      },
    );

    expect(firstResponse.status).toBe(204);
    expect(secondResponse.status).toBe(204);

    const store = createD1ViewCountStore(database);
    await expect(store.getViewCounts("activity", [IDs.activity])).resolves.toEqual({
      [IDs.activity]: 2,
    });
  });

  it("exhibition 타입 조회수도 기록할 수 있다", async () => {
    const recordView = vi.fn<(...args: Parameters<ViewCountStore["recordView"]>) => Promise<void>>(
      async () => undefined,
    );
    const viewCountStore: ViewCountStore = {
      recordView,
      getViewCounts: async () => ({}),
    };

    const app = createTestApp({
      actor: null,
      dataService: createDataServiceMock(),
      viewCountStore,
    });

    const response = await app.request("/api/public/views", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resourceType: "exhibition",
        resourceId: IDs.exhibition,
      }),
    });

    expect(response.status).toBe(204);
    expect(recordView).toHaveBeenCalledWith("exhibition", IDs.exhibition);
  });

  it("잘못된 resourceType이면 400을 반환한다", async () => {
    const app = createTestApp({
      actor: null,
      dataService: createDataServiceMock(),
    });

    const response = await app.request("/api/public/views", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resourceType: "invalid_type",
        resourceId: IDs.activity,
      }),
    });

    expect(response.status).toBe(400);
  });

  it("잘못된 resourceId이면 400을 반환한다", async () => {
    const app = createTestApp({
      actor: null,
      dataService: createDataServiceMock(),
    });

    const response = await app.request("/api/public/views", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resourceType: "activity",
        resourceId: "not-a-uuid",
      }),
    });

    expect(response.status).toBe(400);
  });

  it("비로그인 상태에서도 조회수를 기록할 수 있다", async () => {
    const recordView = vi.fn<(...args: Parameters<ViewCountStore["recordView"]>) => Promise<void>>(
      async () => undefined,
    );
    const app = createTestApp({
      actor: null,
      dataService: createDataServiceMock(),
      viewCountStore: {
        recordView,
        getViewCounts: async () => ({}),
      },
    });

    const response = await app.request("/api/public/views", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resourceType: "activity",
        resourceId: IDs.activity,
      }),
    });

    expect(response.status).toBe(204);
    expect(recordView).toHaveBeenCalledTimes(1);
  });

  it("존재하지 않거나 삭제된 리소스는 두 저장소 모두 갱신하지 않는다", async () => {
    const recordView = vi.fn(async () => undefined);
    const recordPageView = vi.fn(async () => undefined);
    const app = createTestApp({
      actor: null,
      dataService: createDataServiceMock({
        isActiveViewResource: async () => false,
        recordPageView,
      }),
      viewCountStore: {
        recordView,
        getViewCounts: async () => ({}),
      },
    });

    const response = await app.request("/api/public/views", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resourceType: "activity",
        resourceId: IDs.otherUuid,
      }),
    });

    expect(response.status).toBe(204);
    expect(recordView).not.toHaveBeenCalled();
    expect(recordPageView).not.toHaveBeenCalled();
  });

  it("activity/exhibition 요청에서 resourceId 누락을 거부한다", async () => {
    const app = createTestApp({
      actor: null,
      dataService: createDataServiceMock(),
    });

    const response = await app.request("/api/public/views", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resourceType: "activity" }),
    });

    expect(response.status).toBe(400);
  });

  it("rate limit을 초과하면 204를 유지하고 두 저장소 모두 갱신하지 않는다", async () => {
    const recordView = vi.fn(async () => undefined);
    const recordPageView = vi.fn(async () => undefined);
    const isActiveViewResource = vi.fn(async () => true);
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

    const response = await app.request("/api/public/views", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resourceType: "home" }),
    });

    expect(response.status).toBe(204);
    expect(isActiveViewResource).not.toHaveBeenCalled();
    expect(recordView).not.toHaveBeenCalled();
    expect(recordPageView).not.toHaveBeenCalled();
  });
});

describe("GET /api/public/views", () => {
  it("정상 조회 시 200과 리소스별 조회수를 반환한다", async () => {
    const getViewCounts = vi.fn(async () => ({
      [IDs.activity]: 42,
    }));
    const app = createTestApp({
      actor: null,
      dataService: createDataServiceMock(),
      viewCountStore: {
        recordView: async () => undefined,
        getViewCounts,
      },
    });

    const response = await app.request(
      `/api/public/views?resourceType=activity&resourceIds=${IDs.activity}`,
    );

    expect(response.status).toBe(200);

    const body = await readJson<{ data: Record<string, number> }>(response);
    expect(body.data[IDs.activity]).toBe(42);
    expect(getViewCounts).toHaveBeenCalledWith("activity", [IDs.activity]);
  });

  it("POST로 기록한 값을 GET에서 즉시 조회한다", async () => {
    const database = createViewCountD1Database();
    const app = createTestApp({
      actor: null,
      dataService: createDataServiceMock({
        recordPageView: async () => undefined,
      }),
      viewCountStore: createD1ViewCountStore(database),
    });

    await app.request(
      "/api/public/views",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resourceType: "activity",
          resourceId: IDs.activity,
        }),
      },
    );

    const response = await app.request(
      `/api/public/views?resourceType=activity&resourceIds=${IDs.activity},${IDs.otherUuid}`,
      undefined,
    );

    expect(response.status).toBe(200);
    const body = await readJson<{ data: Record<string, number> }>(response);
    expect(body.data).toEqual({
      [IDs.activity]: 1,
      [IDs.otherUuid]: 0,
    });
  });

  it("여러 리소스 ID를 쉼표로 구분하여 조회하고 중복 ID를 제거한다", async () => {
    const getViewCounts = vi.fn(async () => ({
      [IDs.activity]: 10,
      [IDs.exhibition]: 25,
    }));
    const app = createTestApp({
      actor: null,
      dataService: createDataServiceMock(),
      viewCountStore: {
        recordView: async () => undefined,
        getViewCounts,
      },
    });

    const response = await app.request(
      `/api/public/views?resourceType=activity&resourceIds=${IDs.activity},${IDs.exhibition},${IDs.activity}`,
    );

    expect(response.status).toBe(200);

    const body = await readJson<{ data: Record<string, number> }>(response);
    expect(body.data[IDs.activity]).toBe(10);
    expect(body.data[IDs.exhibition]).toBe(25);
    expect(getViewCounts).toHaveBeenCalledWith("activity", [
      IDs.activity,
      IDs.exhibition,
    ]);
  });

  it.each(["home", "notice"] as const)(
    "%s singleton 조회는 canonical 카운트를 요청 키에 매핑한다",
    async (resourceType) => {
      const getViewCounts = vi.fn(async () => ({ [resourceType]: 17 }));
      const app = createTestApp({
        actor: null,
        dataService: createDataServiceMock(),
        viewCountStore: {
          recordView: async () => undefined,
          getViewCounts,
        },
      });

      const response = await app.request(
        `/api/public/views?resourceType=${resourceType}&resourceIds=legacy-key,another-key`,
      );

      expect(response.status).toBe(200);
      const body = await readJson<{ data: Record<string, number> }>(response);
      expect(body.data).toEqual({
        "legacy-key": 17,
        "another-key": 17,
      });
      expect(getViewCounts).toHaveBeenCalledWith(resourceType, [resourceType]);
    },
  );

  it("resourceType 파라미터가 없으면 400을 반환한다", async () => {
    const app = createTestApp({
      actor: null,
      dataService: createDataServiceMock(),
    });

    const response = await app.request(
      `/api/public/views?resourceIds=${IDs.activity}`,
    );

    expect(response.status).toBe(400);
  });

  it("resourceIds 파라미터가 없으면 400을 반환한다", async () => {
    const app = createTestApp({
      actor: null,
      dataService: createDataServiceMock(),
    });

    const response = await app.request(
      "/api/public/views?resourceType=activity",
    );

    expect(response.status).toBe(400);
  });

  it("잘못된 resourceType이면 400을 반환한다", async () => {
    const app = createTestApp({
      actor: null,
      dataService: createDataServiceMock(),
    });

    const response = await app.request(
      `/api/public/views?resourceType=invalid&resourceIds=${IDs.activity}`,
    );

    expect(response.status).toBe(400);
  });

  it("잘못된 resourceIds 값이면 400을 반환한다", async () => {
    const app = createTestApp({
      actor: null,
      dataService: createDataServiceMock(),
    });

    const response = await app.request(
      "/api/public/views?resourceType=activity&resourceIds=not-a-uuid",
    );

    expect(response.status).toBe(400);
  });

  it("exhibition 타입 조회수도 조회할 수 있다", async () => {
    const getViewCounts = vi.fn(async () => ({
      [IDs.exhibition]: 99,
    }));
    const app = createTestApp({
      actor: null,
      dataService: createDataServiceMock(),
      viewCountStore: {
        recordView: async () => undefined,
        getViewCounts,
      },
    });

    const response = await app.request(
      `/api/public/views?resourceType=exhibition&resourceIds=${IDs.exhibition}`,
    );

    expect(response.status).toBe(200);

    const body = await readJson<{ data: Record<string, number> }>(response);
    expect(body.data[IDs.exhibition]).toBe(99);
    expect(getViewCounts).toHaveBeenCalledWith("exhibition", [IDs.exhibition]);
  });

  it("비로그인 상태에서도 조회수를 조회할 수 있다", async () => {
    const app = createTestApp({
      actor: null,
      dataService: createDataServiceMock(),
      viewCountStore: {
        recordView: async () => undefined,
        getViewCounts: async () => ({
          [IDs.activity]: 5,
        }),
      },
    });

    const response = await app.request(
      `/api/public/views?resourceType=activity&resourceIds=${IDs.activity}`,
    );

    expect(response.status).toBe(200);
    const body = await readJson<{ data: Record<string, number> }>(response);
    expect(body.data[IDs.activity]).toBe(5);
  });

  it("조회수 응답은 stale cache를 만들지 않도록 no-store를 반환한다", async () => {
    const app = createTestApp({
      actor: null,
      dataService: createDataServiceMock(),
      viewCountStore: {
        recordView: async () => undefined,
        getViewCounts: async () => ({}),
      },
    });

    const response = await app.request(
      `/api/public/views?resourceType=activity&resourceIds=${IDs.activity}`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
