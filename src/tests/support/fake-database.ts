import { getTableName, type Table } from "drizzle-orm";
import { vi } from "vitest";

type Row = Record<string, unknown>;

type RecordedWrite = {
  table: string;
  values: Row;
};

/**
 * feature repository는 Drizzle 쿼리 빌더만 사용한다. 여기서는 그 빌더의 형태만 흉내 내고
 * 결과는 테이블별 큐에서 꺼내 준다. 실제 SQL을 검증하지는 않지만, soft delete 연쇄나
 * 정렬/일괄 처리 같은 "어떤 write를 몇 번 하는가"는 그대로 고정할 수 있다.
 */
export const createFakeDatabase = () => {
  const selectResults = new Map<string, Row[][]>();
  const findFirstResults = new Map<string, (Row | undefined)[]>();
  const inserts: RecordedWrite[] = [];
  const updates: RecordedWrite[] = [];

  const takeSelect = (table: string): Row[] => {
    const queue = selectResults.get(table);
    return queue && queue.length > 0 ? (queue.shift() ?? []) : [];
  };

  const takeFindFirst = (table: string): Row | undefined => {
    const queue = findFirstResults.get(table);
    return queue && queue.length > 0 ? queue.shift() : undefined;
  };

  const createSelectChain = (table: string) => {
    const rows = () => Promise.resolve(takeSelect(table));
    const chain: Record<string, unknown> = {};
    for (const method of ["where", "orderBy", "limit", "groupBy", "leftJoin", "innerJoin"]) {
      chain[method] = () => chain;
    }
    chain.then = (
      onFulfilled?: (value: Row[]) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => rows().then(onFulfilled, onRejected);
    return chain;
  };

  const queryNamespace = new Proxy(
    {},
    {
      get: (_target, key: string) => ({
        findFirst: vi.fn(() => Promise.resolve(takeFindFirst(key))),
      }),
    },
  );

  const db = {
    query: queryNamespace as Record<
      string,
      { findFirst: (input?: unknown) => Promise<Row | undefined> }
    >,
    select: vi.fn(() => ({
      from: (table: Table) => createSelectChain(getTableName(table)),
    })),
    insert: vi.fn((table: Table) => ({
      values: vi.fn((values: Row | Row[]) => {
        for (const value of Array.isArray(values) ? values : [values]) {
          inserts.push({ table: getTableName(table), values: value });
        }
        return Promise.resolve(undefined);
      }),
    })),
    update: vi.fn((table: Table) => ({
      set: vi.fn((values: Row) => {
        updates.push({ table: getTableName(table), values });
        const chain = {
          where: () => Promise.resolve(undefined),
          then: (
            onFulfilled?: (value: undefined) => unknown,
            onRejected?: (reason: unknown) => unknown,
          ) => Promise.resolve(undefined).then(onFulfilled, onRejected),
        };
        return chain;
      }),
    })),
  };

  return {
    /** repository가 기대하는 Drizzle 인스턴스 자리에 그대로 넣는다. */
    db: db as never,
    inserts,
    updates,
    /** `select().from(table)` 결과를 호출 순서대로 큐에 넣는다. */
    queueSelect(table: Table, rows: Row[]) {
      const name = getTableName(table);
      const queue = selectResults.get(name) ?? [];
      queue.push(rows);
      selectResults.set(name, queue);
    },
    /** `query.<table>.findFirst()` 결과를 호출 순서대로 큐에 넣는다. */
    queueFindFirst(tableKey: string, row: Row | undefined) {
      const queue = findFirstResults.get(tableKey) ?? [];
      queue.push(row);
      findFirstResults.set(tableKey, queue);
    },
    updatesFor(table: string) {
      return updates.filter((update) => update.table === table);
    },
    insertsFor(table: string) {
      return inserts.filter((insert) => insert.table === table);
    },
  };
};

/** D1 batch/prepare 경로를 쓰는 일괄 이미지 추가용 최소 스텁. */
export const createFakeD1Database = () => {
  const batches: unknown[][] = [];
  const bound: unknown[][] = [];

  const database = {
    prepare: vi.fn(() => ({
      bind: vi.fn((...values: unknown[]) => {
        bound.push(values);
        return { statement: true };
      }),
    })),
    batch: vi.fn((statements: unknown[]) => {
      batches.push(statements);
      return Promise.resolve([]);
    }),
  };

  return { database: database as never, batches, bound };
};
