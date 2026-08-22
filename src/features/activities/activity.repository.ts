import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type createDB from "../../lib/db";
import { activities, activityImages } from "../../platform/db/schema";
import type {
  ActivityEntity,
  ActivityImageEntity,
  ImageDimensionsInput,
} from "../../lib/services/types";
import { selectInChunks } from "../../platform/db/query-chunking";
import {
  toImageDimensionsPatch,
  toTimestampDate,
} from "../../platform/db/row-values";
import { listLatestAuditActorsByResourceId } from "../audit/audit.repository";

type Database = ReturnType<typeof createDB>;
type ActivityRow = typeof activities.$inferSelect;

export type CreateActivityInput = {
  title: string;
  description: string;
  startDate: number;
  endDate: number;
  coverImageUrl: string;
  generationId: string;
};

export type UpdateActivityInput = Partial<CreateActivityInput>;

export type CreateActivityImageInput = ImageDimensionsInput & {
  imageUrl: string;
  sortOrder: number;
};

export type UpdateActivityImageInput = ImageDimensionsInput &
  Partial<{ imageUrl: string; sortOrder: number }>;

export type UpdateActivityImageBatchItem = ImageDimensionsInput & {
  imageId: string;
  imageUrl?: string;
  sortOrder?: number;
};

// activities 테이블은 activity_date(단일 컬럼) → start_date/end_date(범위)로 마이그레이션됐다.
// 마이그레이션 전 스키마를 쓰는 환경에서도 읽기가 죽지 않도록 레거시 컬럼으로 폴백한다.
const isMissingActivityDateRangeColumnsError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes("no such column: activities.start_date") ||
    error.message.includes("no such column: activities.end_date") ||
    error.message.includes("no such column: start_date") ||
    error.message.includes("no such column: end_date")
  );
};

type LegacyActivityRow = {
  id: string;
  title: string;
  description: string;
  activity_date: unknown;
  cover_image_url: string;
  generation_id: string;
  created_at: unknown;
  updated_at: unknown;
  deleted_at: unknown;
};

const mapLegacyActivityRow = (row: LegacyActivityRow): ActivityRow => ({
  id: row.id,
  title: row.title,
  description: row.description,
  startDate: toTimestampDate(row.activity_date),
  endDate: toTimestampDate(row.activity_date),
  coverImageUrl: row.cover_image_url,
  generationId: row.generation_id,
  createdAt: toTimestampDate(row.created_at),
  updatedAt: toTimestampDate(row.updated_at),
  deletedAt:
    row.deleted_at === null || row.deleted_at === undefined
      ? null
      : toTimestampDate(row.deleted_at),
});

// SQL 문자열은 정렬 방향/필터까지 포함해 리터럴로 고정한다. 런타임 값 보간을 한 군데도
// 허용하지 않아야 d1-query-safety 검사가 의미를 갖는다.
const listLegacyActivities = async (
  database: D1Database,
  orderByDirection: "ASC" | "DESC",
  generationId?: string,
): Promise<ActivityRow[]> => {
  let executed: Promise<D1Result<LegacyActivityRow>>;
  if (generationId) {
    if (orderByDirection === "ASC") {
      executed = database
        .prepare(
          `
            select
              "id",
              "title",
              "description",
              "activity_date",
              "cover_image_url",
              "generation_id",
              "created_at",
              "updated_at",
              "deleted_at"
            from "activities"
            where "activities"."deleted_at" is null
              and "activities"."generation_id" = ?
            order by "activities"."activity_date" ASC`,
        )
        .bind(generationId)
        .all<LegacyActivityRow>();
    } else {
      executed = database
        .prepare(
          `
            select
              "id",
              "title",
              "description",
              "activity_date",
              "cover_image_url",
              "generation_id",
              "created_at",
              "updated_at",
              "deleted_at"
            from "activities"
            where "activities"."deleted_at" is null
              and "activities"."generation_id" = ?
            order by "activities"."activity_date" DESC`,
        )
        .bind(generationId)
        .all<LegacyActivityRow>();
    }
  } else if (orderByDirection === "ASC") {
    executed = database
      .prepare(
        `
          select
            "id",
            "title",
            "description",
            "activity_date",
            "cover_image_url",
            "generation_id",
            "created_at",
            "updated_at",
            "deleted_at"
          from "activities"
          where "activities"."deleted_at" is null
          order by "activities"."activity_date" ASC`,
      )
      .bind()
      .all<LegacyActivityRow>();
  } else {
    executed = database
      .prepare(
        `
          select
            "id",
            "title",
            "description",
            "activity_date",
            "cover_image_url",
            "generation_id",
            "created_at",
            "updated_at",
            "deleted_at"
          from "activities"
          where "activities"."deleted_at" is null
          order by "activities"."activity_date" DESC`,
      )
      .bind()
      .all<LegacyActivityRow>();
  }

  const { results } = await executed;

  return (results ?? []).map(mapLegacyActivityRow);
};

const mapActivitiesWithImages = async (
  db: Database,
  rows: ActivityRow[],
): Promise<ActivityEntity[]> => {
  if (rows.length === 0) {
    return [];
  }

  const ids = rows.map((row) => row.id);
  const imageRows = await selectInChunks(ids, (chunk) =>
    db
      .select()
      .from(activityImages)
      .where(
        and(
          inArray(activityImages.activityId, chunk),
          isNull(activityImages.deletedAt),
        ),
      )
      .orderBy(asc(activityImages.sortOrder)),
  );

  const imageMap = new Map<string, ActivityImageEntity[]>();
  for (const imageRow of imageRows) {
    const current = imageMap.get(imageRow.activityId) ?? [];
    current.push(imageRow);
    imageMap.set(imageRow.activityId, current);
  }

  const updatedByMap = await listLatestAuditActorsByResourceId(
    db,
    "activity",
    ids,
  );

  return rows.map((row) => ({
    ...row,
    updatedBy: updatedByMap[row.id] ?? null,
    detailImages: imageMap.get(row.id) ?? [],
  }));
};

export const createActivityRepository = (
  db: Database,
  database: D1Database,
) => {
  const findActiveActivity = (id: string) =>
    db.query.activities.findFirst({
      where: and(eq(activities.id, id), isNull(activities.deletedAt)),
    });

  const touchActivity = (activityId: string) =>
    db
      .update(activities)
      .set({ updatedAt: new Date() })
      .where(and(eq(activities.id, activityId), isNull(activities.deletedAt)));

  const getActivityById = async (
    id: string,
  ): Promise<ActivityEntity | null> => {
    const row = await findActiveActivity(id);
    if (!row) {
      return null;
    }
    return (await mapActivitiesWithImages(db, [row]))[0] ?? null;
  };

  return {
    getActivityById,

    async listActivities(generationId?: string): Promise<ActivityEntity[]> {
      const rows = await (async () => {
        try {
          const conditions = [isNull(activities.deletedAt)];
          if (generationId) {
            conditions.push(eq(activities.generationId, generationId));
          }
          return await db
            .select()
            .from(activities)
            .where(and(...conditions))
            .orderBy(asc(activities.startDate));
        } catch (error) {
          if (!isMissingActivityDateRangeColumnsError(error)) {
            throw error;
          }
          return listLegacyActivities(database, "ASC", generationId);
        }
      })();
      return mapActivitiesWithImages(db, rows);
    },

    /** 공개 화면 렌더링 성능을 위해 정렬을 DB에서 수행한다. */
    async listPublicActivities(): Promise<ActivityEntity[]> {
      const rows = await (async () => {
        try {
          return await db
            .select()
            .from(activities)
            .where(isNull(activities.deletedAt))
            .orderBy(desc(activities.startDate));
        } catch (error) {
          if (!isMissingActivityDateRangeColumnsError(error)) {
            throw error;
          }
          return listLegacyActivities(database, "DESC");
        }
      })();
      return mapActivitiesWithImages(db, rows);
    },

    async createActivity(input: CreateActivityInput): Promise<ActivityEntity> {
      const id = crypto.randomUUID();
      await db.insert(activities).values({
        id,
        title: input.title,
        description: input.description,
        startDate: new Date(input.startDate),
        endDate: new Date(input.endDate),
        coverImageUrl: input.coverImageUrl,
        generationId: input.generationId,
      });
      return (await getActivityById(id))!;
    },

    async updateActivity(
      id: string,
      input: UpdateActivityInput,
    ): Promise<ActivityEntity | null> {
      const exists = await findActiveActivity(id);
      if (!exists) {
        return null;
      }

      await db
        .update(activities)
        .set({
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
          ...(input.startDate !== undefined
            ? { startDate: new Date(input.startDate) }
            : {}),
          ...(input.endDate !== undefined
            ? { endDate: new Date(input.endDate) }
            : {}),
          ...(input.coverImageUrl !== undefined
            ? { coverImageUrl: input.coverImageUrl }
            : {}),
          ...(input.generationId !== undefined
            ? { generationId: input.generationId }
            : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(activities.id, id), isNull(activities.deletedAt)));

      return getActivityById(id);
    },

    /** 활동 soft delete는 소속 세부 이미지까지 함께 내린다. */
    async deleteActivity(id: string): Promise<boolean> {
      const exists = await findActiveActivity(id);
      if (!exists) {
        return false;
      }
      await db
        .update(activities)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(activities.id, id), isNull(activities.deletedAt)));
      await db
        .update(activityImages)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(activityImages.activityId, id),
            isNull(activityImages.deletedAt),
          ),
        );
      return true;
    },

    async addActivityImage(
      activityId: string,
      input: CreateActivityImageInput,
    ): Promise<ActivityImageEntity | null> {
      const parent = await findActiveActivity(activityId);
      if (!parent) {
        return null;
      }

      const id = crypto.randomUUID();
      await db.insert(activityImages).values({
        id,
        activityId,
        imageUrl: input.imageUrl,
        sortOrder: input.sortOrder,
        ...toImageDimensionsPatch(input),
      });
      await touchActivity(activityId);
      return (
        (await db.query.activityImages.findFirst({
          where: and(
            eq(activityImages.id, id),
            isNull(activityImages.deletedAt),
          ),
        })) ?? null
      );
    },

    /** 세부 이미지 일괄 추가는 D1 batch 한 번으로 묶어 왕복 지연을 줄인다. */
    async addActivityImages(
      activityId: string,
      input: CreateActivityImageInput[],
    ): Promise<ActivityImageEntity[] | null> {
      const parent = await findActiveActivity(activityId);
      if (!parent) {
        return null;
      }

      const createdIds: string[] = [];
      const statements = input.map((item) => {
        const id = crypto.randomUUID();
        createdIds.push(id);
        return database
          .prepare(
            `insert into "activity_images" ("id", "activity_id", "image_url", "sort_order", "width", "height") values (?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            id,
            activityId,
            item.imageUrl,
            item.sortOrder,
            item.width ?? null,
            item.height ?? null,
          );
      });

      if (statements.length > 0) {
        await database.batch(statements);
        await touchActivity(activityId);
      }

      if (createdIds.length === 0) {
        return [];
      }

      return db
        .select()
        .from(activityImages)
        .where(
          and(
            inArray(activityImages.id, createdIds),
            isNull(activityImages.deletedAt),
          ),
        )
        .orderBy(asc(activityImages.sortOrder));
    },

    async updateActivityImage(
      activityId: string,
      imageId: string,
      input: UpdateActivityImageInput,
    ): Promise<ActivityImageEntity | null> {
      const exists = await db.query.activityImages.findFirst({
        where: and(
          eq(activityImages.id, imageId),
          eq(activityImages.activityId, activityId),
          isNull(activityImages.deletedAt),
        ),
      });
      if (!exists) {
        return null;
      }

      await db
        .update(activityImages)
        .set({
          ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl } : {}),
          ...(input.sortOrder !== undefined
            ? { sortOrder: input.sortOrder }
            : {}),
          ...toImageDimensionsPatch(input),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(activityImages.id, imageId),
            eq(activityImages.activityId, activityId),
            isNull(activityImages.deletedAt),
          ),
        );
      await touchActivity(activityId);

      return (
        (await db.query.activityImages.findFirst({
          where: and(
            eq(activityImages.id, imageId),
            isNull(activityImages.deletedAt),
          ),
        })) ?? null
      );
    },

    /** 요청된 이미지 중 하나라도 이 활동에 없으면 부분 적용 없이 전체를 거절한다. */
    async updateActivityImages(
      activityId: string,
      input: UpdateActivityImageBatchItem[],
    ): Promise<ActivityImageEntity[] | null> {
      const parent = await findActiveActivity(activityId);
      if (!parent) {
        return null;
      }

      const imageIds = input.map((item) => item.imageId);
      if (imageIds.length === 0) {
        return [];
      }
      const existing = await db
        .select({ id: activityImages.id })
        .from(activityImages)
        .where(
          and(
            eq(activityImages.activityId, activityId),
            inArray(activityImages.id, imageIds),
            isNull(activityImages.deletedAt),
          ),
        );

      if (existing.length !== imageIds.length) {
        return null;
      }

      for (const item of input) {
        await db
          .update(activityImages)
          .set({
            ...(item.imageUrl !== undefined ? { imageUrl: item.imageUrl } : {}),
            ...(item.sortOrder !== undefined
              ? { sortOrder: item.sortOrder }
              : {}),
            ...toImageDimensionsPatch(item),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(activityImages.id, item.imageId),
              eq(activityImages.activityId, activityId),
              isNull(activityImages.deletedAt),
            ),
          );
      }
      await touchActivity(activityId);

      return db
        .select()
        .from(activityImages)
        .where(
          and(
            inArray(activityImages.id, imageIds),
            isNull(activityImages.deletedAt),
          ),
        )
        .orderBy(asc(activityImages.sortOrder));
    },

    async deleteActivityImage(
      activityId: string,
      imageId: string,
    ): Promise<boolean> {
      const exists = await db.query.activityImages.findFirst({
        where: and(
          eq(activityImages.id, imageId),
          eq(activityImages.activityId, activityId),
          isNull(activityImages.deletedAt),
        ),
      });
      if (!exists) {
        return false;
      }
      await db
        .update(activityImages)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(activityImages.id, imageId),
            eq(activityImages.activityId, activityId),
            isNull(activityImages.deletedAt),
          ),
        );
      await touchActivity(activityId);
      return true;
    },
  };
};

export type ActivityRepository = ReturnType<typeof createActivityRepository>;
