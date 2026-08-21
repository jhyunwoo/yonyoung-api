import { OpenAPIHono, type OpenAPIHonoOptions } from "@hono/zod-openapi";
import type HonoAppType from "../types/honoAppType";
import { AppError } from "../shared/errors/AppError";
import { notFound } from "../lib/http/response";
import {
  type AppDependencies,
  createDefaultDependencies,
} from "../lib/services/dependencies";
import { mountDomainRouters } from "../routes";
import { errorHandler } from "./middleware/errorHandler";
import { loggerMiddleware } from "./middleware/logger";
import { maxBodySizeMiddleware } from "./middleware/body-size";
import { apiCorsMiddleware } from "./middleware/cors";
import { apiCsrfProtectionMiddleware } from "./middleware/csrf";
import { requestIdMiddleware } from "./middleware/requestId";
import { responseTimingMiddleware } from "./middleware/response-timing";
import { apiSecurityHeadersMiddleware } from "./middleware/securityHeaders";
import { legacyApiRedirectMiddleware } from "./middleware/legacyApiRedirect";
import { sessionMiddleware } from "./middleware/session";
import { registerSystemRoutes } from "./system/system.routes";

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

// zod-openapi validation 실패를 애플리케이션 전역의 단일 에러 봉투로 흘려보낸다.
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

const registerSecuritySchemes = (app: OpenAPIHono<HonoAppType>) => {
  app.openAPIRegistry.registerComponent("securitySchemes", "cookieAuth", {
    type: "apiKey",
    in: "cookie",
    name: "better-auth.session_token",
  });
};

// 등록 순서가 곧 실행 순서다. Better Auth는 라우트 등록 전에 CORS가 잡혀 있어야 하고,
// 세션 해석은 body-size/CSRF 검사를 통과한 요청에만 수행한다.
const registerMiddleware = (
  app: OpenAPIHono<HonoAppType>,
  dependencies: AppDependencies,
) => {
  app.use("*", requestIdMiddleware);
  app.use("*", loggerMiddleware);
  app.use("*", responseTimingMiddleware);

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
};

const registerErrorHandling = (app: OpenAPIHono<HonoAppType>) => {
  app.notFound((c) => notFound(c));
  app.onError(errorHandler);
};

export const createApp = (partialDependencies?: Partial<AppDependencies>) => {
  const app = new OpenAPIHono<HonoAppType>({
    defaultHook: defaultValidationHook,
  });

  const dependencies = {
    ...createDefaultDependencies(),
    ...partialDependencies,
  };

  registerSecuritySchemes(app);
  registerMiddleware(app, dependencies);
  mountDomainRouters(app, dependencies, defaultValidationHook);
  registerSystemRoutes(app, dependencies);
  registerErrorHandling(app);

  return app;
};
