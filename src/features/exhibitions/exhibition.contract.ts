import { z } from "../../shared/openapi/zod";
import {
  EXAMPLE_GENERATION_ID,
  EXAMPLE_IMAGE_ID,
  EXAMPLE_PARENT_ID,
  EXAMPLE_TIMESTAMP_MS,
  EXAMPLE_TIMESTAMP_MS_END,
  httpUrlInputField,
  imageDimensionField,
  imageDimensionInputField,
  timestampField,
  urlField,
} from "../../shared/openapi/field-builders";
import { ApiAuditActorSchema } from "../audit/audit.contract";

export const ApiExhibitionImageSchema = z
  .object({
    id: z.string().uuid().openapi({
      description: "전시 세부 이미지 UUID",
      example: EXAMPLE_IMAGE_ID,
    }),
    exhibitionId: z.string().uuid().openapi({
      description: "상위 전시 UUID",
      example: EXAMPLE_PARENT_ID,
    }),
    imageUrl: urlField(
      "전시 세부 이미지 공개 URL",
      "https://cdn.yonyoung.example/exhibitions/detail/detail-1.jpg",
    ),
    sortOrder: z.number().int().openapi({
      description: "전시 세부 이미지 노출 순서",
      example: 0,
    }),
    width: imageDimensionField(
      "원본 이미지 가로 픽셀 (레거시 데이터는 null)",
      3000,
    ),
    height: imageDimensionField(
      "원본 이미지 세로 픽셀 (레거시 데이터는 null)",
      2000,
    ),
    createdAt: timestampField("세부 이미지 생성 시각", EXAMPLE_TIMESTAMP_MS),
    updatedAt: timestampField("세부 이미지 수정 시각", EXAMPLE_TIMESTAMP_MS),
  })
  .openapi("ApiExhibitionImage");

export const ApiExhibitionSchema = z
  .object({
    id: z.string().uuid().openapi({
      description: "전시 UUID",
      example: EXAMPLE_PARENT_ID,
    }),
    title: z.string().openapi({
      description: "전시 제목",
      example: "2026 정기 사진전",
    }),
    startDate: timestampField("전시 시작 시각", EXAMPLE_TIMESTAMP_MS),
    endDate: timestampField("전시 종료 시각", EXAMPLE_TIMESTAMP_MS_END),
    generationId: z.string().uuid().openapi({
      description: "연결된 기수 UUID",
      example: EXAMPLE_GENERATION_ID,
    }),
    place: z.string().openapi({
      description: "전시 장소",
      example: "서울시 성동구 아트홀 2관",
    }),
    coverImageUrl: urlField(
      "전시 대표 이미지 공개 URL",
      "https://cdn.yonyoung.example/exhibitions/cover/cover-1.jpg",
    ),
    description: z.string().openapi({
      description: "전시 소개 리치텍스트 HTML 본문",
      example: "<p>도시의 밤을 주제로 한 동아리 정기전입니다.</p>",
    }),
    createdAt: timestampField("전시 생성 시각", EXAMPLE_TIMESTAMP_MS),
    updatedAt: timestampField("전시 수정 시각", EXAMPLE_TIMESTAMP_MS),
    updatedBy: ApiAuditActorSchema.nullable().openapi({
      description: "마지막 수정자 정보 (로그가 없으면 null)",
    }),
    detailImages: z.array(ApiExhibitionImageSchema).openapi({
      description: "전시 세부 이미지 목록",
    }),
  })
  .openapi("ApiExhibition");

export const ApiCreateExhibitionSchema = z
  .object({
    title: z.string().min(1).openapi({
      description: "전시 제목",
      example: "2026 정기 사진전",
    }),
    startDate: z.number().int().positive().openapi({
      description: "전시 시작 시각 (Unix timestamp(ms))",
      example: EXAMPLE_TIMESTAMP_MS,
    }),
    endDate: z.number().int().positive().openapi({
      description: "전시 종료 시각 (Unix timestamp(ms))",
      example: EXAMPLE_TIMESTAMP_MS_END,
    }),
    generationId: z
      .string()
      .uuid("generationId 형식이 올바르지 않습니다.")
      .openapi({
        description: "연결할 기수 UUID",
        example: EXAMPLE_GENERATION_ID,
      }),
    place: z.string().min(1).openapi({
      description: "전시 장소",
      example: "서울시 성동구 아트홀 2관",
    }),
    coverImageUrl: httpUrlInputField(
      "전시 대표 이미지 공개 URL",
      "https://cdn.yonyoung.example/exhibitions/cover/new-cover.jpg",
    ),
    description: z.string().min(1).openapi({
      description: "전시 설명 리치텍스트 HTML 본문",
      example: "<p>도시의 밤 풍경을 기록한 작품들을 전시합니다.</p>",
    }),
  })
  .openapi("ApiCreateExhibitionInput");

export const ApiUpdateExhibitionSchema =
  ApiCreateExhibitionSchema.partial().openapi("ApiUpdateExhibitionInput");

export const ApiListExhibitionsQuerySchema = z
  .object({
    generationId: z
      .string()
      .uuid("generationId 형식이 올바르지 않습니다.")
      .optional()
      .openapi({
        description: "특정 기수 전시 목록을 조회할 때 사용하는 기수 UUID 필터",
        example: EXAMPLE_GENERATION_ID,
      }),
  })
  .openapi("ApiListExhibitionsQuery");

export const ApiCreateExhibitionImageSchema = z
  .object({
    imageUrl: httpUrlInputField(
      "추가할 전시 세부 이미지 URL",
      "https://cdn.yonyoung.example/exhibitions/detail/new-detail.jpg",
    ),
    sortOrder: z.number().int().nonnegative().default(0).openapi({
      description: "세부 이미지 노출 순서(기본값 0)",
      example: 0,
    }),
    width: imageDimensionInputField("원본 이미지 가로 픽셀", 3000),
    height: imageDimensionInputField("원본 이미지 세로 픽셀", 2000),
  })
  .openapi("ApiCreateExhibitionImageInput");

export const ApiUpdateExhibitionImageSchema = z
  .object({
    imageUrl: httpUrlInputField(
      "수정할 전시 세부 이미지 URL",
      "https://cdn.yonyoung.example/exhibitions/detail/updated-detail.jpg",
    ).optional(),
    sortOrder: z.number().int().nonnegative().optional().openapi({
      description: "수정할 세부 이미지 노출 순서",
      example: 1,
    }),
    width: imageDimensionInputField("원본 이미지 가로 픽셀", 3000),
    height: imageDimensionInputField("원본 이미지 세로 픽셀", 2000),
  })
  .strict()
  .openapi("ApiUpdateExhibitionImageInput");

export const ApiCreateExhibitionImageBatchSchema = z
  .array(ApiCreateExhibitionImageSchema)
  .min(1, "세부 이미지를 하나 이상 전달해야 합니다.")
  .openapi("ApiCreateExhibitionImageBatchInput");

const ApiUpdateExhibitionImageBatchItemSchema = z
  .object({
    imageId: z.string().uuid().openapi({
      description: "수정할 세부 이미지 UUID",
      example: EXAMPLE_IMAGE_ID,
    }),
    imageUrl: httpUrlInputField(
      "수정할 전시 세부 이미지 URL",
      "https://cdn.yonyoung.example/exhibitions/detail/updated-detail.jpg",
    ).optional(),
    sortOrder: z.number().int().nonnegative().optional().openapi({
      description: "수정할 세부 이미지 노출 순서",
      example: 1,
    }),
    width: imageDimensionInputField("원본 이미지 가로 픽셀", 3000),
    height: imageDimensionInputField("원본 이미지 세로 픽셀", 2000),
  })
  .strict()
  .refine(
    (value) =>
      value.imageUrl !== undefined ||
      value.sortOrder !== undefined ||
      value.width !== undefined ||
      value.height !== undefined,
    {
      message: "수정할 필드를 하나 이상 전달해야 합니다.",
    },
  )
  .openapi("ApiUpdateExhibitionImageBatchItemInput");

export const ApiUpdateExhibitionImageBatchSchema = z
  .array(ApiUpdateExhibitionImageBatchItemSchema)
  .min(1, "세부 이미지를 하나 이상 전달해야 합니다.")
  .refine(
    (items) => new Set(items.map((item) => item.imageId)).size === items.length,
    {
      message: "중복된 imageId를 전달할 수 없습니다.",
    },
  )
  .openapi("ApiUpdateExhibitionImageBatchInput");
