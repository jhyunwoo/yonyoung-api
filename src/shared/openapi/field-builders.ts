import { z } from "../../shared/openapi/zod";
import { isHttpUrl } from "../../lib/validation/url";
import { STUDENT_NUMBER_REGEX } from "../../shared/auth/profile";

export const EXAMPLE_ID = "11111111-1111-4111-8111-111111111111";
export const EXAMPLE_PARENT_ID = "22222222-2222-4222-8222-222222222222";
export const EXAMPLE_IMAGE_ID = "33333333-3333-4333-8333-333333333333";
export const EXAMPLE_ITEM_ID = "44444444-4444-4444-8444-444444444444";
export const EXAMPLE_GENERATION_ID = "55555555-5555-4555-8555-555555555555";
export const EXAMPLE_USER_ID = "OrYuGkpIFldOIkcrxLrwgzEegsLSJbrh";
export const EXAMPLE_AUDIT_ID = "77777777-7777-4777-8777-777777777777";
export const EXAMPLE_TIMESTAMP_MS = 1735689600000;
export const EXAMPLE_TIMESTAMP_MS_END = 1738368000000;

export const timestampField = (
  description: string,
  example = EXAMPLE_TIMESTAMP_MS,
) =>
  z
    .number()
    .int()
    .openapi({
      description: `${description} (Unix timestamp(ms), 클라이언트에서 연-월-일로 포맷 변환 권장)`,
      example,
    });

export const urlField = (description: string, example: string) =>
  z.string().url().openapi({
    description,
    example,
  });

/** 공개 응답에 노출될 URL을 받는 쓰기 입력은 실행 가능한 비-HTTP 스킴을 허용하지 않는다. */
export const httpUrlInputField = (description: string, example: string) =>
  z
    .string()
    .url()
    .refine(isHttpUrl, "URL은 http(s) 스킴만 사용할 수 있습니다.")
    .openapi({
      description,
      example,
    });

/**
 * 이미지 응답의 원본 픽셀 크기 필드입니다.
 * 업로드 시 브라우저에서 측정해 저장하며, 측정 기능 도입 전 레거시 행은 null입니다.
 * 공개 갤러리는 이 값이 있으면 CLS 없이 원본 비율로 렌더링합니다.
 */
export const imageDimensionField = (description: string, example: number) =>
  z.number().int().positive().nullable().openapi({
    description,
    example,
  });

/** 이미지 생성/수정 입력의 원본 픽셀 크기 (HEIC 등 측정 실패 시 생략 가능) */
export const imageDimensionInputField = (
  description: string,
  example: number,
) =>
  z.number().int().positive().optional().openapi({
    description,
    example,
  });

export const studentNumberField = (description: string, example: string) =>
  z
    .string()
    .regex(STUDENT_NUMBER_REGEX, "학번은 숫자 10자리여야 합니다.")
    .openapi({
      description,
      example,
    });

export const phoneNumberField = (description: string, example: string) =>
  z.string().trim().min(1, "전화번호는 비워둘 수 없습니다.").openapi({
    description,
    example,
  });
