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

export const ApiActivityImageSchema = z
  .object({
    id: z.string().uuid().openapi({
      description: "활동 세부 이미지 UUID",
      example: EXAMPLE_IMAGE_ID,
    }),
    activityId: z.string().uuid().openapi({
      description: "상위 활동 UUID",
      example: EXAMPLE_PARENT_ID,
    }),
    imageUrl: urlField(
      "활동 세부 이미지 공개 URL (presigned 업로드 완료 후 저장되는 URL)",
      "https://cdn.yonyoung.example/activities/detail/detail-1.jpg",
    ),
    sortOrder: z.number().int().openapi({
      description: "세부 이미지 노출 순서",
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
  .openapi("ApiActivityImage");

export const ApiActivitySchema = z
  .object({
    id: z.string().uuid().openapi({
      description: "활동 UUID",
      example: EXAMPLE_PARENT_ID,
    }),
    title: z.string().openapi({
      description: "활동 제목",
      example: "겨울 정기 워크숍",
    }),
    description: z.string().openapi({
      description: "활동 상세 설명 리치텍스트 HTML 본문",
      example:
        "<p>동아리 구성원 대상 <strong>촬영/편집</strong> 워크숍을 진행했습니다.</p>",
    }),
    startDate: timestampField("활동 시작 시각", EXAMPLE_TIMESTAMP_MS),
    endDate: timestampField("활동 종료 시각", EXAMPLE_TIMESTAMP_MS_END),
    coverImageUrl: urlField(
      "활동 대표 이미지 공개 URL (presigned 업로드 완료 후 저장)",
      "https://cdn.yonyoung.example/activities/cover/cover-1.jpg",
    ),
    generationId: z.string().uuid().openapi({
      description: "연결된 기수 UUID",
      example: EXAMPLE_GENERATION_ID,
    }),
    createdAt: timestampField("활동 생성 시각", EXAMPLE_TIMESTAMP_MS),
    updatedAt: timestampField("활동 수정 시각", EXAMPLE_TIMESTAMP_MS),
    updatedBy: ApiAuditActorSchema.nullable().openapi({
      description: "마지막 수정자 정보 (로그가 없으면 null)",
    }),
    detailImages: z.array(ApiActivityImageSchema).openapi({
      description: "활동 세부 이미지 목록",
    }),
  })
  .openapi("ApiActivity");

export const ApiCreateActivitySchema = z
  .object({
    title: z.string().min(1).openapi({
      description: "활동 제목",
      example: "봄 정기전 준비 모임",
    }),
    description: z.string().min(1).openapi({
      description: "활동 설명 리치텍스트 HTML 본문",
      example: "<p>정기전 작품 선정 및 역할 분담을 진행했습니다.</p>",
    }),
    startDate: z.number().int().positive().openapi({
      description: "활동 시작 시각 (Unix timestamp(ms))",
      example: EXAMPLE_TIMESTAMP_MS,
    }),
    endDate: z.number().int().positive().openapi({
      description: "활동 종료 시각 (Unix timestamp(ms))",
      example: EXAMPLE_TIMESTAMP_MS_END,
    }),
    coverImageUrl: httpUrlInputField(
      "활동 대표 이미지 공개 URL",
      "https://cdn.yonyoung.example/activities/cover/new-cover.jpg",
    ),
    generationId: z
      .string()
      .uuid("generationId 형식이 올바르지 않습니다.")
      .openapi({
        description: "연결할 기수 UUID",
        example: EXAMPLE_GENERATION_ID,
      }),
  })
  .refine((value) => value.startDate <= value.endDate, {
    message: "활동 종료 시각은 시작 시각보다 빠를 수 없습니다.",
    path: ["endDate"],
  })
  .openapi("ApiCreateActivityInput");

export const ApiUpdateActivitySchema = z
  .object({
    title: z.string().min(1).optional().openapi({
      description: "활동 제목",
      example: "봄 정기전 준비 모임",
    }),
    description: z.string().min(1).optional().openapi({
      description: "활동 설명 리치텍스트 HTML 본문",
      example: "<p>정기전 작품 선정 및 역할 분담을 진행했습니다.</p>",
    }),
    startDate: z.number().int().positive().optional().openapi({
      description: "활동 시작 시각 (Unix timestamp(ms))",
      example: EXAMPLE_TIMESTAMP_MS,
    }),
    endDate: z.number().int().positive().optional().openapi({
      description: "활동 종료 시각 (Unix timestamp(ms))",
      example: EXAMPLE_TIMESTAMP_MS_END,
    }),
    coverImageUrl: httpUrlInputField(
      "활동 대표 이미지 공개 URL",
      "https://cdn.yonyoung.example/activities/cover/new-cover.jpg",
    ).optional(),
    generationId: z
      .string()
      .uuid("generationId 형식이 올바르지 않습니다.")
      .optional()
      .openapi({
        description: "연결할 기수 UUID",
        example: EXAMPLE_GENERATION_ID,
      }),
  })
  .strict()
  .refine(
    (value) =>
      value.startDate === undefined ||
      value.endDate === undefined ||
      value.startDate <= value.endDate,
    {
      message: "활동 종료 시각은 시작 시각보다 빠를 수 없습니다.",
      path: ["endDate"],
    },
  )
  .openapi("ApiUpdateActivityInput");

export const ApiListActivitiesQuerySchema = z
  .object({
    generationId: z
      .string()
      .uuid("generationId 형식이 올바르지 않습니다.")
      .optional()
      .openapi({
        description: "특정 기수 활동 목록을 조회할 때 사용하는 기수 UUID 필터",
        example: EXAMPLE_GENERATION_ID,
      }),
  })
  .openapi("ApiListActivitiesQuery");

export const ApiCreateActivityImageSchema = z
  .object({
    imageUrl: httpUrlInputField(
      "추가할 활동 세부 이미지 URL",
      "https://cdn.yonyoung.example/activities/detail/new-detail.jpg",
    ),
    sortOrder: z.number().int().nonnegative().default(0).openapi({
      description: "세부 이미지 표시 순서(기본값 0)",
      example: 0,
    }),
    width: imageDimensionInputField("원본 이미지 가로 픽셀", 3000),
    height: imageDimensionInputField("원본 이미지 세로 픽셀", 2000),
  })
  .openapi("ApiCreateActivityImageInput");

export const ApiUpdateActivityImageSchema = z
  .object({
    imageUrl: httpUrlInputField(
      "수정할 활동 세부 이미지 URL",
      "https://cdn.yonyoung.example/activities/detail/updated-detail.jpg",
    ).optional(),
    sortOrder: z.number().int().nonnegative().optional().openapi({
      description: "수정할 세부 이미지 표시 순서",
      example: 1,
    }),
    width: imageDimensionInputField("원본 이미지 가로 픽셀", 3000),
    height: imageDimensionInputField("원본 이미지 세로 픽셀", 2000),
  })
  .strict()
  .openapi("ApiUpdateActivityImageInput");

export const ApiCreateActivityImageBatchSchema = z
  .array(ApiCreateActivityImageSchema)
  .min(1, "세부 이미지를 하나 이상 전달해야 합니다.")
  .openapi("ApiCreateActivityImageBatchInput");

const ApiUpdateActivityImageBatchItemSchema = z
  .object({
    imageId: z.string().uuid().openapi({
      description: "수정할 세부 이미지 UUID",
      example: EXAMPLE_IMAGE_ID,
    }),
    imageUrl: httpUrlInputField(
      "수정할 활동 세부 이미지 URL",
      "https://cdn.yonyoung.example/activities/detail/updated-detail.jpg",
    ).optional(),
    sortOrder: z.number().int().nonnegative().optional().openapi({
      description: "수정할 세부 이미지 표시 순서",
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
  .openapi("ApiUpdateActivityImageBatchItemInput");

export const ApiUpdateActivityImageBatchSchema = z
  .array(ApiUpdateActivityImageBatchItemSchema)
  .min(1, "세부 이미지를 하나 이상 전달해야 합니다.")
  .refine(
    (items) => new Set(items.map((item) => item.imageId)).size === items.length,
    {
      message: "중복된 imageId를 전달할 수 없습니다.",
    },
  )
  .openapi("ApiUpdateActivityImageBatchInput");
