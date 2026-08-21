import { z } from "../../shared/openapi/zod";
import {
  EXAMPLE_ITEM_ID,
  EXAMPLE_PARENT_ID,
  EXAMPLE_TIMESTAMP_MS,
  httpUrlInputField,
  timestampField,
  urlField,
} from "../../shared/openapi/field-builders";
import { ApiAuditActorSchema } from "../audit/audit.contract";

export const ApiLinktreeItemSchema = z
  .object({
    id: z.string().uuid().openapi({
      description: "링크 아이템 UUID",
      example: EXAMPLE_ITEM_ID,
    }),
    linktreeId: z.string().uuid().openapi({
      description: "상위 링크트리 UUID",
      example: EXAMPLE_PARENT_ID,
    }),
    name: z.string().openapi({
      description: "링크 표시 이름",
      example: "인스타그램",
    }),
    link: urlField("실제 이동 URL", "https://instagram.com/yonyoung"),
    createdAt: timestampField("링크 아이템 생성 시각", EXAMPLE_TIMESTAMP_MS),
    updatedAt: timestampField("링크 아이템 수정 시각", EXAMPLE_TIMESTAMP_MS),
    updatedBy: ApiAuditActorSchema.nullable().openapi({
      description: "마지막 수정자 정보 (로그가 없으면 null)",
    }),
  })
  .openapi("ApiLinktreeItem");

export const ApiLinktreeSchema = z
  .object({
    id: z.string().uuid().openapi({
      description: "링크트리 UUID",
      example: EXAMPLE_PARENT_ID,
    }),
    name: z.string().openapi({
      description: "링크트리 이름",
      example: "공식 채널",
    }),
    createdAt: timestampField("링크트리 생성 시각", EXAMPLE_TIMESTAMP_MS),
    updatedAt: timestampField("링크트리 수정 시각", EXAMPLE_TIMESTAMP_MS),
    updatedBy: ApiAuditActorSchema.nullable().openapi({
      description: "마지막 수정자 정보 (로그가 없으면 null)",
    }),
    items: z.array(ApiLinktreeItemSchema).openapi({
      description: "하위 링크 아이템 목록",
    }),
  })
  .openapi("ApiLinktree");

export const ApiCreateLinktreeSchema = z
  .object({
    name: z.string().min(1).openapi({
      description: "생성할 링크트리 이름",
      example: "공식 채널",
    }),
  })
  .openapi("ApiCreateLinktreeInput");

export const ApiUpdateLinktreeSchema =
  ApiCreateLinktreeSchema.partial().openapi("ApiUpdateLinktreeInput");

export const ApiCreateLinktreeItemSchema = z
  .object({
    name: z.string().min(1).openapi({
      description: "링크 아이템 이름",
      example: "YouTube",
    }),
    link: httpUrlInputField("링크 아이템 URL", "https://youtube.com/@yonyoung"),
  })
  .openapi("ApiCreateLinktreeItemInput");

export const ApiUpdateLinktreeItemSchema =
  ApiCreateLinktreeItemSchema.partial().openapi("ApiUpdateLinktreeItemInput");
