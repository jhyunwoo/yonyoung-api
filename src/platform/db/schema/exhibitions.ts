import { relations } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { generations } from "./generations";

import { nowTimestamp } from "./columns";

export const exhibitions = sqliteTable(
  "exhibitions",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    startDate: integer("start_date", { mode: "timestamp_ms" }).notNull(),
    endDate: integer("end_date", { mode: "timestamp_ms" }).notNull(),
    generationId: text("generation_id")
      .notNull()
      .references(() => generations.id),
    place: text("place").notNull(),
    coverImageUrl: text("cover_image_url").notNull(),
    description: text("description").notNull(),
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
    index("exhibitions_generation_id_idx").on(table.generationId),
    index("exhibitions_start_date_idx").on(table.startDate),
    index("exhibitions_end_date_idx").on(table.endDate),
  ],
);

export const exhibitionImages = sqliteTable(
  "exhibition_images",
  {
    id: text("id").primaryKey(),
    exhibitionId: text("exhibition_id")
      .notNull()
      .references(() => exhibitions.id, { onDelete: "cascade" }),
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
    index("exhibition_images_exhibition_id_idx").on(table.exhibitionId),
    index("exhibition_images_sort_order_idx").on(table.sortOrder),
  ],
);

export const exhibitionsRelations = relations(exhibitions, ({ many, one }) => ({
  generation: one(generations, {
    fields: [exhibitions.generationId],
    references: [generations.id],
  }),
  detailImages: many(exhibitionImages),
}));

export const exhibitionImagesRelations = relations(
  exhibitionImages,
  ({ one }) => ({
    exhibition: one(exhibitions, {
      fields: [exhibitionImages.exhibitionId],
      references: [exhibitions.id],
    }),
  }),
);
