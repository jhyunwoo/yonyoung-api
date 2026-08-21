import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { nowTimestamp } from "./columns";

export const attachments = sqliteTable(
  "attachments",
  {
    id: text("id").primaryKey(),
    // "activity" | "site_donate"
    scope: text("scope").notNull(),
    // scope=activity면 활동 UUID, site_donate면 null
    resourceId: text("resource_id"),
    title: text("title").notNull(),
    // 파일 첨부와 외부 링크 중 정확히 하나만 사용한다 (파일이면 file_* 채움, 링크면 link_url 채움)
    fileUrl: text("file_url"),
    fileName: text("file_name"),
    fileSize: integer("file_size"),
    mimeType: text("mime_type"),
    linkUrl: text("link_url"),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(nowTimestamp)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowTimestamp)
      .$onUpdate(() => new Date())
      .notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("attachments_scope_resource_idx").on(table.scope, table.resourceId),
    index("attachments_sort_order_idx").on(table.sortOrder),
  ],
);
