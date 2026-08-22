import { z } from "../../shared/openapi/zod";

export const ApiOpenApiDocumentSchema = z
  .object({
    openapi: z.string().openapi({
      description: "OpenAPI 문서 버전 문자열",
      example: "3.1.1",
    }),
    info: z.record(z.string(), z.any()).openapi({
      description: "문서 메타데이터(info)",
    }),
    paths: z.record(z.string(), z.any()).openapi({
      description: "API 경로/메서드 정의",
    }),
    components: z.record(z.string(), z.any()).optional().openapi({
      description: "스키마/보안/파라미터 컴포넌트",
    }),
    tags: z.array(z.any()).optional().openapi({
      description: "태그 목록",
    }),
    servers: z.array(z.any()).optional().openapi({
      description: "서버 목록",
    }),
  })
  .passthrough()
  .openapi("ApiOpenApiDocument");
