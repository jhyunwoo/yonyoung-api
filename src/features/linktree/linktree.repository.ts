import { and, eq, inArray, isNull } from "drizzle-orm";
import type createDB from "../../lib/db";
import { linktree, linktreeItems } from "../../platform/db/schema";
import type {
  LinktreeEntity,
  LinktreeItemEntity,
} from "../../lib/services/types";
import { selectInChunks } from "../../platform/db/query-chunking";
import {
  createAuditRepository,
  listLatestAuditActorsByResourceId,
} from "../audit/audit.repository";

type Database = ReturnType<typeof createDB>;
type LinktreeRow = typeof linktree.$inferSelect;

const mapLinktreesWithItems = async (
  db: Database,
  rows: LinktreeRow[],
): Promise<LinktreeEntity[]> => {
  if (rows.length === 0) {
    return [];
  }

  const ids = rows.map((row) => row.id);
  const itemRows = await selectInChunks(ids, (chunk) =>
    db
      .select()
      .from(linktreeItems)
      .where(
        and(
          inArray(linktreeItems.linktreeId, chunk),
          isNull(linktreeItems.deletedAt),
        ),
      ),
  );

  const itemMap = new Map<string, (typeof linktreeItems.$inferSelect)[]>();
  for (const item of itemRows) {
    const current = itemMap.get(item.linktreeId) ?? [];
    current.push(item);
    itemMap.set(item.linktreeId, current);
  }

  const [linktreeUpdatedByMap, itemUpdatedByMap] = await Promise.all([
    listLatestAuditActorsByResourceId(db, "linktree", ids),
    listLatestAuditActorsByResourceId(
      db,
      "linktree_item",
      itemRows.map((item) => item.id),
    ),
  ]);

  return rows.map((row) => ({
    ...row,
    updatedBy: linktreeUpdatedByMap[row.id] ?? null,
    items: (itemMap.get(row.id) ?? []).map((item) => ({
      ...item,
      updatedBy: itemUpdatedByMap[item.id] ?? null,
    })),
  }));
};

export const createLinktreeRepository = (db: Database) => {
  const auditRepository = createAuditRepository(db);

  const findActiveLinktree = (id: string) =>
    db.query.linktree.findFirst({
      where: and(eq(linktree.id, id), isNull(linktree.deletedAt)),
    });

  const touchLinktree = (linktreeId: string) =>
    db
      .update(linktree)
      .set({ updatedAt: new Date() })
      .where(and(eq(linktree.id, linktreeId), isNull(linktree.deletedAt)));

  const getLinktreeById = async (
    id: string,
  ): Promise<LinktreeEntity | null> => {
    const row = await findActiveLinktree(id);
    if (!row) {
      return null;
    }
    return (await mapLinktreesWithItems(db, [row]))[0] ?? null;
  };

  const withItemUpdatedBy = async (
    row: typeof linktreeItems.$inferSelect,
  ): Promise<LinktreeItemEntity> => ({
    ...row,
    updatedBy: await auditRepository.getLatestAuditActor(
      "linktree_item",
      row.id,
    ),
  });

  return {
    getLinktreeById,

    async listLinktrees(): Promise<LinktreeEntity[]> {
      const rows = await db
        .select()
        .from(linktree)
        .where(isNull(linktree.deletedAt));
      return mapLinktreesWithItems(db, rows);
    },

    async createLinktree(input: { name: string }): Promise<LinktreeEntity> {
      const id = crypto.randomUUID();
      const now = new Date();
      await db.insert(linktree).values({
        id,
        name: input.name,
        createdAt: now,
        updatedAt: now,
      });
      return (await getLinktreeById(id))!;
    },

    async updateLinktree(
      id: string,
      input: Partial<{ name: string }>,
    ): Promise<LinktreeEntity | null> {
      const exists = await findActiveLinktree(id);
      if (!exists) {
        return null;
      }
      await db
        .update(linktree)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(linktree.id, id), isNull(linktree.deletedAt)));
      return getLinktreeById(id);
    },

    /** 링크트리 soft delete는 소속 항목까지 함께 내린다. */
    async deleteLinktree(id: string): Promise<boolean> {
      const exists = await findActiveLinktree(id);
      if (!exists) {
        return false;
      }
      await db
        .update(linktree)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(linktree.id, id), isNull(linktree.deletedAt)));
      await db
        .update(linktreeItems)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(linktreeItems.linktreeId, id),
            isNull(linktreeItems.deletedAt),
          ),
        );
      return true;
    },

    async addLinktreeItem(
      linktreeId: string,
      input: { name: string; link: string },
    ): Promise<LinktreeItemEntity | null> {
      const parent = await findActiveLinktree(linktreeId);
      if (!parent) {
        return null;
      }
      const id = crypto.randomUUID();
      const now = new Date();
      await db.insert(linktreeItems).values({
        id,
        linktreeId,
        name: input.name,
        link: input.link,
        createdAt: now,
        updatedAt: now,
      });
      await touchLinktree(linktreeId);
      const row =
        (await db.query.linktreeItems.findFirst({
          where: and(eq(linktreeItems.id, id), isNull(linktreeItems.deletedAt)),
        })) ?? null;
      if (!row) {
        return null;
      }

      return withItemUpdatedBy(row);
    },

    async updateLinktreeItem(
      linktreeId: string,
      itemId: string,
      input: Partial<{ name: string; link: string }>,
    ): Promise<LinktreeItemEntity | null> {
      const exists = await db.query.linktreeItems.findFirst({
        where: and(
          eq(linktreeItems.id, itemId),
          eq(linktreeItems.linktreeId, linktreeId),
          isNull(linktreeItems.deletedAt),
        ),
      });
      if (!exists) {
        return null;
      }
      await db
        .update(linktreeItems)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.link !== undefined ? { link: input.link } : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(linktreeItems.id, itemId),
            eq(linktreeItems.linktreeId, linktreeId),
            isNull(linktreeItems.deletedAt),
          ),
        );
      await touchLinktree(linktreeId);
      const row =
        (await db.query.linktreeItems.findFirst({
          where: and(
            eq(linktreeItems.id, itemId),
            isNull(linktreeItems.deletedAt),
          ),
        })) ?? null;
      if (!row) {
        return null;
      }

      return withItemUpdatedBy(row);
    },

    async deleteLinktreeItem(
      linktreeId: string,
      itemId: string,
    ): Promise<boolean> {
      const exists = await db.query.linktreeItems.findFirst({
        where: and(
          eq(linktreeItems.id, itemId),
          eq(linktreeItems.linktreeId, linktreeId),
          isNull(linktreeItems.deletedAt),
        ),
      });
      if (!exists) {
        return false;
      }
      await db
        .update(linktreeItems)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(linktreeItems.id, itemId),
            eq(linktreeItems.linktreeId, linktreeId),
            isNull(linktreeItems.deletedAt),
          ),
        );
      await touchLinktree(linktreeId);
      return true;
    },
  };
};

export type LinktreeRepository = ReturnType<typeof createLinktreeRepository>;
