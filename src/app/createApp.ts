import {
  OpenAPIHono,
  type OpenAPIHonoOptions,
  createRoute,
  z,
} from "@hono/zod-openapi";
import packageJson from "../../package.json";
import type HonoAppType from "../types/honoAppType";
import { AppError } from "../shared/errors/AppError";
import { forbidden, notFound } from "../lib/http/response";
import { requireActor } from "../lib/http/authz";
import { isManagerLikeRole } from "../lib/authorization/policy";
import { errorResponses } from "../lib/openapi/responses";
import {
  AppDependencies,
  createDefaultDependencies,
} from "../lib/services/dependencies";
import {
  runInfrastructureHealthChecks,
  toPublicHealthReport,
  type PublicHealthReport,
} from "../lib/health/check";
import { apiCorsMiddleware } from "../middlewares/cors";
import { sessionMiddleware } from "../middlewares/session";
import { mountDomainRouters } from "../routes";
import { errorHandler } from "./middleware/errorHandler";
import { loggerMiddleware } from "./middleware/logger";
import { maxBodySizeMiddleware } from "./middleware/body-size";
import { apiCsrfProtectionMiddleware } from "./middleware/csrf";
import { requestIdMiddleware } from "./middleware/requestId";
import { apiSecurityHeadersMiddleware } from "./middleware/securityHeaders";
import { legacyApiRedirectMiddleware } from "./middleware/legacyApiRedirect";

const API_NAME = "yonyoung-api" as const;
const PUBLIC_HEALTH_CACHE_MS = 10_000;
const API_VERSION =
  typeof packageJson.version === "string" && packageJson.version.trim().length > 0
    ? packageJson.version
    : "0.0.0";

const healthCheckSchema = z.object({
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

const healthSummarySchema = z.object({
  total: z.number(),
  healthy: z.number(),
  unhealthy: z.number(),
  skipped: z.number(),
});

const healthResponseSchema = z.object({
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

const publicHealthResponseSchema = z.object({
  status: z.enum(["healthy", "unhealthy"]),
  checkedAt: z.string(),
  durationMs: z.number(),
  summary: healthSummarySchema,
  checks: z.array(publicHealthCheckSchema),
});

const healthRoute = createRoute({
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

const statusRoute = createRoute({
  method: "get",
  path: "/api/status",
  tags: ["System"],
  operationId: "getStatus",
  responses: {
    200: {
      description: "API 이름/버전/서버 시각",
      content: {
        "application/json": {
          schema: z.object({
            status: z.literal("ok"),
            api: z.string(),
            version: z.string(),
            serverTime: z.string(),
          }),
        },
      },
    },
  },
});

const readinessRoute = createRoute({
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

const createValidationMessage = (result: {
  error: {
    issues: Array<{ message: string; path: unknown[]; code: string }>;
  };
}) => {
  return (
    result.error.issues
      .map((issue) => issue.message)
      .filter((text) => text.length > 0)
      .join(", ") || "요청 데이터가 올바르지 않습니다."
  );
};

export const createApp = (partialDependencies?: Partial<AppDependencies>) => {
  const defaultValidationHook: OpenAPIHonoOptions<HonoAppType>["defaultHook"] = (
    result,
  ) => {
    if (result.success) {
      return;
    }

    throw AppError.validation(createValidationMessage(result), {
      issues: result.error.issues,
    });
  };

  const app = new OpenAPIHono<HonoAppType>({
    defaultHook: defaultValidationHook,
  });

  const dependencies = {
    ...createDefaultDependencies(),
    ...partialDependencies,
  };

  app.openAPIRegistry.registerComponent("securitySchemes", "cookieAuth", {
    type: "apiKey",
    in: "cookie",
    name: "better-auth.session_token",
  });

  app.use("*", requestIdMiddleware);
  app.use("*", loggerMiddleware);

  app.use("*", async (c, next) => {
    const startedAt = c.get("startedAt") ?? performance.now();

    await next();

    const durationMs = performance.now() - startedAt;
    const timingMetric = `total;dur=${durationMs.toFixed(2)}`;
    const existing = c.res.headers.get("Server-Timing");
    c.res.headers.set(
      "Server-Timing",
      existing ? `${existing}, ${timingMetric}` : timingMetric,
    );
    c.res.headers.set("X-Response-Time", `${durationMs.toFixed(2)}ms`);
  });

  app.use("/users", legacyApiRedirectMiddleware);
  app.use("/users/*", legacyApiRedirectMiddleware);

  app.use("/api/*", maxBodySizeMiddleware);

  // Better Auth requires CORS to be configured before route registration.
  app.use("/api/*", apiCorsMiddleware);
  app.options("/api/*", apiCorsMiddleware);

  app.use("/api/*", apiCsrfProtectionMiddleware);
  app.use("/api/*", apiSecurityHeadersMiddleware);
  app.use("/ui", apiSecurityHeadersMiddleware);

  app.use("/api/*", sessionMiddleware(dependencies));

  mountDomainRouters(app, dependencies, defaultValidationHook);

  app.openapi(statusRoute, async (c) => {
    return c.json({
      status: "ok" as const,
      api: API_NAME,
      version: API_VERSION,
      serverTime: new Date().toISOString(),
    });
  });

  // 공개 엔드포인트라 요청마다 D1/R2를 두드리지 않도록 isolate 단위로 잠깐 재사용한다.
  let publicHealthCache: {
    expiresAt: number;
    report: PublicHealthReport;
  } | null = null;

  app.openapi(healthRoute, async (c): Promise<any> => {
    c.header("Cache-Control", "no-store, no-cache, must-revalidate");

    const now = Date.now();
    if (!publicHealthCache || publicHealthCache.expiresAt <= now) {
      const report = await runInfrastructureHealthChecks(c.env, {
        depth: "shallow",
      });
      publicHealthCache = {
        expiresAt: now + PUBLIC_HEALTH_CACHE_MS,
        report: toPublicHealthReport(report),
      };
    }

    const publicReport = publicHealthCache.report;
    return c.json(publicReport, publicReport.status === "healthy" ? 200 : 503);
  });

  app.openapi(readinessRoute, async (c): Promise<any> => {
    c.header("Cache-Control", "no-store, no-cache, must-revalidate");
    const actorResult = await requireActor(c, dependencies);
    if ("response" in actorResult) {
      return actorResult.response;
    }

    if (!isManagerLikeRole(actorResult.actor.role)) {
      return forbidden(c);
    }

    const healthReport = await runInfrastructureHealthChecks(c.env, {
      depth: "deep",
    });
    return c.json(healthReport, healthReport.status === "healthy" ? 200 : 503);
  });

  app.notFound((c) => notFound(c));
  app.onError(errorHandler);

  return app;
};
