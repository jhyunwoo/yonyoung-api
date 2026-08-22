import { relations } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { nowTimestamp } from "./columns";

export const linktree = sqliteTable("linktree", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(nowTimestamp)
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(nowTimestamp)
    .$onUpdate(() => new Date())
    .notNull(),
  deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
});

export const linktreeItems = sqliteTable(
  "linktree_items",
  {
    id: text("id").primaryKey(),
    linktreeId: text("linktree_id")
      .notNull()
      .references(() => linktree.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    link: text("link").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(nowTimestamp)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowTimestamp)
      .$onUpdate(() => new Date())
      .notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (table) => [index("linktree_items_linktree_id_idx").on(table.linktreeId)],
);

export const linktreeRelations = relations(linktree, ({ many }) => ({
  items: many(linktreeItems),
}));

export const linktreeItemsRelations = relations(linktreeItems, ({ one }) => ({
  linktree: one(linktree, {
    fields: [linktreeItems.linktreeId],
    references: [linktree.id],
  }),
}));
