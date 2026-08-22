import { eq } from "drizzle-orm";
import type createDB from "../../lib/db";
import { recruitingPlans } from "../../platform/db/schema";
import type { RecruitingPlanEntity } from "../../lib/services/types";
import { parseJsonStringArray } from "../../platform/db/row-values";

type Database = ReturnType<typeof createDB>;

// "현재 모집 계획"은 UTC가 아니라 한국 기준 연도로 결정된다.
const KOREA_TIME_ZONE = "Asia/Seoul";
const koreanYearFormatter = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  timeZone: KOREA_TIME_ZONE,
});

const readCurrentKoreanYear = (): number => {
  const formatted = koreanYearFormatter.format(Date.now());
  const parsed = Number.parseInt(formatted, 10);
  return Number.isFinite(parsed) ? parsed : new Date().getUTCFullYear();
};

const serializePromotionImageUrls = (value: string[] | undefined): string =>
  JSON.stringify(value ?? []);

const toRecruitingPlanEntity = (
  row: typeof recruitingPlans.$inferSelect,
): RecruitingPlanEntity => ({
  year: row.year,
  title: row.title,
  content: row.content,
  promotionImageUrls: parseJsonStringArray(row.promotionImageUrls),
  recruitmentStartAt: row.recruitmentStartAt,
  recruitmentEndAt: row.recruitmentEndAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export type UpsertRecruitingPlanInput = {
  title: string;
  content: string;
  promotionImageUrls: string[];
  recruitmentStartAt: Date;
  recruitmentEndAt: Date;
};

export const createRecruitingPlanRepository = (db: Database) => ({
  async getCurrentRecruitingPlan(): Promise<RecruitingPlanEntity | null> {
    const currentYear = readCurrentKoreanYear();
    const row =
      (await db.query.recruitingPlans.findFirst({
        where: eq(recruitingPlans.year, currentYear),
      })) ?? null;

    if (!row) {
      return null;
    }

    return toRecruitingPlanEntity(row);
  },

  async upsertCurrentRecruitingPlan(
    input: UpsertRecruitingPlanInput,
  ): Promise<RecruitingPlanEntity> {
    const currentYear = readCurrentKoreanYear();

    await db
      .insert(recruitingPlans)
      .values({
        year: currentYear,
        title: input.title,
        content: input.content,
        promotionImageUrls: serializePromotionImageUrls(
          input.promotionImageUrls,
        ),
        recruitmentStartAt: input.recruitmentStartAt,
        recruitmentEndAt: input.recruitmentEndAt,
      })
      .onConflictDoUpdate({
        target: recruitingPlans.year,
        set: {
          title: input.title,
          content: input.content,
          promotionImageUrls: serializePromotionImageUrls(
            input.promotionImageUrls,
          ),
          recruitmentStartAt: input.recruitmentStartAt,
          recruitmentEndAt: input.recruitmentEndAt,
          updatedAt: new Date(),
        },
      });

    const saved = await db.query.recruitingPlans.findFirst({
      where: eq(recruitingPlans.year, currentYear),
    });
    if (!saved) {
      throw new Error("현재 연도 모집 계획 저장 결과를 찾을 수 없습니다.");
    }

    return toRecruitingPlanEntity(saved);
  },
});

export type RecruitingPlanRepository = ReturnType<
  typeof createRecruitingPlanRepository
>;
