import type { OpenAPIHono } from "@hono/zod-openapi";
import packageJson from "../../../package.json";
import {
  runInfrastructureHealthChecks,
  toPublicHealthReport,
  type PublicHealthReport,
} from "../../lib/health/check";
import { isManagerLikeRole } from "../../lib/authorization/policy";
import type { AppDependencies } from "../../lib/services/dependencies";
import { AppError } from "../../shared/errors/AppError";
import { requireAuthenticatedActor } from "../../shared/http/route-guards";
import type HonoAppType from "../../types/honoAppType";
import { healthRoute, readinessRoute, statusRoute } from "./system.contract";

/**
 * 이 feature 가 실제로 쓰는 것만 선언한다.
 * 애플리케이션 전체 dependency bag 을 받으면 무엇에 의존하는지 파일을 다 읽어야 알 수 있다.
 */
export type SystemRouteDependencies = Pick<AppDependencies, "resolveActor">;

const API_NAME = "yonyoung-api" as const;
const PUBLIC_HEALTH_CACHE_MS = 10_000;
const API_VERSION =
  typeof packageJson.version === "string" &&
  packageJson.version.trim().length > 0
    ? packageJson.version
    : "0.0.0";

export const registerSystemRoutes = (
  app: OpenAPIHono<HonoAppType>,
  dependencies: SystemRouteDependencies,
) => {
  app.openapi(statusRoute, (c) =>
    c.json({
      status: "ok" as const,
      api: API_NAME,
      version: API_VERSION,
      serverTime: new Date().toISOString(),
    }),
  );

  // 공개 엔드포인트라 요청마다 D1/R2를 두드리지 않도록 isolate 단위로 잠깐 재사용한다.
  let publicHealthCache: {
    expiresAt: number;
    report: PublicHealthReport;
  } | null = null;

  app.openapi(healthRoute, async (c) => {
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
    return publicReport.status === "healthy"
      ? c.json(publicReport, 200)
      : c.json(publicReport, 503);
  });

  app.openapi(readinessRoute, async (c) => {
    c.header("Cache-Control", "no-store, no-cache, must-revalidate");
    const actor = await requireAuthenticatedActor(c, dependencies);

    if (!isManagerLikeRole(actor.role)) {
      throw AppError.forbidden();
    }

    const healthReport = await runInfrastructureHealthChecks(c.env, {
      depth: "deep",
    });
    return healthReport.status === "healthy"
      ? c.json(healthReport, 200)
      : c.json(healthReport, 503);
  });
};
