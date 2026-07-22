import type { SQL } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generations, session, user } from "../lib/db/schema";

const createDBMock = vi.hoisted(() => vi.fn());

vi.mock("../lib/db", () => ({
  default: createDBMock,
}));

import { createDbDataService } from "../lib/services/db-service";

const toSql = (value: unknown): string =>
  new SQLiteSyncDialect().sqlToQuery(value as SQL).sql;

const createMockDb = () => {
  const updateQuery = { kind: "soft-delete-user" };
  const sessionDeleteQuery = { kind: "delete-user-sessions" };
  const returning = vi.fn(() => updateQuery);
  const updateWhere = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set }));
  const deleteWhere = vi.fn(() => sessionDeleteQuery);
  const remove = vi.fn(() => ({ where: deleteWhere }));
  const batch = vi.fn();

  return {
    db: {
      query: {},
      update,
      delete: remove,
      batch,
    },
    updateQuery,
    sessionDeleteQuery,
    returning,
    updateWhere,
    set,
    update,
    deleteWhere,
    remove,
    batch,
  };
};

describe("db service user deletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createDBMock.mockReset();
  });

  it("사용자 soft-delete와 모든 Better Auth session 삭제를 한 batch로 실행한다", async () => {
    const mockDb = createMockDb();
    mockDb.batch.mockResolvedValue([[{ id: "user-1" }], { success: true }]);
    createDBMock.mockReturnValue(mockDb.db);
    const service = createDbDataService({} as D1Database);

    await expect(service.deleteUser("user-1")).resolves.toBe(true);

    expect(mockDb.update).toHaveBeenCalledWith(user);
    expect(mockDb.remove).toHaveBeenCalledWith(session);
    expect(mockDb.batch).toHaveBeenCalledTimes(1);
    expect(mockDb.batch).toHaveBeenCalledWith([
      mockDb.updateQuery,
      mockDb.sessionDeleteQuery,
    ]);
    const timestamps = (mockDb.set.mock.calls as unknown[][])[0]?.[0] as {
      deletedAt: Date;
      updatedAt: Date;
    };
    expect(timestamps.deletedAt).toBe(timestamps.updatedAt);
    expect(toSql((mockDb.updateWhere.mock.calls as unknown[][])[0]?.[0])).toContain(
      '"user"."deleted_at" is null',
    );
    expect(toSql((mockDb.deleteWhere.mock.calls as unknown[][])[0]?.[0])).toContain(
      '"session"."user_id" = ?',
    );
  });

  it("활성 사용자 행이 없으면 session 정리 batch를 유지하면서 false를 반환한다", async () => {
    const mockDb = createMockDb();
    mockDb.batch.mockResolvedValue([[], { success: true }]);
    createDBMock.mockReturnValue(mockDb.db);
    const service = createDbDataService({} as D1Database);

    await expect(service.deleteUser("missing-user")).resolves.toBe(false);

    expect(mockDb.batch).toHaveBeenCalledWith([
      mockDb.updateQuery,
      mockDb.sessionDeleteQuery,
    ]);
  });
});

describe("db service generation lifecycle scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createDBMock.mockReset();
  });

  it("삭제된 세대 ID만 전달되면 legacy 사용자 포인터를 조회하지 않는다", async () => {
    const orderBy = vi.fn().mockResolvedValue([]);
    const where = vi.fn(() => ({ orderBy }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    createDBMock.mockReturnValue({ query: {}, select });
    const service = createDbDataService({} as D1Database);

    await expect(
      service.listUsersByGenerationIds(["deleted-generation"]),
    ).resolves.toEqual([]);

    expect(select).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith(generations);
  });
});
