import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { generations } from "../platform/db/schema";

const createDBMock = vi.hoisted(() => vi.fn());

vi.mock("../lib/db", () => ({
  default: createDBMock,
}));

import { createDbDataService } from "../platform/db/data-service-composition";

const createMockDb = () => {
  const findFirst = vi.fn(async () => undefined as { id: string } | undefined);
  const insertValues = vi.fn(async () => undefined);
  const insert = vi.fn(() => ({ values: insertValues }));
  const deleteWhere = vi.fn(async () => undefined);
  const remove = vi.fn(() => ({ where: deleteWhere }));

  return {
    db: {
      query: {
        generations: {
          findFirst,
        },
      },
      insert,
      delete: remove,
    },
    findFirst,
    insert,
    insertValues,
    remove,
  };
};

describe("db service generations create", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    createDBMock.mockReset();
  });

  it("활성 상태의 같은 이름 기수는 기존 데이터를 삭제하지 않고 충돌로 거부한다", async () => {
    const mockDb = createMockDb();
    mockDb.findFirst.mockResolvedValueOnce({ id: "active-generation-id" });
    createDBMock.mockReturnValue(mockDb.db as never);

    const service = createDbDataService({} as D1Database);
    vi.spyOn(crypto, "randomUUID").mockReturnValue("new-generation-id");

    await expect(
      service.createGeneration({
        name: " 60기 ",
        sortOrder: 60,
        startDate: Date.parse("2030-01-01T00:00:00.000Z"),
        endDate: Date.parse("2030-12-31T00:00:00.000Z"),
      }),
    ).rejects.toThrow("UNIQUE constraint failed: generations.name");

    const findOptions = (mockDb.findFirst.mock.calls as unknown[][])[0]?.[0] as {
      where: SQL;
    };
    const query = new SQLiteSyncDialect().sqlToQuery(findOptions.where);
    expect(query.sql).toContain('"generations"."deleted_at" is null');
    expect(mockDb.remove).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("동일 이름의 soft-deleted archive는 보존하고 새 활성 기수를 생성한다", async () => {
    const mockDb = createMockDb();
    mockDb.findFirst.mockResolvedValueOnce(undefined);
    createDBMock.mockReturnValue(mockDb.db as never);

    const service = createDbDataService({} as D1Database);
    Object.assign(service, {
      getGenerationById: vi.fn(async () => ({
        id: "new-generation-id",
        name: "61기",
        sortOrder: 61,
        startDate: new Date("2031-01-01T00:00:00.000Z"),
        endDate: new Date("2031-12-31T00:00:00.000Z"),
        createdAt: new Date("2031-01-01T00:00:00.000Z"),
        updatedAt: new Date("2031-01-01T00:00:00.000Z"),
        updatedBy: null,
      })),
    });
    vi.spyOn(crypto, "randomUUID").mockReturnValue("new-generation-id");

    await service.createGeneration({
      name: "61기",
      sortOrder: 61,
      startDate: Date.parse("2031-01-01T00:00:00.000Z"),
      endDate: Date.parse("2031-12-31T00:00:00.000Z"),
    });

    expect(mockDb.remove).not.toHaveBeenCalled();
    expect(mockDb.insert).toHaveBeenCalledWith(generations);
    expect(mockDb.insertValues).toHaveBeenCalledWith({
      id: "new-generation-id",
      name: "61기",
      sortOrder: 61,
      startDate: new Date("2031-01-01T00:00:00.000Z"),
      endDate: new Date("2031-12-31T00:00:00.000Z"),
    });
  });
});
