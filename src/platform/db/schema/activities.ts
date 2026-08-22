import { relations } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { generations } from "./generations";

import { nowTimestamp } from "./columns";

export const activities = sqliteTable(
  "activities",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    startDate: integer("start_date", { mode: "timestamp_ms" }).notNull(),
    endDate: integer("end_date", { mode: "timestamp_ms" }).notNull(),
    coverImageUrl: text("cover_image_url").notNull(),
    generationId: text("generation_id")
      .notNull()
      .references(() => generations.id),
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
    index("activities_generation_id_idx").on(table.generationId),
    index("activities_start_date_idx").on(table.startDate),
    index("activities_end_date_idx").on(table.endDate),
  ],
);

export const activityImages = sqliteTable(
  "activity_images",
  {
    id: text("id").primaryKey(),
    activityId: text("activity_id")
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    imageUrl: text("image_url").notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    // 업로드 시 측정한 원본 픽셀 크기 — 공개 갤러리가 CLS 없이 원본 비율로 렌더링한다.
    // 측정 전에 업로드된 레거시 행은 null이며 프런트가 로드 후 비율을 보정한다.
    width: integer("width"),
    height: integer("height"),
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
    index("activity_images_activity_id_idx").on(table.activityId),
    index("activity_images_sort_order_idx").on(table.sortOrder),
  ],
);

export const activitiesRelations = relations(activities, ({ many, one }) => ({
  generation: one(generations, {
    fields: [activities.generationId],
    references: [generations.id],
  }),
  detailImages: many(activityImages),
}));

export const activityImagesRelations = relations(activityImages, ({ one }) => ({
  activity: one(activities, {
    fields: [activityImages.activityId],
    references: [activities.id],
  }),
}));
