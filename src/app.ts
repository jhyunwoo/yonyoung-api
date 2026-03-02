import {
  OpenAPIHono,
  type OpenAPIHonoOptions,
  createRoute,
  z,
} from "@hono/zod-openapi";
import type HonoAppType from "./types/honoAppType";
import { badRequest, notFound } from "./lib/http/response";
import {
  AppDependencies,
  createDefaultDependencies,
} from "./lib/services/dependencies";
import { runInfrastructureHealthChecks } from "./lib/health/check";
import { apiCorsMiddleware } from "./middlewares/cors";
import { errorHandler } from "./middlewares/error-handler";
import { loggerMiddleware } from "./middlewares/logger";
import { requestIdMiddleware } from "./middlewares/request-id";
import { sessionMiddleware } from "./middlewares/session";
import { apiSecurityHeadersMiddleware } from "./middlewares/security-headers";
import { mountDomainRouters } from "./routes";

const healthCheckSchema = z.object({
  service: z.enum([
    "d1",
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

const healthResponseSchema = z.object({
  status: z.enum(["healthy", "unhealthy"]),
  checkedAt: z.string(),
  durationMs: z.number(),
  summary: z.object({
    total: z.number(),
    healthy: z.number(),
    unhealthy: z.number(),
    skipped: z.number(),
  }),
  checks: z.array(healthCheckSchema),
});

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  tags: ["System"],
  operationId: "getHealth",
  responses: {
    200: {
      description: "모든 인프라 의존성이 정상 동작하는 상태",
      content: {
        "application/json": {
          schema: healthResponseSchema,
        },
      },
    },
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

export const createApp = (partialDependencies?: Partial<AppDependencies>) => {
  const defaultValidationHook: OpenAPIHonoOptions<HonoAppType>["defaultHook"] = (
    result,
    c,
  ) => {
    if (result.success) {
      return;
    }

    const message =
      result.error.issues
        .map((issue) => issue.message)
        .filter((text) => text.length > 0)
        .join(", ") || "요청 데이터가 올바르지 않습니다.";
    return badRequest(c, message);
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

  // Better Auth requires CORS to be configured before route registration.
  app.use("/api/*", apiCorsMiddleware);
  app.options("/api/*", apiCorsMiddleware);

  app.use("/api/*", apiSecurityHeadersMiddleware);
  app.use("/api/*", sessionMiddleware(dependencies));

  mountDomainRouters(app, dependencies, defaultValidationHook);

  app.openapi(healthRoute, async (c) => {
    const healthReport = await runInfrastructureHealthChecks(c.env);
    c.header("Cache-Control", "no-store, no-cache, must-revalidate");
    return c.json(healthReport, healthReport.status === "healthy" ? 200 : 503);
  });

  app.notFound((c) => notFound(c));
  app.onError(errorHandler);

  return app;
};
