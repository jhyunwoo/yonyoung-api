import { beforeEach, describe, expect, it, vi } from "vitest";
import { createExhibitionRepository } from "../features/exhibitions/exhibition.repository";
import { exhibitionImages, exhibitions } from "../platform/db/schema";
import {
  createFakeD1Database,
  createFakeDatabase,
} from "./support/fake-database";

const EXHIBITION_ID = "40000000-0000-4000-8000-000000000001";
const IMAGE_ID = "41000000-0000-4000-8000-000000000001";
const BASE_DATE = new Date("2030-01-01T00:00:00.000Z");

const exhibitionRow = (overrides: Record<string, unknown> = {}) => ({
  id: EXHIBITION_ID,
  title: "정기전",
  description: "설명",
  startDate: BASE_DATE,
  endDate: BASE_DATE,
  place: "아트홀",
  coverImageUrl: "https://example.com/cover.jpg",
  generationId: "10000000-0000-4000-8000-000000000001",
  createdAt: BASE_DATE,
  updatedAt: BASE_DATE,
  deletedAt: null,
  ...overrides,
});

const imageRow = (overrides: Record<string, unknown> = {}) => ({
  id: IMAGE_ID,
  exhibitionId: EXHIBITION_ID,
  imageUrl: "https://example.com/detail.jpg",
  sortOrder: 0,
  width: null,
  height: null,
  createdAt: BASE_DATE,
  updatedAt: BASE_DATE,
  deletedAt: null,
  ...overrides,
});

const createRepository = () => {
  const fake = createFakeDatabase();
  const d1 = createFakeD1Database();
  return {
    fake,
    d1,
    repository: createExhibitionRepository(fake.db, d1.database),
  };
};

describe("exhibition repository", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("목록 조회는 세부 이미지와 최근 수정자를 함께 붙여 준다", async () => {
    const { fake, repository } = createRepository();
    fake.queueSelect(exhibitions, [exhibitionRow()]);
    fake.queueSelect(exhibitionImages, [imageRow()]);
    // listLatestAuditActorsByResourceId가 감사 로그를 조회한다.
    const result = await repository.listExhibitions();

    expect(result).toHaveLength(1);
    expect(result[0]?.detailImages).toHaveLength(1);
    expect(result[0]?.updatedBy).toBeNull();
  });

  it("generationId를 넘기면 그 기수로 필터링한 조회를 수행한다", async () => {
    const { fake, repository } = createRepository();
    fake.queueSelect(exhibitions, []);

    await expect(
      repository.listExhibitions("10000000-0000-4000-8000-000000000001"),
    ).resolves.toEqual([]);
  });

  it("공개 목록은 별도 정렬로 조회한다", async () => {
    const { fake, repository } = createRepository();
    fake.queueSelect(exhibitions, [exhibitionRow()]);
    fake.queueSelect(exhibitionImages, []);

    const result = await repository.listPublicExhibitions();
    expect(result).toHaveLength(1);
  });

  it("존재하지 않는 전시 상세 조회는 null을 반환한다", async () => {
    const { fake, repository } = createRepository();
    fake.queueFindFirst("exhibitions", undefined);

    await expect(repository.getExhibitionById(EXHIBITION_ID)).resolves.toBeNull();
  });

  it("전시 생성 후 저장된 행을 다시 읽어 반환한다", async () => {
    const { fake, repository } = createRepository();
    vi.spyOn(crypto, "randomUUID").mockReturnValue(EXHIBITION_ID);
    fake.queueFindFirst("exhibitions", exhibitionRow());
    fake.queueSelect(exhibitionImages, []);

    const created = await repository.createExhibition({
      title: "정기전",
      description: "설명",
      startDate: BASE_DATE.getTime(),
      endDate: BASE_DATE.getTime(),
      place: "아트홀",
      coverImageUrl: "https://example.com/cover.jpg",
      generationId: "10000000-0000-4000-8000-000000000001",
    });

    expect(created.id).toBe(EXHIBITION_ID);
    expect(fake.insertsFor("exhibitions")).toHaveLength(1);
  });

  it("존재하지 않는 전시 수정은 write 없이 null을 반환한다", async () => {
    const { fake, repository } = createRepository();
    fake.queueFindFirst("exhibitions", undefined);

    await expect(
      repository.updateExhibition(EXHIBITION_ID, { title: "새 제목" }),
    ).resolves.toBeNull();
    expect(fake.updatesFor("exhibitions")).toHaveLength(0);
  });

  it("전시 수정은 전달된 필드만 갱신한다", async () => {
    const { fake, repository } = createRepository();
    fake.queueFindFirst("exhibitions", exhibitionRow());
    fake.queueFindFirst("exhibitions", exhibitionRow({ title: "새 제목" }));
    fake.queueSelect(exhibitionImages, []);

    await repository.updateExhibition(EXHIBITION_ID, { title: "새 제목" });

    const [update] = fake.updatesFor("exhibitions");
    expect(Object.keys(update?.values ?? {}).sort()).toEqual([
      "title",
      "updatedAt",
    ]);
  });

  it("전시 삭제는 소속 세부 이미지까지 soft delete 한다", async () => {
    const { fake, repository } = createRepository();
    fake.queueFindFirst("exhibitions", exhibitionRow());

    await expect(repository.deleteExhibition(EXHIBITION_ID)).resolves.toBe(true);

    expect(fake.updatesFor("exhibitions")[0]?.values).toHaveProperty("deletedAt");
    expect(fake.updatesFor("exhibition_images")[0]?.values).toHaveProperty(
      "deletedAt",
    );
  });

  it("존재하지 않는 전시 삭제는 아무것도 지우지 않는다", async () => {
    const { fake, repository } = createRepository();
    fake.queueFindFirst("exhibitions", undefined);

    await expect(repository.deleteExhibition(EXHIBITION_ID)).resolves.toBe(false);
    expect(fake.updates).toHaveLength(0);
  });

  it("상위 전시이 없으면 세부 이미지를 추가하지 않는다", async () => {
    const { fake, repository } = createRepository();
    fake.queueFindFirst("exhibitions", undefined);

    await expect(
      repository.addExhibitionImage(EXHIBITION_ID, {
        imageUrl: "https://example.com/detail.jpg",
        sortOrder: 0,
      }),
    ).resolves.toBeNull();
    expect(fake.insertsFor("exhibition_images")).toHaveLength(0);
  });

  it("세부 이미지를 추가하면 상위 전시의 updatedAt도 갱신한다", async () => {
    const { fake, repository } = createRepository();
    vi.spyOn(crypto, "randomUUID").mockReturnValue(IMAGE_ID);
    fake.queueFindFirst("exhibitions", exhibitionRow());
    fake.queueFindFirst("exhibitionImages", imageRow());

    const created = await repository.addExhibitionImage(EXHIBITION_ID, {
      imageUrl: "https://example.com/detail.jpg",
      sortOrder: 3,
      width: 100,
      height: 50,
    });

    expect(created?.id).toBe(IMAGE_ID);
    expect(fake.insertsFor("exhibition_images")[0]?.values).toMatchObject({
      sortOrder: 3,
      width: 100,
      height: 50,
    });
    expect(fake.updatesFor("exhibitions")).toHaveLength(1);
  });

  it("세부 이미지 일괄 추가는 D1 batch 한 번으로 처리한다", async () => {
    const { fake, d1, repository } = createRepository();
    fake.queueFindFirst("exhibitions", exhibitionRow());
    fake.queueSelect(exhibitionImages, [imageRow(), imageRow({ id: "other" })]);

    const created = await repository.addExhibitionImages(EXHIBITION_ID, [
      { imageUrl: "https://example.com/a.jpg", sortOrder: 0 },
      { imageUrl: "https://example.com/b.jpg", sortOrder: 1 },
    ]);

    expect(created).toHaveLength(2);
    expect(d1.batches).toHaveLength(1);
    expect(d1.batches[0]).toHaveLength(2);
  });

  it("빈 배열을 일괄 추가하면 batch를 실행하지 않는다", async () => {
    const { fake, d1, repository } = createRepository();
    fake.queueFindFirst("exhibitions", exhibitionRow());

    await expect(repository.addExhibitionImages(EXHIBITION_ID, [])).resolves.toEqual(
      [],
    );
    expect(d1.batches).toHaveLength(0);
  });

  it("존재하지 않는 세부 이미지 수정은 null을 반환한다", async () => {
    const { fake, repository } = createRepository();
    fake.queueFindFirst("exhibitionImages", undefined);

    await expect(
      repository.updateExhibitionImage(EXHIBITION_ID, IMAGE_ID, { sortOrder: 1 }),
    ).resolves.toBeNull();
  });

  it("세부 이미지 수정은 전달된 필드만 갱신하고 상위 전시을 갱신한다", async () => {
    const { fake, repository } = createRepository();
    fake.queueFindFirst("exhibitionImages", imageRow());
    fake.queueFindFirst("exhibitionImages", imageRow({ sortOrder: 5 }));

    await repository.updateExhibitionImage(EXHIBITION_ID, IMAGE_ID, {
      sortOrder: 5,
    });

    expect(Object.keys(fake.updatesFor("exhibition_images")[0]?.values ?? {}).sort()).toEqual([
      "sortOrder",
      "updatedAt",
    ]);
    expect(fake.updatesFor("exhibitions")).toHaveLength(1);
  });

  it("일괄 수정 대상 중 하나라도 이 전시에 없으면 전체를 거절한다", async () => {
    const { fake, repository } = createRepository();
    fake.queueFindFirst("exhibitions", exhibitionRow());
    // 요청은 2건인데 조회 결과는 1건뿐이다.
    fake.queueSelect(exhibitionImages, [{ id: IMAGE_ID }]);

    await expect(
      repository.updateExhibitionImages(EXHIBITION_ID, [
        { imageId: IMAGE_ID, sortOrder: 0 },
        { imageId: "missing", sortOrder: 1 },
      ]),
    ).resolves.toBeNull();
    expect(fake.updatesFor("exhibition_images")).toHaveLength(0);
  });

  it("일괄 수정은 요청한 이미지 수만큼 update를 실행한다", async () => {
    const { fake, repository } = createRepository();
    fake.queueFindFirst("exhibitions", exhibitionRow());
    fake.queueSelect(exhibitionImages, [{ id: IMAGE_ID }, { id: "second" }]);
    fake.queueSelect(exhibitionImages, [imageRow(), imageRow({ id: "second" })]);

    const result = await repository.updateExhibitionImages(EXHIBITION_ID, [
      { imageId: IMAGE_ID, sortOrder: 1 },
      { imageId: "second", sortOrder: 0 },
    ]);

    expect(result).toHaveLength(2);
    expect(fake.updatesFor("exhibition_images")).toHaveLength(2);
  });

  it("빈 목록 일괄 수정은 조회 없이 빈 배열을 반환한다", async () => {
    const { fake, repository } = createRepository();
    fake.queueFindFirst("exhibitions", exhibitionRow());

    await expect(
      repository.updateExhibitionImages(EXHIBITION_ID, []),
    ).resolves.toEqual([]);
  });

  it("세부 이미지 삭제는 이미지와 상위 전시을 함께 갱신한다", async () => {
    const { fake, repository } = createRepository();
    fake.queueFindFirst("exhibitionImages", imageRow());

    await expect(
      repository.deleteExhibitionImage(EXHIBITION_ID, IMAGE_ID),
    ).resolves.toBe(true);
    expect(fake.updatesFor("exhibition_images")[0]?.values).toHaveProperty(
      "deletedAt",
    );
    expect(fake.updatesFor("exhibitions")).toHaveLength(1);
  });

  it("존재하지 않는 세부 이미지 삭제는 false를 반환한다", async () => {
    const { fake, repository } = createRepository();
    fake.queueFindFirst("exhibitionImages", undefined);

    await expect(
      repository.deleteExhibitionImage(EXHIBITION_ID, IMAGE_ID),
    ).resolves.toBe(false);
    expect(fake.updates).toHaveLength(0);
  });
});
