import { relations } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { generations } from "./generations";

import { nowTimestamp } from "./columns";

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" })
    .default(false)
    .notNull(),
  image: text("image"),
  showcaseImageUrls: text("showcase_image_urls").default("[]").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(nowTimestamp)
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(nowTimestamp)
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
  familyName: text("family_name"),
  givenName: text("given_name"),
  college: text("college"),
  department: text("department"),
  studentNumber: text("student_number"),
  phoneNumber: text("phone_number"),
  collaborationAvailable: integer("collaboration_available", {
    mode: "boolean",
  })
    .default(false)
    .notNull(),
  personalLink: text("personal_link"),
  role: text("role").default("unverified"),
  generationId: text("generation_id").references(() => generations.id, {
    onDelete: "set null",
  }),
  latestGenerationSortOrder: integer("latest_generation_sort_order"),
  deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
});

export const userGenerations = sqliteTable(
  "user_generations",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, {
        onDelete: "cascade",
      }),
    generationId: text("generation_id")
      .notNull()
      .references(() => generations.id, {
        onDelete: "cascade",
      }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(nowTimestamp)
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.generationId] }),
    index("user_generations_user_id_idx").on(table.userId),
    index("user_generations_generation_id_idx").on(table.generationId),
  ],
);

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(nowTimestamp)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", {
      mode: "timestamp_ms",
    }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", {
      mode: "timestamp_ms",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(nowTimestamp)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(nowTimestamp)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowTimestamp)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const userRelations = relations(user, ({ many, one }) => ({
  generation: one(generations, {
    fields: [user.generationId],
    references: [generations.id],
  }),
  generationLinks: many(userGenerations),
  sessions: many(session),
  accounts: many(account),
}));

export const userGenerationsRelations = relations(
  userGenerations,
  ({ one }) => ({
    user: one(user, {
      fields: [userGenerations.userId],
      references: [user.id],
    }),
    generation: one(generations, {
      fields: [userGenerations.generationId],
      references: [generations.id],
    }),
  }),
);

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));
