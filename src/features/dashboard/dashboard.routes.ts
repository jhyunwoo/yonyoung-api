import { type OpenAPIHono, createRoute } from "@hono/zod-openapi";
import type { Context } from "hono";
import type HonoAppType from "../../types/honoAppType";
import { ok } from "../../lib/http/response";
import { type AppDependencies } from "../../lib/services/dependencies";
import { requireAuthenticatedActor } from "../../shared/http/route-guards";
import { readValidated } from "../../shared/http/validated-input";
import { isManagerLikeRole } from "../../lib/authorization/policy";
import { dataResponse, errorResponses } from "../../lib/openapi/responses";
import {
  ApiAdminDashboardStatsQuerySchema,
  ApiAdminDashboardStatsSchema,
} from "./dashboard.contract";
import {
  readR2TotalUsageBytesCached,
  R2_STORAGE_LIMIT_BYTES,
} from "../../lib/storage/usage";
import { resolveR2Bucket } from "../../infra/r2/client";
import { logError } from "../../app/middleware/logger";
import { AppError } from "../../shared/errors/AppError";

type App = OpenAPIHono<HonoAppType>;

/**
 * 이 feature 가 실제로 쓰는 것만 선언한다.
 * 애플리케이션 전체 dependency bag 을 받으면 무엇에 의존하는지 파일을 다 읽어야 알 수 있다.
 */
export type DashboardRouteDependencies = Pick<
  AppDependencies,
  "resolveActor" | "getDataService" | "readR2TotalUsageBytes"
>;

const getAdminDashboardStatsRoute = createRoute({
  method: "get",
  path: "/api/admin/dashboard",
  tags: ["Dashboard"],
  operationId: "getAdminDashboardStats",
  security: [{ cookieAuth: [] }],
  request: {
    query: ApiAdminDashboardStatsQuerySchema,
  },
  responses: {
    200: dataResponse(
      ApiAdminDashboardStatsSchema,
      "관리자 대시보드 집계 조회 성공",
    ),
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
  },
});

type R2StorageUsageReason =
  "ok" | "partial" | "binding_missing" | "scan_failed";

type R2StorageUsageSnapshot = {
  usedBytes: number;
  reason: R2StorageUsageReason;
  observedAt: string;
};

/**
 * R2 사용량을 조회하고, 실패해도 200을 유지하도록 사유와 함께 강등한다.
 * 바인딩 부재는 `resolveR2Bucket`이 동기 throw를 하므로 반드시 try 안에서 호출한다.
 */
const readR2StorageUsage = async (
  c: Context<HonoAppType>,
  waitUntil: ((promise: Promise<unknown>) => void) | undefined,
): Promise<R2StorageUsageSnapshot> => {
  let bucket: R2Bucket;
  try {
    bucket = resolveR2Bucket(c.env);
  } catch (error) {
    logError(c, error, { event: "dashboard.r2_usage.binding_missing" });
    return {
      usedBytes: 0,
      reason: "binding_missing",
      observedAt: new Date().toISOString(),
    };
  }

  try {
    const scan = await readR2TotalUsageBytesCached(bucket, {
      waitUntil,
      bucketName: c.env.R2_BUCKET,
    });

    if (!scan.complete) {
      // 부분 스캔 합계는 하한값이므로 정확한 수치로 표시하지 않는다.
      logError(
        c,
        new Error(
          `R2 usage scan incomplete after ${scan.pages} pages in ${scan.elapsedMs}ms`,
        ),
        { event: "dashboard.r2_usage.partial" },
      );
      return {
        usedBytes: scan.totalUsageBytes,
        reason: "partial",
        observedAt: new Date(scan.observedAt).toISOString(),
      };
    }

    return {
      usedBytes: scan.totalUsageBytes,
      reason: "ok",
      observedAt: new Date(scan.observedAt).toISOString(),
    };
  } catch (error) {
    logError(c, error, { event: "dashboard.r2_usage.scan_failed" });
    return {
      usedBytes: 0,
      reason: "scan_failed",
      observedAt: new Date().toISOString(),
    };
  }
};

export const registerDashboardRoutes = (
  app: App,
  dependencies: DashboardRouteDependencies,
) => {
  app.openapi(getAdminDashboardStatsRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);

    if (!isManagerLikeRole(actor.role)) {
      throw AppError.forbidden();
    }

    const query = readValidated(c, "query", ApiAdminDashboardStatsQuerySchema);

    // 캐시 저장은 응답 이후 백그라운드로 수행한다(가능한 경우).
    let waitUntil: ((promise: Promise<unknown>) => void) | undefined;
    try {
      const executionCtx = c.executionCtx;
      waitUntil = executionCtx?.waitUntil?.bind(executionCtx);
    } catch {
      waitUntil = undefined;
    }

    // DB 집계와 R2 사용량 조회는 독립이므로 병렬 실행한다.
    // R2 조회 실패는 기존과 동일하게 조회불가 상태로 강등하되, 원인은 로그와
    // 응답 필드로 남긴다(과거에는 통째로 삼켜서 진단이 불가능했다).
    const [stats, r2Usage] = await Promise.all([
      dependencies
        .getDataService(c)
        .getAdminDashboardStats(query.generationSortOrder ?? null),
      readR2StorageUsage(c, waitUntil),
    ]);

    return ok(c, {
      ...stats,
      r2StorageUsedBytes: r2Usage.usedBytes,
      r2StorageLimitBytes: R2_STORAGE_LIMIT_BYTES,
      r2StorageUsageAvailable: r2Usage.reason === "ok",
      r2StorageUsageReason: r2Usage.reason,
      r2StorageObservedAt: r2Usage.observedAt,
    });
  });
};
