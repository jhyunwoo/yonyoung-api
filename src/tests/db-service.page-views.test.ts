import type { SQL } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { activities, pageViews } from "../platform/db/schema";

const createDBMock = vi.hoisted(() => vi.fn());

vi.mock("../lib/db", () => ({
  default: createDBMock,
}));

import { createDbDataService } from "../platform/db/data-service-composition";

const createMockDb = () => {
  const onConflictDoUpdate = vi.fn(async () => undefined);
  const values = vi.fn(() => ({ onConflictDoUpdate }));
  const insert = vi.fn(() => ({ values }));

  const limit = vi.fn(async () => [{ id: "active-resource" }]);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));

  return {
    db: { insert, select },
    insert,
    values,
    onConflictDoUpdate,
    select,
    from,
    where,
    limit,
  };
};

describe("db service page-view persistence", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    createDBMock.mockReset();
  });

  it("동일 KST 일자와 리소스는 결정적 ID로 upsert한다", async () => {
    const mockDb = createMockDb();
    createDBMock.mockReturnValue(mockDb.db);
    vi.spyOn(Date, "now").mockReturnValue(
      Date.parse("2030-01-02T01:23:45.000Z"),
    );
    const service = createDbDataService({} as D1Database);

    await service.recordPageView("activity", "resource-1");
    await service.recordPageView("activity", "resource-1");

    expect(mockDb.insert).toHaveBeenCalledWith(pageViews);
    expect(mockDb.values).toHaveBeenCalledTimes(2);
    const valueCalls = mockDb.values.mock.calls as unknown[][];
    const first = valueCalls[0]?.[0];
    const second = valueCalls[1]?.[0];
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      id: "daily:activity:resource-1:1893510000000",
      pageType: "activity",
      resourceId: "resource-1",
      viewCount: 1,
      visitedAt: new Date("2030-01-01T15:00:00.000Z"),
    });
    expect(mockDb.onConflictDoUpdate).toHaveBeenCalledTimes(2);
    const conflictCalls = mockDb.onConflictDoUpdate.mock.calls as unknown[][];
    expect(conflictCalls[0]?.[0]).toMatchObject({
      target: pageViews.id,
    });
  });

  it("singleton 페이지 ID를 고정값으로 정규화한다", async () => {
    const mockDb = createMockDb();
    createDBMock.mockReturnValue(mockDb.db);
    vi.spyOn(Date, "now").mockReturnValue(
      Date.parse("2030-01-02T01:23:45.000Z"),
    );
    const service = createDbDataService({} as D1Database);

    await service.recordPageView("home", "attacker-controlled-id");

    const valueCalls = mockDb.values.mock.calls as unknown[][];
    expect(valueCalls[0]?.[0]).toMatchObject({
      id: "daily:home:home:1893510000000",
      resourceId: "home",
    });
  });

  it("활성 리소스 조회는 soft-deleted 행을 제외한다", async () => {
    const mockDb = createMockDb();
    createDBMock.mockReturnValue(mockDb.db);
    const service = createDbDataService({} as D1Database);

    await expect(
      service.isActiveViewResource("activity", "resource-1"),
    ).resolves.toBe(true);

    expect(mockDb.from).toHaveBeenCalledWith(activities);
    const whereCalls = mockDb.where.mock.calls as unknown[][];
    const predicate = whereCalls[0]?.[0] as SQL;
    const query = new SQLiteSyncDialect().sqlToQuery(predicate);
    expect(query.sql).toContain('"activities"."id" = ?');
    expect(query.sql).toContain('"activities"."deleted_at" is null');
  });
});
