import { z } from "../../shared/openapi/zod";
import {
  EXAMPLE_GENERATION_ID,
  EXAMPLE_TIMESTAMP_MS,
  EXAMPLE_TIMESTAMP_MS_END,
  timestampField,
} from "../../shared/openapi/field-builders";
import { ApiAuditActorSchema } from "../audit/audit.contract";

export const ApiGenerationSchema = z
  .object({
    id: z.string().uuid().openapi({
      description: "기수 UUID",
      example: EXAMPLE_GENERATION_ID,
    }),
    name: z.string().openapi({
      description: "기수 이름",
      example: "10기",
    }),
    sortOrder: z.number().int().openapi({
      description: "기수 정렬 순서(작을수록 먼저 노출)",
      example: 10,
    }),
    startDate: timestampField("기수 시작일시", EXAMPLE_TIMESTAMP_MS),
    endDate: timestampField("기수 종료일시", EXAMPLE_TIMESTAMP_MS_END),
    createdAt: timestampField("생성 시각", EXAMPLE_TIMESTAMP_MS),
    updatedAt: timestampField("수정 시각", EXAMPLE_TIMESTAMP_MS),
    updatedBy: ApiAuditActorSchema.nullable().openapi({
      description: "마지막 수정자 정보 (로그가 없으면 null)",
    }),
  })
  .openapi("ApiGeneration");

export const ApiCreateGenerationSchema = z
  .object({
    name: z.string().trim().min(1, "name은 필수입니다.").openapi({
      description: "생성할 기수 이름",
      example: "12기",
    }),
    sortOrder: z.number().int().nonnegative().openapi({
      description: "기수 정렬 순서(0 이상, UNIQUE)",
      example: 12,
    }),
    startDate: z.number().int().positive().openapi({
      description:
        "기수 시작일시 (Unix timestamp(ms), 클라이언트에서 연-월-일 포맷으로 변환)",
      example: EXAMPLE_TIMESTAMP_MS,
    }),
    endDate: z.number().int().positive().openapi({
      description:
        "기수 종료일시 (Unix timestamp(ms), 클라이언트에서 연-월-일 포맷으로 변환)",
      example: EXAMPLE_TIMESTAMP_MS_END,
    }),
  })
  .openapi("ApiCreateGenerationInput");

export const ApiUpdateGenerationSchema =
  ApiCreateGenerationSchema.partial().openapi("ApiUpdateGenerationInput");
