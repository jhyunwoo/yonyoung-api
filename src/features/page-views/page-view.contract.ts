import { z } from "../../shared/openapi/zod";
import {
  EXAMPLE_ID,
  EXAMPLE_PARENT_ID,
} from "../../shared/openapi/field-builders";

export const ApiRecordViewBodySchema = z
  .object({
    resourceType: z.enum(["activity", "exhibition", "home", "notice"]).openapi({
      description: "조회수를 기록할 리소스 타입",
      example: "activity",
    }),
    resourceId: z.string().max(128).optional().openapi({
      description: "조회수를 기록할 리소스 UUID (home인 경우 생략 가능)",
      example: EXAMPLE_ID,
    }),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      (value.resourceType === "activity" ||
        value.resourceType === "exhibition") &&
      !z.string().uuid().safeParse(value.resourceId).success
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["resourceId"],
        message:
          "activity/exhibition 조회에는 유효한 리소스 UUID가 필요합니다.",
      });
    }
  })
  .openapi("ApiRecordViewBody");

export const ApiViewCountsQuerySchema = z
  .object({
    resourceType: z.enum(["activity", "exhibition", "home", "notice"]).openapi({
      description: "조회수를 조회할 리소스 타입",
      example: "activity",
    }),
    resourceIds: z
      .string()
      .min(1, "resourceIds는 필수입니다.")
      .openapi({
        description: "쉼표(,)로 구분된 리소스 UUID 목록",
        example: `${EXAMPLE_ID},${EXAMPLE_PARENT_ID}`,
      }),
  })
  .openapi("ApiViewCountsQuery");

export const ApiViewCountsResponseSchema = z
  .record(z.string(), z.number().int().nonnegative())
  .openapi("ApiViewCountsResponse");
export const ApiRecordPageViewRequestSchema = z
  .object({
    pageType: z.enum(["home", "activity", "exhibition", "notice"]).openapi({
      description: "페이지 타입",
      example: "activity",
    }),
    resourceId: z.string().max(128).optional().openapi({
      description: "리소스 ID (activity/exhibition/notice의 경우)",
      example: EXAMPLE_ID,
    }),
  })
  .superRefine((value, ctx) => {
    if (
      (value.pageType === "activity" || value.pageType === "exhibition") &&
      !z.string().uuid().safeParse(value.resourceId).success
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["resourceId"],
        message:
          "activity/exhibition 방문에는 유효한 리소스 UUID가 필요합니다.",
      });
    }
  })
  .openapi("ApiRecordPageViewRequest");

export const ApiPageViewStatsSchema = z
  .object({
    totalViews: z
      .number()
      .int()
      .nonnegative()
      .openapi({ description: "전체 방문 수" }),
    homeViews: z
      .number()
      .int()
      .nonnegative()
      .openapi({ description: "홈 방문 수" }),
    activityViews: z
      .number()
      .int()
      .nonnegative()
      .openapi({ description: "활동 방문 수" }),
    exhibitionViews: z
      .number()
      .int()
      .nonnegative()
      .openapi({ description: "전시 방문 수" }),
    noticeViews: z
      .number()
      .int()
      .nonnegative()
      .openapi({ description: "공지 방문 수" }),
    topActivities: z
      .array(
        z.object({
          resourceId: z.string(),
          count: z.number().int().nonnegative(),
        }),
      )
      .openapi({ description: "조회수 상위 활동 (최대 10개)" }),
    topExhibitions: z
      .array(
        z.object({
          resourceId: z.string(),
          count: z.number().int().nonnegative(),
        }),
      )
      .openapi({ description: "조회수 상위 전시 (최대 10개)" }),
    dailyTrend: z
      .array(
        z.object({
          date: z.string(),
          count: z.number().int().nonnegative(),
        }),
      )
      .openapi({ description: "최근 30일 일별 방문 추세" }),
  })
  .openapi("ApiPageViewStats");

export const ApiDashboardPageViewStatsSchema = z
  .object({
    today: z.object({
      count: z
        .number()
        .int()
        .nonnegative()
        .openapi({ description: "오늘 방문 수" }),
      prevCount: z
        .number()
        .int()
        .nonnegative()
        .openapi({ description: "어제 방문 수" }),
    }),
    thisWeek: z.object({
      count: z
        .number()
        .int()
        .nonnegative()
        .openapi({ description: "이번 주 방문 수" }),
      prevCount: z
        .number()
        .int()
        .nonnegative()
        .openapi({ description: "지난 주 방문 수" }),
    }),
    dailyTrend: z
      .array(
        z.object({
          date: z.string(),
          count: z.number().int().nonnegative(),
        }),
      )
      .openapi({ description: "최근 30일 일별 방문 추세" }),
  })
  .openapi("ApiDashboardPageViewStats");
