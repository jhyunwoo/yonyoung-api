import { z } from "../../shared/openapi/zod";
import {
  EXAMPLE_ID,
  EXAMPLE_IMAGE_ID,
  EXAMPLE_ITEM_ID,
  EXAMPLE_PARENT_ID,
  EXAMPLE_USER_ID,
} from "../../shared/openapi/field-builders";
import { API_ERROR_CODES } from "../../shared/api-contracts";

const ApiErrorCodeSchema = z.enum(API_ERROR_CODES).openapi("ApiErrorCode");

const ApiErrorSchema = z
  .object({
    code: ApiErrorCodeSchema.openapi({
      description: "서버가 분류한 에러 코드",
      example: "BAD_REQUEST",
    }),
    message: z.string().openapi({
      description: "클라이언트 디버깅을 위한 에러 메시지",
      example: "요청 본문 또는 파라미터가 올바르지 않습니다.",
    }),
    requestId: z.string().openapi({
      description: "서버 로그 상관관계를 위한 요청 ID",
      example: "8f3aa50e-f842-4ff4-9f02-08d0823d7cb1",
    }),
  })
  .openapi("ApiError");

export const ApiErrorResponseSchema = z
  .object({
    error: ApiErrorSchema.openapi({
      description: "표준 에러 envelope",
    }),
  })
  .openapi("ApiErrorResponse");

export const ApiIdParamSchema = z
  .object({
    id: z.string().uuid().openapi({
      description: "조회/수정/삭제 대상 리소스 UUID",
      example: EXAMPLE_ID,
    }),
  })
  .openapi("ApiIdParam");

export const ApiUserIdParamSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .regex(
        /^[A-Za-z0-9_-]+$/,
        "사용자 식별자는 영문/숫자/하이픈/언더스코어만 사용할 수 있습니다.",
      )
      .openapi({
        description: "사용자 식별자 (better-auth user.id)",
        example: EXAMPLE_USER_ID,
      }),
  })
  .openapi("ApiUserIdParam");

export const ApiImageIdParamSchema = z
  .object({
    id: z.string().uuid().openapi({
      description: "상위 리소스 UUID (활동/전시)",
      example: EXAMPLE_PARENT_ID,
    }),
    imageId: z.string().uuid().openapi({
      description: "세부 이미지 리소스 UUID",
      example: EXAMPLE_IMAGE_ID,
    }),
  })
  .openapi("ApiImageIdParam");

export const ApiItemIdParamSchema = z
  .object({
    id: z.string().uuid().openapi({
      description: "상위 링크트리 UUID",
      example: EXAMPLE_PARENT_ID,
    }),
    itemId: z.string().uuid().openapi({
      description: "하위 링크 아이템 UUID",
      example: EXAMPLE_ITEM_ID,
    }),
  })
  .openapi("ApiItemIdParam");
