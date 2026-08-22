import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { activities } from "./activities";
import { user, userGenerations } from "./auth";
import { exhibitions } from "./exhibitions";

import { nowTimestamp } from "./columns";

export const generations = sqliteTable(
  "generations",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull(),
    startDate: integer("start_date", { mode: "timestamp_ms" }).notNull(),
    endDate: integer("end_date", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(nowTimestamp)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowTimestamp)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("generations_start_date_idx").on(table.startDate),
    uniqueIndex("generations_active_name_unique")
      .on(table.name)
      .where(sql`${table.deletedAt} is null`),
    uniqueIndex("generations_active_sort_order_unique")
      .on(table.sortOrder)
      .where(sql`${table.deletedAt} is null`),
  ],
);

export const generationsRelations = relations(generations, ({ many }) => ({
  users: many(user),
  userGenerations: many(userGenerations),
  activities: many(activities),
  exhibitions: many(exhibitions),
}));
