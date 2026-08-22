import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { isNull } from "drizzle-orm";
import type createDB from "../../lib/db";
import { auditLogs, user } from "../../platform/db/schema";
import { selectInChunks } from "../../platform/db/query-chunking";
import {
  parseJsonStringArray,
  toTimestampDate,
} from "../../platform/db/row-values";
import type {
  AuditActorEntity,
  AuditLogEntity,
  AuditResourceType,
} from "../../lib/services/types";

type Database = ReturnType<typeof createDB>;

const toAuditActor = (input: {
  actorId: string | null;
  actorName: string;
  actorFamilyName: string | null;
  actorGivenName: string | null;
  actorRole: string | null;
}): AuditActorEntity | null => {
  if (!input.actorId) {
    return null;
  }

  return {
    id: input.actorId,
    name: input.actorName,
    familyName: input.actorFamilyName,
    givenName: input.actorGivenName,
    role: input.actorRole,
  };
};

/**
 * 리소스별 "마지막으로 수정한 사람"을 한 번에 해석한다.
 * 목록 응답의 updatedBy 필드가 이 결과를 그대로 사용하므로 도메인 repository들이 공유한다.
 */
export const listLatestAuditActorsByResourceId = async (
  db: Database,
  resourceType: AuditResourceType,
  resourceIds: string[],
): Promise<Record<string, AuditActorEntity | null>> => {
  const normalizedResourceIds = Array.from(
    new Set(resourceIds.map((resourceId) => resourceId.trim()).filter(Boolean)),
  );
  if (normalizedResourceIds.length === 0) {
    return {};
  }

  const result: Record<string, AuditActorEntity | null> = {};
  for (const resourceId of normalizedResourceIds) {
    result[resourceId] = null;
  }

  const latestCreatedAtRows = await selectInChunks(
    normalizedResourceIds,
    (chunk) =>
      db
        .select({
          resourceId: auditLogs.resourceId,
          latestCreatedAt: sql<number>`max(${auditLogs.createdAt})`,
        })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.resourceType, resourceType),
            inArray(auditLogs.resourceId, chunk),
          ),
        )
        .groupBy(auditLogs.resourceId),
  );

  if (latestCreatedAtRows.length === 0) {
    return result;
  }

  const latestCreatedAtByResourceId = new Map<string, number>();
  for (const row of latestCreatedAtRows) {
    latestCreatedAtByResourceId.set(
      row.resourceId,
      toTimestampDate(row.latestCreatedAt).getTime(),
    );
  }

  // resourceId 청크마다 해당 청크의 createdAt 값만 바인딩하므로
  // 쿼리당 파라미터는 1 + 45 + 45 = 91개를 넘지 않는다.
  const latestRows = await selectInChunks(normalizedResourceIds, (chunk) => {
    const chunkCreatedAtValues = Array.from(
      new Set(
        chunk
          .map((resourceId) => latestCreatedAtByResourceId.get(resourceId))
          .filter((value): value is number => value !== undefined),
      ),
    ).map((value) => new Date(value));

    if (chunkCreatedAtValues.length === 0) {
      return Promise.resolve([]);
    }

    return db
      .select({
        id: auditLogs.id,
        resourceId: auditLogs.resourceId,
        actorId: auditLogs.actorId,
        actorName: auditLogs.actorName,
        actorFamilyName: user.familyName,
        actorGivenName: user.givenName,
        actorRole: auditLogs.actorRole,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .leftJoin(
        user,
        and(eq(auditLogs.actorId, user.id), isNull(user.deletedAt)),
      )
      .where(
        and(
          eq(auditLogs.resourceType, resourceType),
          inArray(auditLogs.resourceId, chunk),
          inArray(auditLogs.createdAt, chunkCreatedAtValues),
        ),
      )
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id));
  });

  const resolvedResourceIds = new Set<string>();
  for (const row of latestRows) {
    const expectedCreatedAt = latestCreatedAtByResourceId.get(row.resourceId);
    if (expectedCreatedAt === undefined) {
      continue;
    }
    if (resolvedResourceIds.has(row.resourceId)) {
      continue;
    }
    if (row.createdAt.getTime() !== expectedCreatedAt) {
      continue;
    }

    result[row.resourceId] = toAuditActor(row);
    resolvedResourceIds.add(row.resourceId);

    if (resolvedResourceIds.size === normalizedResourceIds.length) {
      break;
    }
  }

  return result;
};

export const createAuditRepository = (db: Database) => ({
  async recordAuditLog(input: {
    resourceType: AuditResourceType;
    resourceId: string;
    action: AuditLogEntity["action"];
    actorId: string | null;
    actorName: string;
    actorRole: string | null;
    changedFields: string[];
  }): Promise<void> {
    await db.insert(auditLogs).values({
      id: crypto.randomUUID(),
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      action: input.action,
      actorId: input.actorId,
      actorName: input.actorName,
      actorRole: input.actorRole,
      changedFields: JSON.stringify(input.changedFields),
    });
  },

  async listAuditLogs(
    resourceType: AuditResourceType,
    resourceId: string,
    limit: number,
  ): Promise<AuditLogEntity[]> {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const rows = await db
      .select({
        id: auditLogs.id,
        resourceType: auditLogs.resourceType,
        resourceId: auditLogs.resourceId,
        action: auditLogs.action,
        actorId: auditLogs.actorId,
        actorName: auditLogs.actorName,
        actorFamilyName: user.familyName,
        actorGivenName: user.givenName,
        actorRole: auditLogs.actorRole,
        changedFields: auditLogs.changedFields,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .leftJoin(
        user,
        and(eq(auditLogs.actorId, user.id), isNull(user.deletedAt)),
      )
      .where(
        and(
          eq(auditLogs.resourceType, resourceType),
          eq(auditLogs.resourceId, resourceId),
        ),
      )
      .orderBy(desc(auditLogs.createdAt))
      .limit(safeLimit);

    return rows.map((row): AuditLogEntity => ({
      id: row.id,
      resourceType: row.resourceType as AuditResourceType,
      resourceId: row.resourceId,
      action: row.action as AuditLogEntity["action"],
      actor: toAuditActor({
        actorId: row.actorId,
        actorName: row.actorName,
        actorFamilyName: row.actorFamilyName,
        actorGivenName: row.actorGivenName,
        actorRole: row.actorRole,
      }),
      changedFields: parseJsonStringArray(row.changedFields),
      createdAt: row.createdAt,
    }));
  },

  async getLatestAuditActor(
    resourceType: AuditResourceType,
    resourceId: string,
  ): Promise<AuditActorEntity | null> {
    const actorMap = await listLatestAuditActorsByResourceId(db, resourceType, [
      resourceId,
    ]);
    return actorMap[resourceId] ?? null;
  },

  async listLatestAuditActors(
    resourceType: AuditResourceType,
    resourceIds: string[],
  ): Promise<Record<string, AuditActorEntity | null>> {
    return listLatestAuditActorsByResourceId(db, resourceType, resourceIds);
  },
});

export type AuditRepository = ReturnType<typeof createAuditRepository>;
