import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { nowTimestamp } from "./columns";

export const recruitingPlans = sqliteTable("recruiting_plans", {
  year: integer("year").primaryKey(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  promotionImageUrls: text("promotion_image_urls").notNull(),
  recruitmentStartAt: integer("recruitment_start_at", {
    mode: "timestamp_ms",
  }).notNull(),
  recruitmentEndAt: integer("recruitment_end_at", {
    mode: "timestamp_ms",
  }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(nowTimestamp)
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(nowTimestamp)
    .$onUpdate(() => new Date())
    .notNull(),
});
