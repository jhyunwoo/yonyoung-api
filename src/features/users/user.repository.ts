import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type createDB from "../../lib/db";
import {
  activities,
  auditLogs,
  exhibitions,
  generations,
  linktree,
  linktreeItems,
  session,
  user,
  userGenerations,
} from "../../platform/db/schema";
import type {
  AuditAction,
  UserEntity,
  UserResourceHistoryEntity,
  UserResourceHistoryItemEntity,
  UserResourceHistoryResourceType,
} from "../../lib/services/types";
import { chunkArray, selectInChunks } from "../../platform/db/query-chunking";
import { parseJsonStringArray } from "../../platform/db/row-values";
import { isMissingUserGenerationsTableError } from "../../platform/db/legacy-schema";
import { listLatestAuditActorsByResourceId } from "../audit/audit.repository";

type Database = ReturnType<typeof createDB>;

const USER_RESOURCE_HISTORY_RESOURCE_TYPES = [
  "activity",
  "exhibition",
  "linktree",
  "linktree_item",
] as const satisfies readonly UserResourceHistoryResourceType[];

const isUserResourceHistoryResourceType = (
  value: string,
): value is UserResourceHistoryResourceType =>
  (USER_RESOURCE_HISTORY_RESOURCE_TYPES as readonly string[]).includes(value);

type UserResourceMeta = {
  resourceTitle: string | null;
  generationId: string | null;
  linktreeId: string | null;
  deletedAt: Date | null;
};

const serializeShowcaseImageUrls = (value: string[] | undefined): string =>
  JSON.stringify(value ?? []);

const dedupeGenerationIds = (generationIds: string[]): string[] => {
  return Array.from(
    new Set(
      generationIds.filter((generationId) => generationId.trim().length > 0),
    ),
  );
};

const mapUsersWithGenerations = async (
  db: Database,
  rows: (typeof user.$inferSelect)[],
): Promise<UserEntity[]> => {
  if (rows.length === 0) {
    return [];
  }

  const userIds = rows.map((row) => row.id);
  // 세대 링크 조회와 최근 수정자(audit) 조회는 서로 독립이므로 병렬 실행해
  // 순차 D1 왕복(2~3회)을 최대 병렬 깊이 2로 줄인다.
  const [linkRows, updatedByMap] = await Promise.all([
    (async () => {
      try {
        return await selectInChunks(userIds, (chunk) =>
          db
            .select({
              userId: userGenerations.userId,
              generationId: userGenerations.generationId,
            })
            .from(userGenerations)
            .innerJoin(
              generations,
              eq(userGenerations.generationId, generations.id),
            )
            .where(
              and(
                inArray(userGenerations.userId, chunk),
                isNull(generations.deletedAt),
              ),
            )
            .orderBy(asc(userGenerations.userId), desc(generations.sortOrder)),
        );
      } catch (error) {
        if (isMissingUserGenerationsTableError(error)) {
          return [] as Array<{ userId: string; generationId: string }>;
        }
        throw error;
      }
    })(),
    listLatestAuditActorsByResourceId(db, "user", userIds),
  ]);

  const generationIdsByUserId = new Map<string, string[]>();
  for (const row of linkRows) {
    const current = generationIdsByUserId.get(row.userId) ?? [];
    current.push(row.generationId);
    generationIdsByUserId.set(row.userId, current);
  }

  return rows.map((row) => {
    const generationIds = dedupeGenerationIds(
      generationIdsByUserId.get(row.id) ??
        (row.generationId ? [row.generationId] : []),
    );
    const primaryGenerationId =
      generationIds[0] ??
      (typeof row.generationId === "string" ? row.generationId : null);

    return {
      ...row,
      showcaseImageUrls: parseJsonStringArray(row.showcaseImageUrls),
      generationId: primaryGenerationId,
      generationIds,
      updatedBy: updatedByMap[row.id] ?? null,
    };
  });
};

const selectActiveGenerationIds = async (
  db: Database,
  generationIds: string[],
): Promise<{ generationIds: string[]; latestSortOrder: number | null }> => {
  const normalizedGenerationIds = dedupeGenerationIds(generationIds);
  if (normalizedGenerationIds.length === 0) {
    return { generationIds: [], latestSortOrder: null };
  }

  const rows = await db
    .select({
      id: generations.id,
      sortOrder: generations.sortOrder,
    })
    .from(generations)
    .where(
      and(
        inArray(generations.id, normalizedGenerationIds),
        isNull(generations.deletedAt),
      ),
    )
    .orderBy(desc(generations.sortOrder), asc(generations.id));

  return {
    generationIds: rows.map((row) => row.id),
    latestSortOrder: rows[0]?.sortOrder ?? null,
  };
};

const replaceUserGenerations = async (
  db: Database,
  userId: string,
  generationIds: string[],
): Promise<{ generationIds: string[]; primaryGenerationId: string | null }> => {
  const { generationIds: activeGenerationIds, latestSortOrder } =
    await selectActiveGenerationIds(db, generationIds);

  let canUseUserGenerationsTable = true;
  try {
    await db.delete(userGenerations).where(eq(userGenerations.userId, userId));

    if (activeGenerationIds.length > 0) {
      await db.insert(userGenerations).values(
        activeGenerationIds.map((generationId) => ({
          userId,
          generationId,
        })),
      );
    }
  } catch (error) {
    if (isMissingUserGenerationsTableError(error)) {
      canUseUserGenerationsTable = false;
    } else {
      throw error;
    }
  }

  const primaryGenerationId = activeGenerationIds[0] ?? null;
  await db
    .update(user)
    .set({
      generationId: primaryGenerationId,
      latestGenerationSortOrder: latestSortOrder,
      updatedAt: new Date(),
    })
    .where(and(eq(user.id, userId), isNull(user.deletedAt)));

  return {
    generationIds: canUseUserGenerationsTable
      ? activeGenerationIds
      : primaryGenerationId
        ? [primaryGenerationId]
        : [],
    primaryGenerationId,
  };
};

export type UpdateUserInput = Partial<{
  name: string;
  image: string | null;
  showcaseImageUrls: string[];
  familyName: string | null;
  givenName: string | null;
  college: string | null;
  department: string | null;
  studentNumber: string | null;
  phoneNumber: string | null;
  collaborationAvailable: boolean;
  personalLink: string | null;
  role: string;
  generationIds: string[];
  generationId: string | null;
}>;

export const createUserRepository = (db: Database) => {
  const getUserById = async (id: string): Promise<UserEntity | null> => {
    const row = await db.query.user.findFirst({
      where: and(eq(user.id, id), isNull(user.deletedAt)),
    });
    if (!row) {
      return null;
    }
    return (await mapUsersWithGenerations(db, [row]))[0] ?? null;
  };

  return {
    getUserById,

    async listUsers(): Promise<UserEntity[]> {
      const rows = await db
        .select()
        .from(user)
        .where(isNull(user.deletedAt))
        .orderBy(desc(user.createdAt));
      return mapUsersWithGenerations(db, rows);
    },
    async listUsersByIds(userIds: string[]): Promise<UserEntity[]> {
      const normalizedUserIds = Array.from(
        new Set(userIds.map((userId) => userId.trim()).filter(Boolean)),
      );
      if (normalizedUserIds.length === 0) {
        return [];
      }

      const rows = await selectInChunks(normalizedUserIds, (chunk) =>
        db
          .select()
          .from(user)
          .where(and(inArray(user.id, chunk), isNull(user.deletedAt)))
          .orderBy(desc(user.createdAt)),
      );
      return mapUsersWithGenerations(db, rows);
    },
    async listUsersByGenerationIds(
      generationIds: string[],
    ): Promise<UserEntity[]> {
      const normalizedGenerationIds = Array.from(
        new Set(
          generationIds
            .map((generationId) => generationId.trim())
            .filter(Boolean),
        ),
      );
      if (normalizedGenerationIds.length === 0) {
        return [];
      }

      // Enforce lifecycle scope at the data-service boundary as well as during
      // Actor reconstruction. This keeps a future caller from reviving a legacy
      // user.generationId that points at a soft-deleted generation.
      const { generationIds: activeGenerationIds } =
        await selectActiveGenerationIds(db, normalizedGenerationIds);
      if (activeGenerationIds.length === 0) {
        return [];
      }

      const readLegacyUserIds = async (): Promise<string[]> => {
        const legacyRows = await db
          .select({
            id: user.id,
          })
          .from(user)
          .where(
            and(
              inArray(user.generationId, activeGenerationIds),
              isNull(user.deletedAt),
            ),
          )
          .orderBy(desc(user.createdAt));
        return legacyRows.map((row) => row.id);
      };

      try {
        const [linkedRows, legacyUserIds] = await Promise.all([
          db
            .select({
              id: user.id,
            })
            .from(user)
            .innerJoin(userGenerations, eq(user.id, userGenerations.userId))
            .innerJoin(
              generations,
              eq(userGenerations.generationId, generations.id),
            )
            .where(
              and(
                inArray(userGenerations.generationId, activeGenerationIds),
                isNull(user.deletedAt),
                isNull(generations.deletedAt),
              ),
            )
            .orderBy(desc(user.createdAt)),
          readLegacyUserIds(),
        ]);

        const targetUserIds = Array.from(
          new Set([...linkedRows.map((row) => row.id), ...legacyUserIds]),
        );
        return this.listUsersByIds(targetUserIds);
      } catch (error) {
        if (!isMissingUserGenerationsTableError(error)) {
          throw error;
        }

        return this.listUsersByIds(await readLegacyUserIds());
      }
    },
    async countUsersByRole(role: string): Promise<number> {
      const rows = await db
        .select({
          value: sql<number>`count(*)`,
        })
        .from(user)
        .where(and(isNull(user.deletedAt), eq(user.role, role)));
      return rows[0]?.value ?? 0;
    },
    async listUserResourceHistory(input: {
      userId: string;
      page: number;
      pageSize: number;
      action?: AuditAction;
    }): Promise<UserResourceHistoryEntity> {
      const safePage =
        typeof input.page === "number" &&
        Number.isFinite(input.page) &&
        input.page > 0
          ? Math.floor(input.page)
          : 1;
      const safePageSize =
        typeof input.pageSize === "number" &&
        Number.isFinite(input.pageSize) &&
        input.pageSize > 0
          ? Math.min(100, Math.floor(input.pageSize))
          : 10;
      const conditions = [
        eq(auditLogs.actorId, input.userId),
        inArray(auditLogs.resourceType, [
          ...USER_RESOURCE_HISTORY_RESOURCE_TYPES,
        ]),
      ];

      if (input.action) {
        conditions.push(eq(auditLogs.action, input.action));
      }

      const totalRows = await db
        .select({
          value: sql<number>`count(*)`,
        })
        .from(auditLogs)
        .where(and(...conditions));
      const total = totalRows[0]?.value ?? 0;
      const totalPages = total === 0 ? 0 : Math.ceil(total / safePageSize);
      const historyRows = await db
        .select({
          id: auditLogs.id,
          resourceType: auditLogs.resourceType,
          resourceId: auditLogs.resourceId,
          action: auditLogs.action,
          changedFields: auditLogs.changedFields,
          createdAt: auditLogs.createdAt,
        })
        .from(auditLogs)
        .where(and(...conditions))
        .orderBy(desc(auditLogs.createdAt))
        .limit(safePageSize)
        .offset((safePage - 1) * safePageSize);

      if (historyRows.length === 0) {
        return {
          items: [],
          page: safePage,
          pageSize: safePageSize,
          total,
          totalPages,
        };
      }

      const resourceIdsByType: Record<
        UserResourceHistoryResourceType,
        string[]
      > = {
        activity: [],
        exhibition: [],
        linktree: [],
        linktree_item: [],
      };

      for (const row of historyRows) {
        if (!isUserResourceHistoryResourceType(row.resourceType)) {
          continue;
        }
        resourceIdsByType[row.resourceType].push(row.resourceId);
      }

      for (const resourceType of USER_RESOURCE_HISTORY_RESOURCE_TYPES) {
        resourceIdsByType[resourceType] = Array.from(
          new Set(resourceIdsByType[resourceType]),
        );
      }

      const [activityRows, exhibitionRows, linktreeRows, linktreeItemRows] =
        await Promise.all([
          resourceIdsByType.activity.length > 0
            ? db
                .select({
                  id: activities.id,
                  resourceTitle: activities.title,
                  generationId: activities.generationId,
                  deletedAt: activities.deletedAt,
                })
                .from(activities)
                .where(inArray(activities.id, resourceIdsByType.activity))
            : Promise.resolve([]),
          resourceIdsByType.exhibition.length > 0
            ? db
                .select({
                  id: exhibitions.id,
                  resourceTitle: exhibitions.title,
                  generationId: exhibitions.generationId,
                  deletedAt: exhibitions.deletedAt,
                })
                .from(exhibitions)
                .where(inArray(exhibitions.id, resourceIdsByType.exhibition))
            : Promise.resolve([]),
          resourceIdsByType.linktree.length > 0
            ? db
                .select({
                  id: linktree.id,
                  resourceTitle: linktree.name,
                  deletedAt: linktree.deletedAt,
                })
                .from(linktree)
                .where(inArray(linktree.id, resourceIdsByType.linktree))
            : Promise.resolve([]),
          resourceIdsByType.linktree_item.length > 0
            ? db
                .select({
                  id: linktreeItems.id,
                  resourceTitle: linktreeItems.name,
                  linktreeId: linktreeItems.linktreeId,
                  deletedAt: linktreeItems.deletedAt,
                })
                .from(linktreeItems)
                .where(
                  inArray(linktreeItems.id, resourceIdsByType.linktree_item),
                )
            : Promise.resolve([]),
        ]);

      const activityMetaById = new Map<string, UserResourceMeta>();
      for (const row of activityRows) {
        activityMetaById.set(row.id, {
          resourceTitle: row.resourceTitle,
          generationId: row.generationId,
          linktreeId: null,
          deletedAt: row.deletedAt,
        });
      }

      const exhibitionMetaById = new Map<string, UserResourceMeta>();
      for (const row of exhibitionRows) {
        exhibitionMetaById.set(row.id, {
          resourceTitle: row.resourceTitle,
          generationId: row.generationId,
          linktreeId: null,
          deletedAt: row.deletedAt,
        });
      }

      const linktreeMetaById = new Map<string, UserResourceMeta>();
      for (const row of linktreeRows) {
        linktreeMetaById.set(row.id, {
          resourceTitle: row.resourceTitle,
          generationId: null,
          linktreeId: null,
          deletedAt: row.deletedAt,
        });
      }

      const linktreeItemMetaById = new Map<string, UserResourceMeta>();
      for (const row of linktreeItemRows) {
        linktreeItemMetaById.set(row.id, {
          resourceTitle: row.resourceTitle,
          generationId: null,
          linktreeId: row.linktreeId,
          deletedAt: row.deletedAt,
        });
      }

      const metaByResourceType: Record<
        UserResourceHistoryResourceType,
        Map<string, UserResourceMeta>
      > = {
        activity: activityMetaById,
        exhibition: exhibitionMetaById,
        linktree: linktreeMetaById,
        linktree_item: linktreeItemMetaById,
      };

      const items: UserResourceHistoryItemEntity[] = [];
      for (const row of historyRows) {
        if (!isUserResourceHistoryResourceType(row.resourceType)) {
          continue;
        }

        const action = row.action as AuditAction;
        const meta =
          metaByResourceType[row.resourceType].get(row.resourceId) ?? null;
        const isDeleted = meta ? meta.deletedAt !== null : action === "delete";

        items.push({
          id: row.id,
          resourceType: row.resourceType,
          resourceId: row.resourceId,
          resourceTitle: meta?.resourceTitle ?? null,
          action,
          changedFields: parseJsonStringArray(row.changedFields),
          isDeleted,
          generationId: meta?.generationId ?? null,
          linktreeId: meta?.linktreeId ?? null,
          createdAt: row.createdAt,
        });
      }

      return {
        items,
        page: safePage,
        pageSize: safePageSize,
        total,
        totalPages,
      };
    },
    async updateUser(
      id: string,
      input: UpdateUserInput,
    ): Promise<UserEntity | null> {
      const exists = await db.query.user.findFirst({
        where: and(eq(user.id, id), isNull(user.deletedAt)),
      });
      if (!exists) {
        return null;
      }

      const nextGenerationIds =
        input.generationIds !== undefined
          ? input.generationIds
          : input.generationId !== undefined
            ? input.generationId
              ? [input.generationId]
              : []
            : undefined;

      await db
        .update(user)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.image !== undefined ? { image: input.image } : {}),
          ...(input.showcaseImageUrls !== undefined
            ? {
                showcaseImageUrls: serializeShowcaseImageUrls(
                  input.showcaseImageUrls,
                ),
              }
            : {}),
          ...(input.familyName !== undefined
            ? { familyName: input.familyName }
            : {}),
          ...(input.givenName !== undefined
            ? { givenName: input.givenName }
            : {}),
          ...(input.college !== undefined ? { college: input.college } : {}),
          ...(input.department !== undefined
            ? { department: input.department }
            : {}),
          ...(input.studentNumber !== undefined
            ? { studentNumber: input.studentNumber }
            : {}),
          ...(input.phoneNumber !== undefined
            ? { phoneNumber: input.phoneNumber }
            : {}),
          ...(input.collaborationAvailable !== undefined
            ? { collaborationAvailable: input.collaborationAvailable }
            : {}),
          ...(input.personalLink !== undefined
            ? { personalLink: input.personalLink }
            : {}),
          ...(input.role !== undefined ? { role: input.role } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(user.id, id), isNull(user.deletedAt)));

      if (nextGenerationIds !== undefined) {
        await replaceUserGenerations(db, id, nextGenerationIds);
      }

      return getUserById(id);
    },
    async bulkUpdateUsersRole(input: {
      userIds: string[];
      role: string;
    }): Promise<UserEntity[]> {
      const targetUserIds = Array.from(
        new Set(input.userIds.filter((userId) => userId.trim().length > 0)),
      );
      if (targetUserIds.length === 0) {
        return [];
      }

      // D1 batches are transactional. Chunking stays below D1's binding limit,
      // while the last-president trigger can still abort every target together.
      const [firstChunk, ...remainingChunks] = chunkArray(targetUserIds);
      const updatedAt = new Date();
      const buildRoleUpdate = (chunk: string[]) =>
        db
          .update(user)
          .set({
            role: input.role,
            updatedAt,
          })
          .where(and(inArray(user.id, chunk), isNull(user.deletedAt)));

      await db.batch([
        buildRoleUpdate(firstChunk),
        ...remainingChunks.map(buildRoleUpdate),
      ]);

      const rows = await selectInChunks(targetUserIds, (chunk) =>
        db
          .select()
          .from(user)
          .where(and(inArray(user.id, chunk), isNull(user.deletedAt))),
      );

      return mapUsersWithGenerations(db, rows);
    },

    async deleteUser(id: string): Promise<boolean> {
      const now = new Date();
      const [updatedUsers] = await db.batch([
        db
          .update(user)
          .set({
            deletedAt: now,
            updatedAt: now,
          })
          .where(and(eq(user.id, id), isNull(user.deletedAt)))
          .returning({ id: user.id }),
        db.delete(session).where(eq(session.userId, id)),
      ]);

      return updatedUsers.length > 0;
    },
  };
};

export type UserRepository = ReturnType<typeof createUserRepository>;
