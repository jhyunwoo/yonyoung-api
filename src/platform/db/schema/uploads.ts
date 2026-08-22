import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { nowTimestamp } from "./columns";

export const uploadReservations = sqliteTable(
  "upload_reservations",
  {
    id: text("id").primaryKey(),
    actorId: text("actor_id").notNull(),
    fileSize: integer("file_size").notNull(),
    observedUsedBytes: integer("observed_used_bytes").notNull(),
    observedAt: integer("observed_at", { mode: "timestamp_ms" }).notNull(),
    grantExpiresAt: integer("grant_expires_at", {
      mode: "timestamp_ms",
    }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(nowTimestamp)
      .notNull(),
  },
  (table) => [
    index("upload_reservations_actor_expiry_idx").on(
      table.actorId,
      table.expiresAt,
    ),
    index("upload_reservations_expiry_idx").on(table.expiresAt),
  ],
);

export const multipartUploads = sqliteTable(
  "multipart_uploads",
  {
    uploadId: text("upload_id").primaryKey(),
    objectKey: text("object_key").notNull().unique(),
    reservationId: text("reservation_id"),
    actorId: text("actor_id").notNull(),
    contentType: text("content_type").notNull(),
    fileSize: integer("file_size").notNull(),
    partSize: integer("part_size").notNull(),
    maxPartNumber: integer("max_part_number").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(nowTimestamp)
      .notNull(),
  },
  (table) => [
    index("multipart_uploads_actor_expiry_idx").on(
      table.actorId,
      table.expiresAt,
    ),
    index("multipart_uploads_expiry_idx").on(table.expiresAt),
  ],
);
