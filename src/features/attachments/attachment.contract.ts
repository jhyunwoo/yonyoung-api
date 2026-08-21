import { z } from "../../shared/openapi/zod";
import {
  httpUrlInputField,
  timestampField,
} from "../../shared/openapi/field-builders";
import { ALLOWED_ATTACHMENT_CONTENT_TYPES } from "../../lib/storage/presign";

const EXAMPLE_ATTACHMENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EXAMPLE_ATTACHMENT_RESOURCE_ID = "20000000-0000-4000-8000-000000000001";
const EXAMPLE_ATTACHMENT_FILE_URL =
  "https://api.yonyoung.example/api/public/media/site/actor/file/uuid-report.pdf?sig=abc";

export const ApiAttachmentScopeSchema = z
  .enum(["activity", "site_donate"])
  .openapi({
    description:
      '첨부파일 소속 구분 ("activity": 활동 페이지 자료, "site_donate": 후원 페이지 자료)',
    example: "site_donate",
  });

export const ApiAttachmentSchema = z
  .object({
    id: z.string().uuid().openapi({
      description: "첨부파일 UUID",
      example: EXAMPLE_ATTACHMENT_ID,
    }),
    scope: ApiAttachmentScopeSchema,
    resourceId: z.string().uuid().nullable().openapi({
      description: "소속 리소스 UUID (site_donate 범위는 null)",
      example: EXAMPLE_ATTACHMENT_RESOURCE_ID,
    }),
    title: z.string().openapi({
      description: "표시용 제목",
      example: "2026년 6월 회계 내역",
    }),
    fileUrl: z.string().url().nullable().openapi({
      description:
        "다운로드 URL (HMAC 서명된 공개 미디어 URL, 링크 항목은 null)",
      example: EXAMPLE_ATTACHMENT_FILE_URL,
    }),
    fileName: z.string().nullable().openapi({
      description: "다운로드 시 보여줄 원본 파일명 (링크 항목은 null)",
      example: "2026-06-회계내역.pdf",
    }),
    fileSize: z.number().int().nonnegative().nullable().openapi({
      description: "파일 크기 (bytes, 링크 항목은 null)",
      example: 1048576,
    }),
    mimeType: z.string().nullable().openapi({
      description: "파일 MIME 타입 (링크 항목은 null)",
      example: "application/pdf",
    }),
    linkUrl: z.string().url().nullable().openapi({
      description: "외부 링크 URL (예: 구글 독스, 파일 항목은 null)",
      example: "https://docs.google.com/spreadsheets/d/abc",
    }),
    sortOrder: z.number().int().openapi({
      description: "노출 순서",
      example: 0,
    }),
    createdAt: timestampField("첨부파일 생성 시각"),
    updatedAt: timestampField("첨부파일 수정 시각"),
  })
  .openapi("ApiAttachment");

export const ApiCreateAttachmentSchema = z
  .object({
    scope: ApiAttachmentScopeSchema,
    resourceId: z
      .string()
      .uuid("resourceId 형식이 올바르지 않습니다.")
      .nullable()
      .optional()
      .openapi({
        description:
          "소속 리소스 UUID (scope=activity면 필수, site_donate면 생략/null)",
        example: EXAMPLE_ATTACHMENT_RESOURCE_ID,
      }),
    title: z.string().trim().min(1, "제목을 입력해 주세요.").max(200).openapi({
      description: "표시용 제목 (1~200자)",
      example: "월간연영회 2026년 6월호",
    }),
    fileUrl: httpUrlInputField(
      "업로드 완료 후 발급받은 공개 미디어 URL (링크 항목이면 생략)",
      EXAMPLE_ATTACHMENT_FILE_URL,
    ).optional(),
    fileName: z.string().trim().min(1).max(255).optional().openapi({
      description: "원본 파일명 (링크 항목이면 생략)",
      example: "2026-06-회계내역.pdf",
    }),
    fileSize: z.number().int().positive().optional().openapi({
      description: "파일 크기 (bytes, 링크 항목이면 생략)",
      example: 1048576,
    }),
    mimeType: z.enum(ALLOWED_ATTACHMENT_CONTENT_TYPES).optional().openapi({
      description: "파일 MIME 타입 (허용 목록 내, 링크 항목이면 생략)",
      example: "application/pdf",
    }),
    linkUrl: httpUrlInputField(
      "외부 링크 URL (예: 구글 독스 공유 링크, 파일 항목이면 생략)",
      "https://docs.google.com/spreadsheets/d/abc",
    ).optional(),
    sortOrder: z.number().int().nonnegative().default(0).openapi({
      description: "노출 순서 (기본값 0)",
      example: 0,
    }),
  })
  .refine(
    (input) => {
      const fileFields = [
        input.fileUrl,
        input.fileName,
        input.fileSize,
        input.mimeType,
      ];
      const hasFile = fileFields.every((field) => field !== undefined);
      const hasAnyFileField = fileFields.some((field) => field !== undefined);
      const hasLink = input.linkUrl !== undefined;
      if (hasLink) {
        return !hasAnyFileField;
      }
      return hasFile;
    },
    {
      message:
        "파일 필드 세트(fileUrl, fileName, fileSize, mimeType)와 linkUrl 중 정확히 하나만 전달해야 합니다.",
    },
  )
  .openapi("ApiCreateAttachmentInput");

export const ApiUpdateAttachmentSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "제목을 입력해 주세요.")
      .max(200)
      .optional()
      .openapi({
        description: "수정할 표시용 제목",
        example: "2026년 상반기 회계 내역",
      }),
    sortOrder: z.number().int().nonnegative().optional().openapi({
      description: "수정할 노출 순서",
      example: 1,
    }),
  })
  .strict()
  .refine(
    (input) => input.title !== undefined || input.sortOrder !== undefined,
    {
      message: "수정할 필드를 하나 이상 전달해야 합니다.",
    },
  )
  .openapi("ApiUpdateAttachmentInput");

export const ApiAttachmentListQuerySchema = z
  .object({
    scope: ApiAttachmentScopeSchema,
    resourceId: z
      .string()
      .uuid("resourceId 형식이 올바르지 않습니다.")
      .optional()
      .openapi({
        description: "소속 리소스 UUID 필터 (scope=activity일 때 사용)",
        example: EXAMPLE_ATTACHMENT_RESOURCE_ID,
      }),
  })
  .openapi("ApiAttachmentListQuery");
