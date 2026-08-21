import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";
import type createDB from "../../lib/db";
import { activities, exhibitions, pageViews } from "../../platform/db/schema";
import type {
  DashboardPageViewStatsEntity,
  PageViewStatsEntity,
} from "../../lib/services/types";
import {
  normalizePageViewResourceId,
  type PageViewType,
} from "../../lib/views/page-view-target";

type Database = ReturnType<typeof createDB>;

const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// 페이지뷰 집계는 UTC가 아니라 한국 시간 기준 하루 경계로 묶는다.
const toKstDailyBucketStart = (timestamp: number): number =>
  Math.floor((timestamp + KST_OFFSET_MS) / DAY_MS) * DAY_MS - KST_OFFSET_MS;

export const createPageViewRepository = (db: Database) => ({
  async isActiveViewResource(
    pageType: PageViewType,
    resourceId: string | undefined,
  ): Promise<boolean> {
    if (pageType === "home" || pageType === "notice") {
      return true;
    }
    if (!resourceId) {
      return false;
    }

    if (pageType === "activity") {
      const rows = await db
        .select({ id: activities.id })
        .from(activities)
        .where(and(eq(activities.id, resourceId), isNull(activities.deletedAt)))
        .limit(1);
      return rows.length > 0;
    }

    const rows = await db
      .select({ id: exhibitions.id })
      .from(exhibitions)
      .where(and(eq(exhibitions.id, resourceId), isNull(exhibitions.deletedAt)))
      .limit(1);
    return rows.length > 0;
  },
  /**
   * KST 일자와 리소스별로 한 행만 유지하고 조회수를 원자적으로 누적합니다.
   */
  async recordPageView(
    pageType: PageViewType,
    resourceId: string | undefined,
  ): Promise<void> {
    const normalizedResourceId = normalizePageViewResourceId(
      pageType,
      resourceId,
    );
    const bucketStart = toKstDailyBucketStart(Date.now());
    const bucketId = `daily:${pageType}:${normalizedResourceId}:${bucketStart}`;

    await db
      .insert(pageViews)
      .values({
        id: bucketId,
        pageType,
        resourceId: normalizedResourceId,
        viewCount: 1,
        visitedAt: new Date(bucketStart),
      })
      .onConflictDoUpdate({
        target: pageViews.id,
        set: {
          viewCount: sql`${pageViews.viewCount} + 1`,
        },
      });
  },
  /**
   * getPageViewStats 방문 통계를 집계해 반환합니다.
   * @returns 전체/타입별 카운트, 상위 활동/전시, 30일 일별 추세를 포함한 통계.
   * @remarks 모든 집계 쿼리는 page_views 테이블 단독 조회로 수행됩니다.
   */
  async getPageViewStats(): Promise<PageViewStatsEntity> {
    const countsByType = await db
      .select({
        pageType: pageViews.pageType,
        count: sql<number>`coalesce(sum(${pageViews.viewCount}), 0)`,
      })
      .from(pageViews)
      .groupBy(pageViews.pageType);

    let homeViews = 0;
    let activityViews = 0;
    let exhibitionViews = 0;
    let noticeViews = 0;
    for (const row of countsByType) {
      const value = Number(row.count) || 0;
      if (row.pageType === "home") {
        homeViews = value;
      } else if (row.pageType === "activity") {
        activityViews = value;
      } else if (row.pageType === "exhibition") {
        exhibitionViews = value;
      } else if (row.pageType === "notice") {
        noticeViews = value;
      }
    }
    const totalViews =
      homeViews + activityViews + exhibitionViews + noticeViews;

    const topActivitiesRows = await db
      .select({
        resourceId: pageViews.resourceId,
        count: sql<number>`coalesce(sum(${pageViews.viewCount}), 0)`,
      })
      .from(pageViews)
      .where(eq(pageViews.pageType, "activity"))
      .groupBy(pageViews.resourceId)
      .orderBy(sql`sum(${pageViews.viewCount}) desc`)
      .limit(10);

    const topExhibitionsRows = await db
      .select({
        resourceId: pageViews.resourceId,
        count: sql<number>`coalesce(sum(${pageViews.viewCount}), 0)`,
      })
      .from(pageViews)
      .where(eq(pageViews.pageType, "exhibition"))
      .groupBy(pageViews.resourceId)
      .orderBy(sql`sum(${pageViews.viewCount}) desc`)
      .limit(10);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const dailyTrendRows = await db
      .select({
        date: sql<string>`date((${pageViews.visitedAt} + ${KST_OFFSET_MS}) / 1000, 'unixepoch')`,
        count: sql<number>`coalesce(sum(${pageViews.viewCount}), 0)`,
      })
      .from(pageViews)
      .where(gte(pageViews.visitedAt, thirtyDaysAgo))
      .groupBy(
        sql`date((${pageViews.visitedAt} + ${KST_OFFSET_MS}) / 1000, 'unixepoch')`,
      )
      .orderBy(
        sql`date((${pageViews.visitedAt} + ${KST_OFFSET_MS}) / 1000, 'unixepoch')`,
      );

    return {
      totalViews,
      homeViews,
      activityViews,
      exhibitionViews,
      noticeViews,
      topActivities: topActivitiesRows
        .filter(
          (row): row is { resourceId: string; count: number } =>
            typeof row.resourceId === "string" && row.resourceId.length > 0,
        )
        .map((row) => ({
          resourceId: row.resourceId,
          count: Number(row.count) || 0,
        })),
      topExhibitions: topExhibitionsRows
        .filter(
          (row): row is { resourceId: string; count: number } =>
            typeof row.resourceId === "string" && row.resourceId.length > 0,
        )
        .map((row) => ({
          resourceId: row.resourceId,
          count: Number(row.count) || 0,
        })),
      dailyTrend: dailyTrendRows.map((row) => ({
        date: row.date,
        count: Number(row.count) || 0,
      })),
    };
  },

  async getDashboardPageViewStats(): Promise<DashboardPageViewStatsEntity> {
    // KST 기준 시간 계산
    const now = new Date();
    const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);

    const startOfTodayKST = new Date(kstNow);
    startOfTodayKST.setUTCHours(0, 0, 0, 0);
    const startOfTodayUTC = new Date(
      startOfTodayKST.getTime() - 9 * 60 * 60 * 1000,
    );

    const startOfYesterdayUTC = new Date(
      startOfTodayUTC.getTime() - 24 * 60 * 60 * 1000,
    );

    // 이번 주 월요일 00:00:00 (KST)
    const dayOfWeek = kstNow.getUTCDay(); // 0: Sun, 1: Mon, ...
    const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const startOfThisWeekKST = new Date(
      startOfTodayKST.getTime() - diffToMonday * 24 * 60 * 60 * 1000,
    );
    const startOfThisWeekUTC = new Date(
      startOfThisWeekKST.getTime() - 9 * 60 * 60 * 1000,
    );

    const startOfLastWeekUTC = new Date(
      startOfThisWeekUTC.getTime() - 7 * 24 * 60 * 60 * 1000,
    );

    const [todayCount, yesterdayCount, thisWeekCount, lastWeekCount] =
      await Promise.all([
        // Today
        db
          .select({
            count: sql<number>`coalesce(sum(${pageViews.viewCount}), 0)`,
          })
          .from(pageViews)
          .where(and(gte(pageViews.visitedAt, startOfTodayUTC))),
        // Yesterday
        db
          .select({
            count: sql<number>`coalesce(sum(${pageViews.viewCount}), 0)`,
          })
          .from(pageViews)
          .where(
            and(
              gte(pageViews.visitedAt, startOfYesterdayUTC),
              lt(pageViews.visitedAt, startOfTodayUTC),
            ),
          ),
        // This Week
        db
          .select({
            count: sql<number>`coalesce(sum(${pageViews.viewCount}), 0)`,
          })
          .from(pageViews)
          .where(and(gte(pageViews.visitedAt, startOfThisWeekUTC))),
        // Last Week
        db
          .select({
            count: sql<number>`coalesce(sum(${pageViews.viewCount}), 0)`,
          })
          .from(pageViews)
          .where(
            and(
              gte(pageViews.visitedAt, startOfLastWeekUTC),
              lt(pageViews.visitedAt, startOfThisWeekUTC),
            ),
          ),
      ]);

    const thirtyDaysAgo = new Date(
      startOfTodayUTC.getTime() - 30 * 24 * 60 * 60 * 1000,
    );
    const dailyTrendRows = await db
      .select({
        // visitedAt + 9시간을 하여 KST 날짜를 구함
        date: sql<string>`date((${pageViews.visitedAt} + 32400000) / 1000, 'unixepoch')`,
        count: sql<number>`coalesce(sum(${pageViews.viewCount}), 0)`,
      })
      .from(pageViews)
      .where(gte(pageViews.visitedAt, thirtyDaysAgo))
      .groupBy(
        sql`date((${pageViews.visitedAt} + 32400000) / 1000, 'unixepoch')`,
      )
      .orderBy(
        sql`date((${pageViews.visitedAt} + 32400000) / 1000, 'unixepoch')`,
      );

    return {
      today: {
        count: Number(todayCount[0]?.count) || 0,
        prevCount: Number(yesterdayCount[0]?.count) || 0,
      },
      thisWeek: {
        count: Number(thisWeekCount[0]?.count) || 0,
        prevCount: Number(lastWeekCount[0]?.count) || 0,
      },
      dailyTrend: dailyTrendRows.map((row) => ({
        date: row.date,
        count: Number(row.count) || 0,
      })),
    };
  },
});

export type PageViewRepository = ReturnType<typeof createPageViewRepository>;
