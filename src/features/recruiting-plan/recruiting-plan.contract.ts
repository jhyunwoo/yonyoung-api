import { z } from "../../shared/openapi/zod";
import {
  EXAMPLE_TIMESTAMP_MS,
  EXAMPLE_TIMESTAMP_MS_END,
  httpUrlInputField,
  timestampField,
  urlField,
} from "../../shared/openapi/field-builders";

const ApiRecruitingPromotionImageUrlsSchema = z
  .array(
    urlField(
      "모집 계획 홍보 이미지 URL",
      "https://cdn.yonyoung.example/recruiting/image/recruiting-1.jpg",
    ),
  )
  .max(10, "홍보 이미지는 최대 10장까지 등록할 수 있습니다.")
  .refine((items) => new Set(items).size === items.length, {
    message: "중복된 promotionImageUrls를 전달할 수 없습니다.",
  });

const ApiRecruitingPromotionImageUrlsInputSchema = z
  .array(
    httpUrlInputField(
      "모집 계획 홍보 이미지 URL",
      "https://cdn.yonyoung.example/recruiting/image/recruiting-1.jpg",
    ),
  )
  .max(10, "홍보 이미지는 최대 10장까지 등록할 수 있습니다.")
  .refine((items) => new Set(items).size === items.length, {
    message: "중복된 promotionImageUrls를 전달할 수 없습니다.",
  });

export const ApiRecruitingPlanSchema = z
  .object({
    year: z.number().int().min(1970).openapi({
      description: "모집 계획 기준 연도 (KST 기준)",
      example: 2030,
    }),
    title: z.string().trim().min(1, "제목은 비워둘 수 없습니다.").openapi({
      description: "해당 연도 모집 계획 제목",
      example: "2030 연영회 신입 부원 모집",
    }),
    content: z
      .string()
      .trim()
      .min(1, "세부 내용은 비워둘 수 없습니다.")
      .openapi({
        description: "모집 계획 상세 리치텍스트 HTML 본문",
        example: "<p>사진에 열정이 있는 분들을 모집합니다.</p>",
      }),
    promotionImageUrls: ApiRecruitingPromotionImageUrlsSchema.openapi({
      description: "모집 계획 홍보 이미지 URL 목록 (최대 10장)",
      example: [
        "https://cdn.yonyoung.example/recruiting/image/recruiting-1.jpg",
        "https://cdn.yonyoung.example/recruiting/image/recruiting-2.jpg",
      ],
    }),
    recruitmentStartAt: timestampField("모집 시작 일시", EXAMPLE_TIMESTAMP_MS),
    recruitmentEndAt: timestampField(
      "모집 종료 일시",
      EXAMPLE_TIMESTAMP_MS_END,
    ),
    createdAt: timestampField("생성 시각", EXAMPLE_TIMESTAMP_MS),
    updatedAt: timestampField("수정 시각", EXAMPLE_TIMESTAMP_MS_END),
  })
  .openapi("ApiRecruitingPlan");

export const ApiUpsertCurrentRecruitingPlanSchema = z
  .object({
    title: z.string().trim().min(1, "제목은 비워둘 수 없습니다.").openapi({
      description: "해당 연도 모집 계획 제목",
      example: "2030 연영회 신입 부원 모집",
    }),
    content: z
      .string()
      .trim()
      .min(1, "세부 내용은 비워둘 수 없습니다.")
      .openapi({
        description: "모집 계획 상세 리치텍스트 HTML 본문",
        example: "<p>사진에 열정이 있는 분들을 모집합니다.</p>",
      }),
    promotionImageUrls: ApiRecruitingPromotionImageUrlsInputSchema.openapi({
      description: "모집 계획 홍보 이미지 URL 목록 (최대 10장)",
      example: [
        "https://cdn.yonyoung.example/recruiting/image/recruiting-1.jpg",
        "https://cdn.yonyoung.example/recruiting/image/recruiting-2.jpg",
      ],
    }),
    recruitmentStartAt: timestampField("모집 시작 일시", EXAMPLE_TIMESTAMP_MS),
    recruitmentEndAt: timestampField(
      "모집 종료 일시",
      EXAMPLE_TIMESTAMP_MS_END,
    ),
  })
  .refine((input) => input.recruitmentStartAt <= input.recruitmentEndAt, {
    message: "모집 시작 일시는 모집 종료 일시보다 늦을 수 없습니다.",
    path: ["recruitmentStartAt"],
  })
  .openapi("ApiUpsertCurrentRecruitingPlanInput");
