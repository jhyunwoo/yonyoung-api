import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const nowTimestamp = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

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
      .$onUpdate(/** integer("updated_at", { mode: "timestamp_ms" })
      .default(nowTimestamp)
      .$onUpdate 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @returns 함수 실행 결과를 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ () => /* @__PURE__ */ new Date())
      .notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
    /**
   * sqliteTable 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다.
   * @param table 함수 로직에서 사용하는 입력값입니다.
   * @returns 함수 실행 결과를 반환합니다.
   * @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다.
   */
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
    .$onUpdate(/** integer("updated_at", { mode: "timestamp_ms" })
    .default(nowTimestamp)
    .$onUpdate 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @returns 함수 실행 결과를 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ () => /* @__PURE__ */ new Date())
    .notNull(),
  familyName: text("family_name"),
  givenName: text("given_name"),
  college: text("college"),
  department: text("department"),
  studentNumber: text("student_number"),
  phoneNumber: text("phone_number"),
  collaborationAvailable: integer("collaboration_available", { mode: "boolean" })
    .default(false)
    .notNull(),
  personalLink: text("personal_link"),
  role: text("role").default("unverified"),
  generationId: text("generation_id").references(/** text("generation_id").references 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @returns 함수 실행 결과를 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ () => generations.id, {
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
      .references(/** text("user_id")
      .notNull()
      .references 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @returns 함수 실행 결과를 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ () => user.id, {
        onDelete: "cascade",
      }),
    generationId: text("generation_id")
      .notNull()
      .references(/** text("generation_id")
      .notNull()
      .references 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @returns 함수 실행 결과를 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ () => generations.id, {
        onDelete: "cascade",
      }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(nowTimestamp)
      .notNull(),
  },
    /**
   * sqliteTable 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다.
   * @param table 함수 로직에서 사용하는 입력값입니다.
   * @returns 함수 실행 결과를 반환합니다.
   * @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다.
   */
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
      .$onUpdate(/** integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @returns 함수 실행 결과를 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ () => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(/** text("user_id")
      .notNull()
      .references 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @returns 함수 실행 결과를 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ () => user.id, { onDelete: "cascade" }),
  },
    /**
   * sqliteTable 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다.
   * @param table 함수 로직에서 사용하는 입력값입니다.
   * @returns 함수 실행 결과를 반환합니다.
   * @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다.
   */
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
      .references(/** text("user_id")
      .notNull()
      .references 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @returns 함수 실행 결과를 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ () => user.id, { onDelete: "cascade" }),
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
      .$onUpdate(/** integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @returns 함수 실행 결과를 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ () => /* @__PURE__ */ new Date())
      .notNull(),
  },
    /**
   * sqliteTable 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다.
   * @param table 함수 로직에서 사용하는 입력값입니다.
   * @returns 함수 실행 결과를 반환합니다.
   * @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다.
   */
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
      .$onUpdate(/** integer("updated_at", { mode: "timestamp_ms" })
      .default(nowTimestamp)
      .$onUpdate 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @returns 함수 실행 결과를 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ () => /* @__PURE__ */ new Date())
      .notNull(),
  },
    /**
   * sqliteTable 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다.
   * @param table 함수 로직에서 사용하는 입력값입니다.
   * @returns 함수 실행 결과를 반환합니다.
   * @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다.
   */
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

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
      .references(/** text("generation_id")
      .notNull()
      .references 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @returns 함수 실행 결과를 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ () => generations.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(nowTimestamp)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowTimestamp)
      .$onUpdate(/** integer("updated_at", { mode: "timestamp_ms" })
      .default(nowTimestamp)
      .$onUpdate 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @returns 함수 실행 결과를 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ () => /* @__PURE__ */ new Date())
      .notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
    /**
   * sqliteTable 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다.
   * @param table 함수 로직에서 사용하는 입력값입니다.
   * @returns 함수 실행 결과를 반환합니다.
   * @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다.
   */
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
      .references(/** text("activity_id")
      .notNull()
      .references 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @returns 함수 실행 결과를 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ () => activities.id, { onDelete: "cascade" }),
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
      .$onUpdate(/** integer("updated_at", { mode: "timestamp_ms" })
      .default(nowTimestamp)
      .$onUpdate 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @returns 함수 실행 결과를 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ () => /* @__PURE__ */ new Date())
      .notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
    /**
   * sqliteTable 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다.
   * @param table 함수 로직에서 사용하는 입력값입니다.
   * @returns 함수 실행 결과를 반환합니다.
   * @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다.
   */
  (table) => [
    index("activity_images_activity_id_idx").on(table.activityId),
    index("activity_images_sort_order_idx").on(table.sortOrder),
  ],
);

export const exhibitions = sqliteTable(
  "exhibitions",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    startDate: integer("start_date", { mode: "timestamp_ms" }).notNull(),
    endDate: integer("end_date", { mode: "timestamp_ms" }).notNull(),
    generationId: text("generation_id")
      .notNull()
      .references(/** text("generation_id")
      .notNull()
      .references 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @returns 함수 실행 결과를 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ () => generations.id),
    place: text("place").notNull(),
    coverImageUrl: text("cover_image_url").notNull(),
    description: text("description").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(nowTimestamp)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowTimestamp)
      .$onUpdate(/** integer("updated_at", { mode: "timestamp_ms" })
      .default(nowTimestamp)
      .$onUpdate 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @returns 함수 실행 결과를 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ () => /* @__PURE__ */ new Date())
      .notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
    /**
   * sqliteTable 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다.
   * @param table 함수 로직에서 사용하는 입력값입니다.
   * @returns 함수 실행 결과를 반환합니다.
   * @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다.
   */
  (table) => [
    index("exhibitions_generation_id_idx").on(table.generationId),
    index("exhibitions_start_date_idx").on(table.startDate),
    index("exhibitions_end_date_idx").on(table.endDate),
  ],
);

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

export const exhibitionImages = sqliteTable(
  "exhibition_images",
  {
    id: text("id").primaryKey(),
    exhibitionId: text("exhibition_id")
      .notNull()
      .references(/** text("exhibition_id")
      .notNull()
      .references 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @returns 함수 실행 결과를 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ () => exhibitions.id, { onDelete: "cascade" }),
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
      .$onUpdate(/** integer("updated_at", { mode: "timestamp_ms" })
      .default(nowTimestamp)
      .$onUpdate 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @returns 함수 실행 결과를 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ () => /* @__PURE__ */ new Date())
      .notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
    /**
   * sqliteTable 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다.
   * @param table 함수 로직에서 사용하는 입력값입니다.
   * @returns 함수 실행 결과를 반환합니다.
   * @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다.
   */
  (table) => [
    index("exhibition_images_exhibition_id_idx").on(table.exhibitionId),
    index("exhibition_images_sort_order_idx").on(table.sortOrder),
  ],
);

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
      .references(/** text("linktree_id")
      .notNull()
      .references 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @returns 함수 실행 결과를 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ () => linktree.id, { onDelete: "cascade" }),
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
    /**
   * sqliteTable 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다.
   * @param table 함수 로직에서 사용하는 입력값입니다.
   * @returns 함수 실행 결과를 반환합니다.
   * @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다.
   */
  (table) => [index("linktree_items_linktree_id_idx").on(table.linktreeId)],
);

export const siteSettings = sqliteTable("site_settings", {
  id: text("id").primaryKey(),
  footerOpenChatUrl: text("footer_open_chat_url").notNull(),
  footerInstagramId: text("footer_instagram_id").notNull(),
  footerEmail: text("footer_email").notNull(),
  footerPhone: text("footer_phone").notNull(),
  footerAddress: text("footer_address").notNull(),
  donateBankName: text("donate_bank_name").notNull(),
  donateAccountNumber: text("donate_account_number").notNull(),
  donateAccountHolder: text("donate_account_holder").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(nowTimestamp)
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(nowTimestamp)
    .$onUpdate(() => new Date())
    .notNull(),
});

export const recruitingPlans = sqliteTable("recruiting_plans", {
  year: integer("year").primaryKey(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  promotionImageUrls: text("promotion_image_urls").notNull(),
  recruitmentStartAt: integer("recruitment_start_at", { mode: "timestamp_ms" })
    .notNull(),
  recruitmentEndAt: integer("recruitment_end_at", { mode: "timestamp_ms" })
    .notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(nowTimestamp)
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(nowTimestamp)
    .$onUpdate(() => new Date())
    .notNull(),
});

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

export const uploadReservations = sqliteTable(
  "upload_reservations",
  {
    id: text("id").primaryKey(),
    actorId: text("actor_id").notNull(),
    fileSize: integer("file_size").notNull(),
    observedUsedBytes: integer("observed_used_bytes").notNull(),
    observedAt: integer("observed_at", { mode: "timestamp_ms" }).notNull(),
    grantExpiresAt: integer("grant_expires_at", { mode: "timestamp_ms" }).notNull(),
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

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    action: text("action").notNull(),
    actorId: text("actor_id"),
    actorName: text("actor_name").notNull(),
    actorRole: text("actor_role"),
    changedFields: text("changed_fields").default("[]").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(nowTimestamp)
      .notNull(),
  },
  (table) => [
    index("audit_logs_resource_idx").on(table.resourceType, table.resourceId, table.createdAt),
    index("audit_logs_actor_id_idx").on(table.actorId),
    index("audit_logs_created_at_idx").on(table.createdAt),
  ],
);

export const generationsRelations = relations(generations, /** relations 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @param { many } 함수 로직에서 사용하는 입력값입니다. @returns 함수 실행 결과를 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ ({ many }) => ({
  users: many(user),
  userGenerations: many(userGenerations),
  activities: many(activities),
  exhibitions: many(exhibitions),
}));

export const userRelations = relations(user, /** relations 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @param { many, one } 함수 로직에서 사용하는 입력값입니다. @returns 함수 실행 결과를 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ ({ many, one }) => ({
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
    /**
   * relations 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다.
   * @param { one } 함수 로직에서 사용하는 입력값입니다.
   * @returns 함수 실행 결과를 반환합니다.
   * @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다.
   */
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

export const sessionRelations = relations(session, /** relations 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @param { one } 함수 로직에서 사용하는 입력값입니다. @returns 함수 실행 결과를 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, /** relations 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @param { one } 함수 로직에서 사용하는 입력값입니다. @returns 함수 실행 결과를 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

export const activitiesRelations = relations(activities, /** relations 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @param { many, one } 함수 로직에서 사용하는 입력값입니다. @returns 함수 실행 결과를 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ ({ many, one }) => ({
  generation: one(generations, {
    fields: [activities.generationId],
    references: [generations.id],
  }),
  detailImages: many(activityImages),
}));

export const activityImagesRelations = relations(activityImages, /** relations 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @param { one } 함수 로직에서 사용하는 입력값입니다. @returns 함수 실행 결과를 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ ({ one }) => ({
  activity: one(activities, {
    fields: [activityImages.activityId],
    references: [activities.id],
  }),
}));

export const exhibitionsRelations = relations(exhibitions, /** relations 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @param { many, one } 함수 로직에서 사용하는 입력값입니다. @returns 함수 실행 결과를 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ ({ many, one }) => ({
  generation: one(generations, {
    fields: [exhibitions.generationId],
    references: [generations.id],
  }),
  detailImages: many(exhibitionImages),
}));

export const exhibitionImagesRelations = relations(
  exhibitionImages,
    /**
   * relations 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다.
   * @param { one } 함수 로직에서 사용하는 입력값입니다.
   * @returns 함수 실행 결과를 반환합니다.
   * @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다.
   */
  ({ one }) => ({
    exhibition: one(exhibitions, {
      fields: [exhibitionImages.exhibitionId],
      references: [exhibitions.id],
    }),
  }),
);

export const linktreeRelations = relations(linktree, /** relations 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @param { many } 함수 로직에서 사용하는 입력값입니다. @returns 함수 실행 결과를 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ ({ many }) => ({
  items: many(linktreeItems),
}));

export const linktreeItemsRelations = relations(linktreeItems, /** relations 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @param { one } 함수 로직에서 사용하는 입력값입니다. @returns 함수 실행 결과를 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ ({ one }) => ({
  linktree: one(linktree, {
    fields: [linktreeItems.linktreeId],
    references: [linktree.id],
  }),
}));

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
