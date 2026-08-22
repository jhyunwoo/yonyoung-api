import { z } from "../../shared/openapi/zod";
import {
  EXAMPLE_AUDIT_ID,
  EXAMPLE_PARENT_ID,
  EXAMPLE_TIMESTAMP_MS,
  EXAMPLE_USER_ID,
  timestampField,
} from "../../shared/openapi/field-builders";

const ApiAuditResourceTypeSchema = z
  .enum([
    "generation",
    "activity",
    "exhibition",
    "linktree",
    "linktree_item",
    "user",
    "attachment",
  ])
  .openapi("ApiAuditResourceType");

export const ApiAuditParamSchema = z
  .object({
    resourceType: ApiAuditResourceTypeSchema.openapi({
      description: "감사 로그 조회 대상 리소스 타입",
      example: "activity",
    }),
    resourceId: z.string().min(1, "resourceId를 입력해 주세요.").openapi({
      description: "감사 로그 조회 대상 리소스 ID",
      example: EXAMPLE_PARENT_ID,
    }),
  })
  .superRefine((value, context) => {
    if (value.resourceType === "user") {
      return;
    }

    const uuidResult = z.string().uuid().safeParse(value.resourceId);
    if (!uuidResult.success) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["resourceId"],
        message: "resourceId 형식이 올바르지 않습니다.",
      });
    }
  })
  .openapi("ApiAuditParam");

export const ApiAuditQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20).openapi({
      description: "조회할 최대 로그 수 (기본 20, 최대 100)",
      example: 20,
    }),
  })
  .openapi("ApiAuditQuery");

export const ApiAuditActorSchema = z
  .object({
    id: z.string().openapi({
      description: "수정자 식별자 (better-auth user.id)",
      example: EXAMPLE_USER_ID,
    }),
    name: z.string().openapi({
      description: "수정자 이름",
      example: "홍길동",
    }),
    familyName: z.string().nullable().openapi({
      description: "수정자 성",
      example: "홍",
    }),
    givenName: z.string().nullable().openapi({
      description: "수정자 이름(given name)",
      example: "길동",
    }),
    role: z.string().nullable().openapi({
      description: "수정자 역할 문자열",
      example: "manager",
    }),
  })
  .openapi("ApiAuditActor");

export const ApiAuditLogSchema = z
  .object({
    id: z.string().uuid().openapi({
      description: "감사 로그 UUID",
      example: EXAMPLE_AUDIT_ID,
    }),
    resourceType: ApiAuditResourceTypeSchema.openapi({
      description: "변경 대상 리소스 타입",
      example: "activity",
    }),
    resourceId: z.string().openapi({
      description: "변경 대상 리소스 ID",
      example: EXAMPLE_PARENT_ID,
    }),
    action: z.enum(["create", "update", "delete"]).openapi({
      description: "수행된 변경 액션",
      example: "update",
    }),
    actor: ApiAuditActorSchema.nullable().openapi({
      description: "수정자 정보",
    }),
    changedFields: z.array(z.string()).openapi({
      description: "변경된 필드 목록",
      example: ["title", "description", "updatedAt"],
    }),
    createdAt: timestampField("변경 시각", EXAMPLE_TIMESTAMP_MS),
  })
  .openapi("ApiAuditLog");
