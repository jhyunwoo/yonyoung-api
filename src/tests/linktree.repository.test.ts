import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLinktreeRepository } from "../features/linktree/linktree.repository";
import { linktree, linktreeItems } from "../platform/db/schema";
import { createFakeDatabase } from "./support/fake-database";

const LINKTREE_ID = "50000000-0000-4000-8000-000000000001";
const ITEM_ID = "51000000-0000-4000-8000-000000000001";
const BASE_DATE = new Date("2030-01-01T00:00:00.000Z");

const linktreeRow = (overrides: Record<string, unknown> = {}) => ({
  id: LINKTREE_ID,
  name: "Yonyoung",
  createdAt: BASE_DATE,
  updatedAt: BASE_DATE,
  deletedAt: null,
  ...overrides,
});

const itemRow = (overrides: Record<string, unknown> = {}) => ({
  id: ITEM_ID,
  linktreeId: LINKTREE_ID,
  name: "Instagram",
  link: "https://instagram.com/yonyoung",
  createdAt: BASE_DATE,
  updatedAt: BASE_DATE,
  deletedAt: null,
  ...overrides,
});

const createRepository = () => {
  const fake = createFakeDatabase();
  return { fake, repository: createLinktreeRepository(fake.db) };
};

describe("linktree repository", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("목록 조회는 링크트리마다 하위 항목을 붙여 준다", async () => {
    const { fake, repository } = createRepository();
    fake.queueSelect(linktree, [linktreeRow()]);
    fake.queueSelect(linktreeItems, [itemRow()]);

    const result = await repository.listLinktrees();

    expect(result).toHaveLength(1);
    expect(result[0]?.items).toHaveLength(1);
    expect(result[0]?.items[0]?.updatedBy).toBeNull();
  });

  it("존재하지 않는 링크트리 조회는 null을 반환한다", async () => {
    const { fake, repository } = createRepository();
    fake.queueFindFirst("linktree", undefined);

    await expect(repository.getLinktreeById(LINKTREE_ID)).resolves.toBeNull();
  });

  it("링크트리를 생성하면 저장된 행을 다시 읽어 반환한다", async () => {
    const { fake, repository } = createRepository();
    vi.spyOn(crypto, "randomUUID").mockReturnValue(LINKTREE_ID);
    fake.queueFindFirst("linktree", linktreeRow());
    fake.queueSelect(linktreeItems, []);

    const created = await repository.createLinktree({ name: "Yonyoung" });

    expect(created.id).toBe(LINKTREE_ID);
    expect(fake.insertsFor("linktree")).toHaveLength(1);
  });

  it("존재하지 않는 링크트리 수정은 write 없이 null을 반환한다", async () => {
    const { fake, repository } = createRepository();
    fake.queueFindFirst("linktree", undefined);

    await expect(
      repository.updateLinktree(LINKTREE_ID, { name: "새 이름" }),
    ).resolves.toBeNull();
    expect(fake.updates).toHaveLength(0);
  });

  it("링크트리 수정은 전달된 필드만 갱신한다", async () => {
    const { fake, repository } = createRepository();
    fake.queueFindFirst("linktree", linktreeRow());
    fake.queueFindFirst("linktree", linktreeRow({ name: "새 이름" }));
    fake.queueSelect(linktreeItems, []);

    await repository.updateLinktree(LINKTREE_ID, { name: "새 이름" });

    expect(Object.keys(fake.updatesFor("linktree")[0]?.values ?? {}).sort()).toEqual([
      "name",
      "updatedAt",
    ]);
  });

  it("링크트리 삭제는 하위 항목까지 soft delete 한다", async () => {
    const { fake, repository } = createRepository();
    fake.queueFindFirst("linktree", linktreeRow());

    await expect(repository.deleteLinktree(LINKTREE_ID)).resolves.toBe(true);
    expect(fake.updatesFor("linktree")[0]?.values).toHaveProperty("deletedAt");
    expect(fake.updatesFor("linktree_items")[0]?.values).toHaveProperty(
      "deletedAt",
    );
  });

  it("존재하지 않는 링크트리 삭제는 아무것도 지우지 않는다", async () => {
    const { fake, repository } = createRepository();
    fake.queueFindFirst("linktree", undefined);

    await expect(repository.deleteLinktree(LINKTREE_ID)).resolves.toBe(false);
    expect(fake.updates).toHaveLength(0);
  });

  it("상위 링크트리가 없으면 항목을 추가하지 않는다", async () => {
    const { fake, repository } = createRepository();
    fake.queueFindFirst("linktree", undefined);

    await expect(
      repository.addLinktreeItem(LINKTREE_ID, {
        name: "Instagram",
        link: "https://instagram.com/yonyoung",
      }),
    ).resolves.toBeNull();
    expect(fake.insertsFor("linktree_items")).toHaveLength(0);
  });

  it("항목을 추가하면 상위 링크트리의 updatedAt도 갱신한다", async () => {
    const { fake, repository } = createRepository();
    vi.spyOn(crypto, "randomUUID").mockReturnValue(ITEM_ID);
    fake.queueFindFirst("linktree", linktreeRow());
    fake.queueFindFirst("linktreeItems", itemRow());

    const created = await repository.addLinktreeItem(LINKTREE_ID, {
      name: "Instagram",
      link: "https://instagram.com/yonyoung",
    });

    expect(created?.id).toBe(ITEM_ID);
    expect(fake.updatesFor("linktree")).toHaveLength(1);
  });

  it("존재하지 않는 항목 수정은 null을 반환한다", async () => {
    const { fake, repository } = createRepository();
    fake.queueFindFirst("linktreeItems", undefined);

    await expect(
      repository.updateLinktreeItem(LINKTREE_ID, ITEM_ID, { name: "새 이름" }),
    ).resolves.toBeNull();
  });

  it("항목 수정은 전달된 필드만 갱신하고 상위 링크트리를 갱신한다", async () => {
    const { fake, repository } = createRepository();
    fake.queueFindFirst("linktreeItems", itemRow());
    fake.queueFindFirst("linktreeItems", itemRow({ name: "새 이름" }));

    await repository.updateLinktreeItem(LINKTREE_ID, ITEM_ID, {
      name: "새 이름",
    });

    expect(
      Object.keys(fake.updatesFor("linktree_items")[0]?.values ?? {}).sort(),
    ).toEqual(["name", "updatedAt"]);
    expect(fake.updatesFor("linktree")).toHaveLength(1);
  });

  it("항목 삭제는 항목과 상위 링크트리를 함께 갱신한다", async () => {
    const { fake, repository } = createRepository();
    fake.queueFindFirst("linktreeItems", itemRow());

    await expect(
      repository.deleteLinktreeItem(LINKTREE_ID, ITEM_ID),
    ).resolves.toBe(true);
    expect(fake.updatesFor("linktree_items")[0]?.values).toHaveProperty(
      "deletedAt",
    );
    expect(fake.updatesFor("linktree")).toHaveLength(1);
  });

  it("존재하지 않는 항목 삭제는 false를 반환한다", async () => {
    const { fake, repository } = createRepository();
    fake.queueFindFirst("linktreeItems", undefined);

    await expect(
      repository.deleteLinktreeItem(LINKTREE_ID, ITEM_ID),
    ).resolves.toBe(false);
    expect(fake.updates).toHaveLength(0);
  });
});
