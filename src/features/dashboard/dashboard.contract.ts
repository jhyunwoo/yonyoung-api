import { z } from "../../shared/openapi/zod";

export const ApiAdminDashboardStatsQuerySchema = z
  .object({
    generationSortOrder: z.coerce
      .number()
      .int()
      .nonnegative()
      .optional()
      .openapi({
        description: "선택 기수 sortOrder",
        example: 60,
      }),
  })
  .openapi("ApiAdminDashboardStatsQuery");

export const ApiAdminDashboardStatsSchema = z
  .object({
    usersTotal: z.number().int().nonnegative().openapi({
      description: "전체 사용자 수",
      example: 120,
    }),
    unverifiedUsersTotal: z.number().int().nonnegative().openapi({
      description: "미승인 사용자 수(unverified)",
      example: 8,
    }),
    generationsTotal: z.number().int().nonnegative().openapi({
      description: "전체 기수 수",
      example: 12,
    }),
    selectedGenerationMembersTotal: z.number().int().nonnegative().openapi({
      description: "선택 기수 멤버 수",
      example: 34,
    }),
    selectedGenerationActivitiesTotal: z.number().int().nonnegative().openapi({
      description: "선택 기수 활동 수",
      example: 15,
    }),
    selectedGenerationExhibitionsTotal: z.number().int().nonnegative().openapi({
      description: "선택 기수 전시 수",
      example: 2,
    }),
    linktreeLinksTotal: z.number().int().nonnegative().openapi({
      description: "링크트리 전체 링크 수",
      example: 19,
    }),
    r2StorageUsedBytes: z.number().int().nonnegative().openapi({
      description: "R2 버킷 전체 사용량(bytes)",
      example: 2147483648,
    }),
    r2StorageLimitBytes: z.number().int().positive().openapi({
      description: "R2 사용량 기준 한도(bytes), 기본 10GB",
      example: 10737418240,
    }),
    r2StorageUsageAvailable: z.boolean().openapi({
      description:
        "R2 사용량 조회 성공 여부. false면 사용량 수치는 표시용 기본값일 수 있습니다.",
      example: true,
    }),
    r2StorageUsageReason: z
      .enum(["ok", "partial", "binding_missing", "scan_failed"])
      .openapi({
        description:
          "R2 사용량 조회 결과 사유. `partial`은 스캔 예산 초과로 합계가 하한값임을, `binding_missing`/`scan_failed`는 조회 실패를 의미합니다.",
        example: "ok",
      }),
    r2StorageObservedAt: z.string().openapi({
      description:
        "R2 사용량을 관측한 시각(ISO 8601). 캐시된 값이면 캐시 생성 시각입니다.",
      example: "2026-07-27T11:03:19.265Z",
    }),
  })
  .openapi("ApiAdminDashboardStats");
