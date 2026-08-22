import { z } from "../../shared/openapi/zod";
import {
  ALLOWED_IMAGE_CONTENT_TYPES,
  UPLOAD_LIMITS,
} from "../../lib/storage/presign";

export const ApiPresignRequestSchema = z
  .object({
    fileName: z.string().min(1, "fileName은 필수입니다.").openapi({
      description: "업로드할 파일명",
      example: "cover-image.jpg",
    }),
    contentType: z.string().min(1).openapi({
      description: "파일 MIME 타입",
      example: ALLOWED_IMAGE_CONTENT_TYPES[0],
    }),
    fileSize: z
      .number()
      .int()
      .positive()
      .openapi({
        description: `파일 크기(바이트). 단일 업로드 최대 ${UPLOAD_LIMITS.maxSinglePartBytes} bytes`,
        example: 1024 * 1024,
      }),
  })
  .strict()
  .openapi("ApiPresignRequest");

export const ApiPresignResponseSchema = z
  .object({
    uploadUrl: z.string().url().openapi({
      description: "클라이언트가 직접 PUT 업로드할 presigned URL",
      example:
        "https://<account>.r2.cloudflarestorage.com/<bucket>/activities/cover/obj-key",
    }),
    objectKey: z.string().openapi({
      description: "스토리지 객체 키(서버에 저장할 내부 식별 문자열)",
      example:
        "activities/cover/66666666-6666-4666-8666-666666666666/cover-image.jpg",
    }),
    publicUrl: z.string().url().openapi({
      description: "업로드 후 DB에 저장할 공개 접근 URL",
      example: "https://cdn.yonyoung.example/activities/cover/cover-image.jpg",
    }),
    requiredHeaders: z.record(z.string(), z.string()).openapi({
      description:
        "presigned URL 업로드 시 클라이언트가 그대로 전달해야 하는 헤더 목록",
      example: {
        "Content-Type": "image/jpeg",
      },
    }),
  })
  .openapi("ApiPresignResponse");

export const ApiMultipartUploadInitRequestSchema = z
  .object({
    fileName: ApiPresignRequestSchema.shape.fileName,
    contentType: ApiPresignRequestSchema.shape.contentType,
    fileSize: z
      .number()
      .int()
      .positive()
      .openapi({
        description: `멀티파트 업로드 파일 크기(바이트). 최대 ${UPLOAD_LIMITS.maxMultipartBytes} bytes`,
        example: 50 * 1024 * 1024,
      }),
  })
  .strict()
  .openapi("ApiMultipartUploadInitRequest");

export const ApiMultipartUploadInitResponseSchema = z
  .object({
    uploadId: z.string().openapi({
      description: "멀티파트 업로드 세션 ID",
      example: "VXBsb2FkIElE",
    }),
    objectKey: ApiPresignResponseSchema.shape.objectKey,
    publicUrl: ApiPresignResponseSchema.shape.publicUrl,
    partSize: z.number().int().positive().openapi({
      description: "각 파트 최소 권장 크기(바이트)",
      example: UPLOAD_LIMITS.multipartPartSizeBytes,
    }),
    maxPartNumber: z.number().int().positive().openapi({
      description: "이번 업로드에서 허용되는 최대 partNumber",
      example: 10,
    }),
  })
  .openapi("ApiMultipartUploadInitResponse");

export const ApiMultipartUploadPartRequestSchema = z
  .object({
    uploadId: z.string().min(1).openapi({
      description: "멀티파트 업로드 세션 ID",
      example: "VXBsb2FkIElE",
    }),
    objectKey: z.string().min(1).openapi({
      description: "업로드 대상 객체 키",
      example: "activities/user-1/detail/1700000000000-file.jpg",
    }),
    partNumber: z
      .number()
      .int()
      .min(1)
      .max(UPLOAD_LIMITS.multipartMaxParts)
      .openapi({
        description: "업로드할 파트 번호 (1~10000)",
        example: 1,
      }),
  })
  .strict()
  .openapi("ApiMultipartUploadPartRequest");

export const ApiMultipartUploadPartResponseSchema = z
  .object({
    uploadUrl: z.string().url().openapi({
      description: "해당 파트를 업로드할 presigned URL",
      example: "https://example.r2.cloudflarestorage.com/...",
    }),
    requiredHeaders: z.record(z.string(), z.string()).openapi({
      description: "파트 업로드 시 필요한 헤더",
      example: {},
    }),
  })
  .openapi("ApiMultipartUploadPartResponse");

const ApiMultipartUploadedPartSchema = z
  .object({
    partNumber: z
      .number()
      .int()
      .min(1)
      .max(UPLOAD_LIMITS.multipartMaxParts)
      .openapi({
        description: "완료된 파트 번호",
        example: 1,
      }),
    etag: z.string().min(1).openapi({
      description: "각 파트 업로드 결과 ETag",
      example: '"9b2cf535f27731c974343645a3985328"',
    }),
  })
  .openapi("ApiMultipartUploadedPart");

export const ApiMultipartUploadCompleteRequestSchema = z
  .object({
    uploadId: ApiMultipartUploadPartRequestSchema.shape.uploadId,
    objectKey: ApiMultipartUploadPartRequestSchema.shape.objectKey,
    parts: z.array(ApiMultipartUploadedPartSchema).min(1).openapi({
      description: "업로드된 파트 목록",
    }),
  })
  .strict()
  .openapi("ApiMultipartUploadCompleteRequest");

export const ApiMultipartUploadCompleteResponseSchema = z
  .object({
    objectKey: ApiPresignResponseSchema.shape.objectKey,
    publicUrl: ApiPresignResponseSchema.shape.publicUrl,
  })
  .openapi("ApiMultipartUploadCompleteResponse");

export const ApiMultipartUploadAbortRequestSchema = z
  .object({
    uploadId: ApiMultipartUploadPartRequestSchema.shape.uploadId,
    objectKey: ApiMultipartUploadPartRequestSchema.shape.objectKey,
  })
  .strict()
  .openapi("ApiMultipartUploadAbortRequest");
