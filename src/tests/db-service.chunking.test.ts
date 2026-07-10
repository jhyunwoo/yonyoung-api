import { beforeEach, describe, expect, it, vi } from "vitest";

const createDBMock = vi.hoisted(() => vi.fn());

vi.mock("../lib/db", () => ({
  default: createDBMock,
}));

import { createDbDataService } from "../lib/services/db-service";

// D1 파라미터 제한(100개) 회귀 테스트: 유저 50명 시점에
// audit_logs 조회가 resourceType(1) + resourceId(50) + createdAt(50) = 101개 파라미터로
// 실패했던 버그를 막기 위해, 대량 ID 목록이 45개 단위로 나뉘어 여러 쿼리로 실행되는지 검증한다.
const CHUNK_SIZE = 45;
const USER_COUNT = 120;
const EXPECTED_CHUNKS = Math.ceil(USER_COUNT / CHUNK_SIZE); // 3

type SelectCall = {
  kind: "no-fields" | "audit-latest" | "audit-actor" | "user-generations" | "other";
};

const createChunkTrackingDb = (options: {
  userRows: Array<Record<string, unknown>>;
  auditLatestRows: Array<{ resourceId: string; latestCreatedAt: number }>;
}) => {
  const selectCalls: SelectCall[] = [];
  let userRowsServed = false;

  const select = vi.fn((fields?: Record<string, unknown>) => {
    const kind: SelectCall["kind"] = !fields
      ? "no-fields"
      : "latestCreatedAt" in fields
        ? "audit-latest"
        : "actorName" in fields
          ? "audit-actor"
          : "userId" in fields && "generationId" in fields
            ? "user-generations"
            : "other";
    selectCalls.push({ kind });

    const resolveRows = (): unknown[] => {
      if (kind === "no-fields") {
        // 유저 본문 조회: 첫 청크에서 전체 행을 돌려주고 이후 청크는 빈 배열 (중복 방지)
        if (userRowsServed) {
          return [];
        }
        userRowsServed = true;
        return options.userRows;
      }
      if (kind === "audit-latest") {
        return options.auditLatestRows;
      }
      return [];
    };

    const chain: Record<string, unknown> = {};
    for (const method of ["from", "where", "groupBy", "leftJoin", "orderBy", "innerJoin"]) {
      chain[method] = vi.fn(() => chain);
    }
    chain.then = (
      onFulfilled: (rows: unknown[]) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(resolveRows()).then(onFulfilled, onRejected);
    return chain;
  });

  return { db: { select }, select, selectCalls };
};

const buildUserIds = (count: number): string[] =>
  Array.from({ length: count }, (_, index) => `user-${String(index).padStart(4, "0")}`);

const buildUserRows = (userIds: string[]) =>
  userIds.map((id) => ({
    id,
    name: `이름-${id}`,
    email: `${id}@example.com`,
    image: null,
    showcaseImageUrls: "[]",
    familyName: null,
    givenName: null,
    college: null,
    department: null,
    studentNumber: null,
    phoneNumber: null,
    collaborationAvailable: false,
    personalLink: null,
    role: "regular_member",
    generationId: null,
    latestGenerationSortOrder: null,
    createdAt: new Date("2030-01-01T00:00:00.000Z"),
    updatedAt: new Date("2030-01-01T00:00:00.000Z"),
    deletedAt: null,
  }));

describe("db service D1 파라미터 제한 청크 처리", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    createDBMock.mockReset();
  });

  it("listLatestAuditActors는 대량 resourceId를 45개 단위 쿼리로 나눈다", async () => {
    const userIds = buildUserIds(USER_COUNT);
    const mock = createChunkTrackingDb({
      userRows: [],
      auditLatestRows: userIds.map((id) => ({
        resourceId: id,
        latestCreatedAt: Date.parse("2030-01-01T00:00:00.000Z"),
      })),
    });
    createDBMock.mockReturnValue(mock.db as never);

    const service = createDbDataService({} as D1Database);
    const result = await service.listLatestAuditActors("user", userIds);

    const latestCalls = mock.selectCalls.filter((call) => call.kind === "audit-latest");
    const actorCalls = mock.selectCalls.filter((call) => call.kind === "audit-actor");
    expect(latestCalls).toHaveLength(EXPECTED_CHUNKS);
    expect(actorCalls).toHaveLength(EXPECTED_CHUNKS);
    expect(Object.keys(result)).toHaveLength(USER_COUNT);
  });

  it("listUsersByIds는 대량 userId 조회와 기수 매핑 조회를 모두 청크로 나눈다", async () => {
    const userIds = buildUserIds(USER_COUNT);
    const mock = createChunkTrackingDb({
      userRows: buildUserRows(userIds),
      auditLatestRows: [],
    });
    createDBMock.mockReturnValue(mock.db as never);

    const service = createDbDataService({} as D1Database);
    const users = await service.listUsersByIds(userIds);

    expect(users).toHaveLength(USER_COUNT);
    // 유저 본문 조회 청크
    const userSelectCalls = mock.selectCalls.filter((call) => call.kind === "no-fields");
    expect(userSelectCalls).toHaveLength(EXPECTED_CHUNKS);
    // user_generations 매핑 조회 청크 (유저 100명 이상에서 두 번째로 터지던 지점)
    const linkCalls = mock.selectCalls.filter((call) => call.kind === "user-generations");
    expect(linkCalls).toHaveLength(EXPECTED_CHUNKS);
    // updatedBy 계산용 audit 조회 청크
    const latestCalls = mock.selectCalls.filter((call) => call.kind === "audit-latest");
    expect(latestCalls).toHaveLength(EXPECTED_CHUNKS);
  });
});
