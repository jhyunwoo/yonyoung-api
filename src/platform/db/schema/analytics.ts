import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

import { nowTimestamp } from "./columns";

export const viewCounts = sqliteTable(
  "view_counts",
  {
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    viewCount: integer("view_count").default(0).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(nowTimestamp)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowTimestamp)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.resourceType, table.resourceId] }),
    index("view_counts_resource_type_idx").on(table.resourceType),
  ],
);

export const pageViews = sqliteTable(
  "page_views",
  {
    id: text("id").primaryKey(),
    pageType: text("page_type").notNull(), // 'home' | 'activity' | 'exhibition'
    resourceId: text("resource_id"), // null for home
    viewCount: integer("view_count").default(1).notNull(),
    visitedAt: integer("visited_at", { mode: "timestamp_ms" })
      .default(nowTimestamp)
      .notNull(),
  },
  (table) => [
    index("page_views_page_type_idx").on(table.pageType),
    index("page_views_resource_id_idx").on(table.resourceId),
    index("page_views_visited_at_idx").on(table.visitedAt),
  ],
);
