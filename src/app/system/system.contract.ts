import { createRoute } from "@hono/zod-openapi";
import { errorResponses } from "../../lib/openapi/responses";
import { z } from "../../shared/openapi/zod";

export const healthCheckSchema = z.object({
  service: z.enum([
    "d1",
    "view_counts",
    "r2",
    "r2_presign",
    "durable_object",
    "assets",
    "service_binding",
  ]),
  binding: z.string(),
  status: z.enum(["healthy", "unhealthy", "skipped"]),
  detail: z.string(),
  latencyMs: z.number().optional(),
  error: z.string().optional(),
});

export const healthSummarySchema = z.object({
  total: z.number(),
  healthy: z.number(),
  unhealthy: z.number(),
  skipped: z.number(),
});

export const healthResponseSchema = z.object({
  status: z.enum(["healthy", "unhealthy"]),
  checkedAt: z.string(),
  durationMs: z.number(),
  summary: healthSummarySchema,
  checks: z.array(healthCheckSchema),
});

// 공개 응답은 binding 이름/점검 상세/에러 문자열을 제외한다.
const publicHealthCheckSchema = healthCheckSchema.pick({
  service: true,
  status: true,
  latencyMs: true,
});

export const publicHealthResponseSchema = z.object({
  status: z.enum(["healthy", "unhealthy"]),
  checkedAt: z.string(),
  durationMs: z.number(),
  summary: healthSummarySchema,
  checks: z.array(publicHealthCheckSchema),
});

export const statusResponseSchema = z.object({
  status: z.literal("ok"),
  api: z.string(),
  version: z.string(),
  serverTime: z.string(),
});

export const healthRoute = createRoute({
  method: "get",
  path: "/health",
  tags: ["System"],
  operationId: "getHealth",
  responses: {
    200: {
      description: "필수 인프라 의존성이 모두 정상인 상태",
      content: {
        "application/json": {
          schema: publicHealthResponseSchema,
        },
      },
    },
    503: {
      description: "하나 이상의 인프라 의존성 점검에 실패한 상태",
      content: {
        "application/json": {
          schema: publicHealthResponseSchema,
        },
      },
    },
  },
});

export const statusRoute = createRoute({
  method: "get",
  path: "/api/status",
  tags: ["System"],
  operationId: "getStatus",
  responses: {
    200: {
      description: "API 이름/버전/서버 시각",
      content: {
        "application/json": {
          schema: statusResponseSchema,
        },
      },
    },
  },
});

export const readinessRoute = createRoute({
  method: "get",
  path: "/api/health/readiness",
  tags: ["System"],
  operationId: "getReadiness",
  security: [{ cookieAuth: [] }],
  responses: {
    200: {
      description: "모든 인프라 의존성이 정상 동작하는 상태",
      content: {
        "application/json": {
          schema: healthResponseSchema,
        },
      },
    },
    401: errorResponses[401],
    403: errorResponses[403],
    503: {
      description: "하나 이상의 인프라 의존성 점검에 실패한 상태",
      content: {
        "application/json": {
          schema: healthResponseSchema,
        },
      },
    },
  },
});
