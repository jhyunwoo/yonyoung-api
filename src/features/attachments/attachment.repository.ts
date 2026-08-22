import { and, asc, eq, isNull } from "drizzle-orm";
import type createDB from "../../lib/db";
import { activities, attachments } from "../../platform/db/schema";
import type {
  AttachmentEntity,
  AttachmentScope,
  CreateAttachmentInput,
} from "../../lib/services/types";

type Database = ReturnType<typeof createDB>;

const toAttachmentEntity = (
  row: typeof attachments.$inferSelect,
): AttachmentEntity => ({
  id: row.id,
  scope: row.scope === "site_donate" ? "site_donate" : "activity",
  resourceId: row.resourceId,
  title: row.title,
  fileUrl: row.fileUrl,
  fileName: row.fileName,
  fileSize: row.fileSize,
  mimeType: row.mimeType,
  linkUrl: row.linkUrl,
  sortOrder: row.sortOrder,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export const createAttachmentRepository = (db: Database) => {
  const findAttachmentById = async (
    id: string,
  ): Promise<AttachmentEntity | null> => {
    const row = await db.query.attachments.findFirst({
      where: and(eq(attachments.id, id), isNull(attachments.deletedAt)),
    });
    return row ? toAttachmentEntity(row) : null;
  };

  return {
    getAttachmentById: findAttachmentById,

    async listAttachments(
      scope: AttachmentScope,
      resourceId: string | null,
    ): Promise<AttachmentEntity[]> {
      const conditions = [
        eq(attachments.scope, scope),
        isNull(attachments.deletedAt),
        resourceId
          ? eq(attachments.resourceId, resourceId)
          : isNull(attachments.resourceId),
      ];

      const rows = await db
        .select()
        .from(attachments)
        .where(and(...conditions))
        .orderBy(asc(attachments.sortOrder), asc(attachments.createdAt));

      return rows.map(toAttachmentEntity);
    },

    /** activity 스코프 첨부는 살아 있는 상위 활동이 있을 때만 만들 수 있다. */
    async addAttachment(
      input: CreateAttachmentInput,
    ): Promise<AttachmentEntity | null> {
      if (input.scope === "activity") {
        if (!input.resourceId) {
          return null;
        }

        const parentActivity = await db.query.activities.findFirst({
          where: and(
            eq(activities.id, input.resourceId),
            isNull(activities.deletedAt),
          ),
        });
        if (!parentActivity) {
          return null;
        }
      }

      const id = crypto.randomUUID();
      await db.insert(attachments).values({
        id,
        scope: input.scope,
        resourceId: input.scope === "site_donate" ? null : input.resourceId,
        title: input.title,
        fileUrl: input.fileUrl,
        fileName: input.fileName,
        fileSize: input.fileSize,
        mimeType: input.mimeType,
        linkUrl: input.linkUrl,
        sortOrder: input.sortOrder,
      });

      return findAttachmentById(id);
    },

    async updateAttachment(
      id: string,
      input: Partial<{ title: string; sortOrder: number }>,
    ): Promise<AttachmentEntity | null> {
      const existing = await findAttachmentById(id);
      if (!existing) {
        return null;
      }

      await db
        .update(attachments)
        .set({
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.sortOrder !== undefined
            ? { sortOrder: input.sortOrder }
            : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(attachments.id, id), isNull(attachments.deletedAt)));

      return findAttachmentById(id);
    },

    async deleteAttachment(id: string): Promise<boolean> {
      const existing = await findAttachmentById(id);
      if (!existing) {
        return false;
      }

      await db
        .update(attachments)
        .set({ deletedAt: new Date() })
        .where(and(eq(attachments.id, id), isNull(attachments.deletedAt)));

      return true;
    },
  };
};

export type AttachmentRepository = ReturnType<
  typeof createAttachmentRepository
>;
