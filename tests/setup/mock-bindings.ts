import type { AppBindings } from "../../src/types/honoAppType";

type ViewCountRow = {
  resourceType: string;
  resourceId: string;
  viewCount: number;
};

const createMockD1PreparedStatement = (
  query: string,
  viewCounts: Map<string, ViewCountRow>,
): D1PreparedStatement => {
  const normalizedQuery = query.replace(/\s+/g, " ").trim().toLowerCase();
  let boundValues: unknown[] = [];
  const createKey = (resourceType: string, resourceId: string) =>
    `${resourceType}:${resourceId}`;

  const prepared = {
    bind: (...values: unknown[]) => {
      boundValues = values;
      return prepared as unknown as D1PreparedStatement;
    },
    first: async <T = Record<string, unknown>>() =>
      ({ result: 1 }) as unknown as T,
    run: async <T = Record<string, unknown>>() => {
      if (normalizedQuery.startsWith("insert into view_counts")) {
        const [resourceType, resourceId] = boundValues as [string, string];
        const key = createKey(resourceType, resourceId);
        const existing = viewCounts.get(key);
        viewCounts.set(key, {
          resourceType,
          resourceId,
          viewCount: (existing?.viewCount ?? 0) + 1,
        });
      }

      if (normalizedQuery.startsWith("delete from view_counts")) {
        const [resourceType, resourceId] = boundValues as [string, string];
        viewCounts.delete(createKey(resourceType, resourceId));
      }

      return createMockD1Result<T>();
    },
    all: async <T = Record<string, unknown>>() => {
      // 스키마 헬스 체크는 조회한 테이블이 모두 존재한다고 가정한다.
      if (normalizedQuery.includes("from sqlite_master")) {
        const rows = (boundValues as string[]).map((name) => ({ name }));
        return createMockD1Result(rows as T[]);
      }

      if (normalizedQuery.includes("from view_counts")) {
        const [resourceType, ...resourceIds] = boundValues as string[];
        const results = resourceIds
          .map((resourceId) =>
            viewCounts.get(createKey(resourceType, resourceId)),
          )
          .filter((row): row is ViewCountRow => Boolean(row))
          .map((row) => ({
            resource_id: row.resourceId,
            view_count: row.viewCount,
          }));

        return createMockD1Result(results as T[]);
      }

      return createMockD1Result<T>();
    },
    raw: async <T = unknown[]>(options?: { columnNames?: boolean }) => {
      if (options?.columnNames) {
        return [[]] as unknown as [string[], ...T[]];
      }

      return [] as unknown as T[];
    },
  };

  return prepared as unknown as D1PreparedStatement;
};

const createMockD1Result = <T>(results: T[] = []): D1Result<T> => {
  return {
    success: true,
    meta: { duration: 0, rows_read: 0, rows_written: 0 },
    results,
  } as unknown as D1Result<T>;
};

export const createMockD1Database = (): D1Database => {
  const viewCounts = new Map<string, ViewCountRow>();
  const database = {
    prepare: (query: string) =>
      createMockD1PreparedStatement(query, viewCounts),
    batch: async <T = unknown>(_statements: D1PreparedStatement[]) => [
      createMockD1Result<T>(),
    ],
    exec: async (_query: string) => ({ count: 0, duration: 0 }),
    dump: async () => new ArrayBuffer(0),
    withSession: (_bookmark?: D1SessionBookmark | D1SessionConstraint) =>
      ({
        prepare: (query: string) =>
          createMockD1PreparedStatement(query, viewCounts),
        batch: async <T = unknown>(_statements: D1PreparedStatement[]) => [
          createMockD1Result<T>(),
        ],
        getBookmark: () => "bookmark",
      }) as D1DatabaseSession,
  };

  return database as unknown as D1Database;
};

export const createMockR2Bucket = (): R2Bucket => {
  const store = new Map<string, string>();

  const bucket = {
    put: async (
      key: string,
      value:
        string | ArrayBuffer | ReadableStream | ArrayBufferView | Blob | null,
    ) => {
      const text = typeof value === "string" ? value : "value";
      store.set(key, text);
      return {
        key,
        size: text.length,
      } as R2Object;
    },
    head: async (key: string) => {
      if (!store.has(key)) {
        return null;
      }

      const value = store.get(key) ?? "";
      return {
        key,
        size: value.length,
      } as R2Object;
    },
    delete: async (key: string) => {
      store.delete(key);
    },
    // 커서/limit을 실제로 처리해 페이지네이션 경로를 재현한다.
    list: async (options?: R2ListOptions) => {
      const entries = Array.from(store.entries())
        .map(([key, value]) => ({ key, size: value.length }))
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

      const cursor = options?.cursor;
      const startIndex = cursor
        ? entries.findIndex((entry) => entry.key > cursor)
        : 0;
      const from = startIndex < 0 ? entries.length : startIndex;
      const limit = options?.limit ?? 1000;
      const page = entries.slice(from, from + limit);
      const truncated = from + limit < entries.length;

      return {
        objects: page as R2Object[],
        truncated,
        ...(truncated ? { cursor: page.at(-1)?.key } : {}),
        delimitedPrefixes: [],
      } as R2Objects;
    },
    get: async (key: string) => {
      if (!store.has(key)) {
        return null;
      }

      return {
        key,
      } as R2ObjectBody;
    },
  };

  return bucket as unknown as R2Bucket;
};

const createMockAssetsFetcher = (): Fetcher => {
  return new Proxy(
    {
      fetch: async () => new Response(null, { status: 404 }),
    },
    {
      get: (target, property, receiver) => {
        if (Reflect.has(target, property)) {
          return Reflect.get(target, property, receiver);
        }

        return () => {
          throw new Error(
            `The RPC receiver does not implement the method "${String(property)}".`,
          );
        };
      },
    },
  ) as unknown as Fetcher;
};

export const createHealthyBindings = (): AppBindings => {
  return {
    db: createMockD1Database(),
    DB: createMockD1Database(),
    r2: createMockR2Bucket(),
    R2: createMockR2Bucket(),
    ASSETS: createMockAssetsFetcher(),
    PAGE_VIEW_RATE_LIMITER: {
      limit: async () => ({ success: true }),
    } as unknown as RateLimit,
    PERF_ANALYTICS: {
      writeDataPoint: () => undefined,
    } as unknown as AnalyticsEngineDataset,
    R2_S3_ENDPOINT: "https://example-account.r2.cloudflarestorage.com",
    R2_ACCESS_KEY_ID: "key",
    R2_SECRET_ACCESS_KEY: "secret",
    R2_BUCKET: "yonyoung-storage",
    R2_PUBLIC_BASE_URL: "https://storage.example.com",
    R2_PUBLIC_URL_SIGNING_SECRET:
      "test-public-url-signing-secret-at-least-32-chars",
    BETTER_AUTH_URL: "https://api.example.com",
    BETTER_AUTH_TRUSTED_ORIGINS: "https://app.example.com",
    BETTER_AUTH_SECRET: "test-better-auth-secret-with-at-least-32-chars",
    GOOGLE_CLIENT_ID: "test-google-client-id",
    GOOGLE_CLIENT_SECRET: "test-google-client-secret",
  } as AppBindings;
};
