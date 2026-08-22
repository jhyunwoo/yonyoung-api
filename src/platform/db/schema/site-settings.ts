import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { nowTimestamp } from "./columns";

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
