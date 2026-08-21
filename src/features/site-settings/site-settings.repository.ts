import { eq } from "drizzle-orm";
import { DEFAULT_SITE_SETTINGS } from "../../shared/api-contracts";
import type createDB from "../../lib/db";
import { siteSettings } from "../../platform/db/schema";
import type { SiteSettingsEntity } from "../../lib/services/types";

type Database = ReturnType<typeof createDB>;

// 사이트 설정은 행이 하나뿐인 싱글턴 테이블이다.
const SITE_SETTINGS_SINGLETON_ID = "default";

const normalizeInstagramId = (value: string): string =>
  value.trim().replace(/^@+/, "");

const toSiteSettingsEntity = (
  row: typeof siteSettings.$inferSelect | null,
): SiteSettingsEntity => {
  if (!row) {
    return { ...DEFAULT_SITE_SETTINGS };
  }

  return {
    footerOpenChatUrl: row.footerOpenChatUrl,
    footerInstagramId: normalizeInstagramId(row.footerInstagramId),
    footerEmail: row.footerEmail,
    footerPhone: row.footerPhone,
    footerAddress: row.footerAddress,
    donateBankName: row.donateBankName,
    donateAccountNumber: row.donateAccountNumber,
    donateAccountHolder: row.donateAccountHolder,
  };
};

export const createSiteSettingsRepository = (db: Database) => {
  const getSiteSettings = async (): Promise<SiteSettingsEntity> => {
    const row =
      (await db.query.siteSettings.findFirst({
        where: eq(siteSettings.id, SITE_SETTINGS_SINGLETON_ID),
      })) ?? null;
    return toSiteSettingsEntity(row);
  };

  return {
    getSiteSettings,

    async updateSiteSettings(
      input: Partial<SiteSettingsEntity>,
    ): Promise<SiteSettingsEntity> {
      const current = await getSiteSettings();
      const next: SiteSettingsEntity = {
        ...current,
        ...input,
      };

      next.footerInstagramId = normalizeInstagramId(next.footerInstagramId);

      await db
        .insert(siteSettings)
        .values({
          id: SITE_SETTINGS_SINGLETON_ID,
          footerOpenChatUrl: next.footerOpenChatUrl,
          footerInstagramId: next.footerInstagramId,
          footerEmail: next.footerEmail,
          footerPhone: next.footerPhone,
          footerAddress: next.footerAddress,
          donateBankName: next.donateBankName,
          donateAccountNumber: next.donateAccountNumber,
          donateAccountHolder: next.donateAccountHolder,
        })
        .onConflictDoUpdate({
          target: siteSettings.id,
          set: {
            footerOpenChatUrl: next.footerOpenChatUrl,
            footerInstagramId: next.footerInstagramId,
            footerEmail: next.footerEmail,
            footerPhone: next.footerPhone,
            footerAddress: next.footerAddress,
            donateBankName: next.donateBankName,
            donateAccountNumber: next.donateAccountNumber,
            donateAccountHolder: next.donateAccountHolder,
            updatedAt: new Date(),
          },
        });

      return next;
    },
  };
};

export type SiteSettingsRepository = ReturnType<
  typeof createSiteSettingsRepository
>;
