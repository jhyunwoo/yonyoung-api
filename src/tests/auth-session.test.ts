import type { SQL } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createAuthMock = vi.hoisted(() => vi.fn());
const getSessionMock = vi.hoisted(() => vi.fn());
const getDbClientMock = vi.hoisted(() => vi.fn());
const resolveD1DatabaseMock = vi.hoisted(() => vi.fn());

vi.mock("../lib/auth", () => ({
  createAuth: createAuthMock,
}));

vi.mock("../lib/db/factory", () => ({
  getDbClient: getDbClientMock,
}));

vi.mock("../infra/db/client", () => ({
  resolveD1Database: resolveD1DatabaseMock,
}));

import { getActorFromSession } from "../lib/auth/session";

const database = {} as D1Database;
const userQuery = { kind: "user-query" };
const membershipQuery = { kind: "membership-query" };
const legacyGenerationQuery = { kind: "legacy-generation-query" };

const activeUser = {
  id: "user-1",
  name: "사용자",
  familyName: "홍",
  givenName: "길동",
  email: "user@example.com",
  role: "regular_member",
  generationId: "legacy-generation",
};

const toSql = (value: unknown): string =>
  new SQLiteSyncDialect().sqlToQuery(value as SQL).sql;

const createQueryChain = (terminal: object) => {
  const chain: {
    from: ReturnType<typeof vi.fn>;
    innerJoin: ReturnType<typeof vi.fn>;
    where: ReturnType<typeof vi.fn>;
    orderBy: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
  } = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
  };

  chain.from.mockReturnValue(chain);
  chain.innerJoin.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(terminal);
  chain.limit.mockReturnValue(terminal);
  return chain;
};

const createDbMock = () => {
  const findFirst = vi.fn(() => userQuery);
  const membershipChain = createQueryChain(membershipQuery);
  const legacyChain = createQueryChain(legacyGenerationQuery);
  const select = vi
    .fn()
    .mockReturnValueOnce(membershipChain)
    .mockReturnValue(legacyChain);
  const batch = vi.fn();

  return {
    db: {
      query: { user: { findFirst } },
      select,
      batch,
    },
    findFirst,
    membershipChain,
    legacyChain,
    batch,
  };
};

const createContext = () =>
  ({
    env: { DB: database },
    req: {
      method: "GET",
      raw: { headers: new Headers() },
    },
  }) as unknown as Parameters<typeof getActorFromSession>[0];

describe("getActorFromSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveD1DatabaseMock.mockReturnValue(database);
    getSessionMock.mockResolvedValue({ user: { id: activeUser.id } });
    createAuthMock.mockReturnValue({ api: { getSession: getSessionMock } });
  });

  it("soft-deleted 사용자를 Actor 조회에서 제외한다", async () => {
    const mockDb = createDbMock();
    mockDb.batch.mockResolvedValue([undefined, [], []]);
    getDbClientMock.mockReturnValue(mockDb.db);

    await expect(getActorFromSession(createContext())).resolves.toBeNull();

    const userOptions = (mockDb.findFirst.mock.calls as unknown[][])[0]?.[0] as {
      where: SQL;
    };
    expect(toSql(userOptions.where)).toContain('"user"."deleted_at" is null');
  });

  it("legacy generationId는 활성 기수를 가리킬 때만 Actor에 반영한다", async () => {
    const mockDb = createDbMock();
    mockDb.batch.mockResolvedValue([activeUser, [], []]);
    getDbClientMock.mockReturnValue(mockDb.db);

    const actor = await getActorFromSession(createContext());

    expect(actor?.generationId).toBeNull();
    expect(actor?.generationIds).toEqual([]);
    const legacyWhere = (mockDb.legacyChain.where.mock.calls as unknown[][])[0]?.[0];
    expect(toSql(legacyWhere)).toContain('"user"."deleted_at" is null');
    expect(toSql(legacyWhere)).toContain('"generations"."deleted_at" is null');
  });

  it("user_generations 미존재 폴백도 활성 legacy 기수를 같은 batch로 조회한다", async () => {
    const mockDb = createDbMock();
    mockDb.batch
      .mockRejectedValueOnce(new Error("no such table: user_generations"))
      .mockResolvedValueOnce([
        activeUser,
        [{ generationId: "active-legacy-generation" }],
      ]);
    getDbClientMock.mockReturnValue(mockDb.db);

    const actor = await getActorFromSession(createContext());

    expect(actor?.generationId).toBe("active-legacy-generation");
    expect(actor?.generationIds).toEqual([]);
    expect(mockDb.batch).toHaveBeenNthCalledWith(2, [
      userQuery,
      legacyGenerationQuery,
    ]);
  });
});
