import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type createDB from "../../lib/db";
import {
  activities,
  exhibitions,
  generations,
  linktree,
  linktreeItems,
  user,
  userGenerations,
} from "../../platform/db/schema";
import type { AdminDashboardStatsEntity } from "../../lib/services/types";
import { isMissingUserGenerationsTableError } from "../../platform/db/legacy-schema";

type Database = ReturnType<typeof createDB>;

export const createDashboardReadRepository = (db: Database) => ({
  async getAdminDashboardStats(
    generationSortOrder: number | null,
  ): Promise<AdminDashboardStatsEntity> {
    const hasGenerationFilter =
      typeof generationSortOrder === "number" &&
      Number.isFinite(generationSortOrder);

    // 세대 ID를 별도 왕복으로 조회하지 않고 서브쿼리로 인라인해
    // 전체 집계를 단일 병렬 단계(D1 왕복 깊이 1)로 수행한다.
    const selectedGenerationIdSubquery = () =>
      db
        .select({ id: generations.id })
        .from(generations)
        .where(
          and(
            eq(generations.sortOrder, generationSortOrder as number),
            isNull(generations.deletedAt),
          ),
        );

    const [
      usersCountRows,
      unverifiedUsersCountRows,
      generationsCountRows,
      linktreeLinksCountRows,
      generationScopedTotals,
    ] = await Promise.all([
      db
        .select({ value: sql<number>`count(*)` })
        .from(user)
        .where(isNull(user.deletedAt)),
      db
        .select({ value: sql<number>`count(*)` })
        .from(user)
        .where(and(isNull(user.deletedAt), eq(user.role, "unverified"))),
      db
        .select({ value: sql<number>`count(*)` })
        .from(generations)
        .where(isNull(generations.deletedAt)),
      db
        .select({ value: sql<number>`count(*)` })
        .from(linktreeItems)
        .innerJoin(linktree, eq(linktreeItems.linktreeId, linktree.id))
        .where(
          and(isNull(linktreeItems.deletedAt), isNull(linktree.deletedAt)),
        ),
      hasGenerationFilter
        ? (async () => {
            const [activitiesCountRows, exhibitionsCountRows, membersTotal] =
              await Promise.all([
                db
                  .select({ value: sql<number>`count(*)` })
                  .from(activities)
                  .where(
                    and(
                      inArray(
                        activities.generationId,
                        selectedGenerationIdSubquery(),
                      ),
                      isNull(activities.deletedAt),
                    ),
                  ),
                db
                  .select({ value: sql<number>`count(*)` })
                  .from(exhibitions)
                  .where(
                    and(
                      inArray(
                        exhibitions.generationId,
                        selectedGenerationIdSubquery(),
                      ),
                      isNull(exhibitions.deletedAt),
                    ),
                  ),
                (async () => {
                  try {
                    const memberRows = await db
                      .select({
                        userId: userGenerations.userId,
                      })
                      .from(userGenerations)
                      .innerJoin(user, eq(userGenerations.userId, user.id))
                      .where(
                        and(
                          inArray(
                            userGenerations.generationId,
                            selectedGenerationIdSubquery(),
                          ),
                          isNull(user.deletedAt),
                        ),
                      );
                    return new Set(memberRows.map((row) => row.userId)).size;
                  } catch (error) {
                    if (!isMissingUserGenerationsTableError(error)) {
                      throw error;
                    }
                    const fallbackRows = await db
                      .select({ value: sql<number>`count(*)` })
                      .from(user)
                      .where(
                        and(
                          inArray(
                            user.generationId,
                            selectedGenerationIdSubquery(),
                          ),
                          isNull(user.deletedAt),
                        ),
                      );
                    return fallbackRows[0]?.value ?? 0;
                  }
                })(),
              ]);

            return {
              membersTotal,
              activitiesTotal: activitiesCountRows[0]?.value ?? 0,
              exhibitionsTotal: exhibitionsCountRows[0]?.value ?? 0,
            };
          })()
        : Promise.resolve(null),
    ]);

    const selectedGenerationMembersTotal =
      generationScopedTotals?.membersTotal ?? 0;
    const selectedGenerationActivitiesTotal =
      generationScopedTotals?.activitiesTotal ?? 0;
    const selectedGenerationExhibitionsTotal =
      generationScopedTotals?.exhibitionsTotal ?? 0;

    return {
      usersTotal: usersCountRows[0]?.value ?? 0,
      unverifiedUsersTotal: unverifiedUsersCountRows[0]?.value ?? 0,
      generationsTotal: generationsCountRows[0]?.value ?? 0,
      selectedGenerationMembersTotal,
      selectedGenerationActivitiesTotal,
      selectedGenerationExhibitionsTotal,
      linktreeLinksTotal: linktreeLinksCountRows[0]?.value ?? 0,
    };
  },
});

export type DashboardReadRepository = ReturnType<
  typeof createDashboardReadRepository
>;
