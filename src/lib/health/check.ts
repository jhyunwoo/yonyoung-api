import { createR2PresignService } from "../storage/presign";
import { createD1ViewCountStore } from "../views/view-counts";
import { resolveAuthRuntimeEnv } from "../config/runtime-env";
import type { AppBindings } from "../../types/honoAppType";

const DEFAULT_HEALTH_TIMEOUT_MS = 3_000;

/**
 * D1 마이그레이션이 적용되지 않은 데이터베이스를 탐지하기 위한 핵심 테이블 목록.
 * 전체 테이블을 검사하지 않고 도메인별 대표 테이블만 확인한다.
 */
const CORE_D1_TABLES = [
  "user",
  "session",
  "account",
  "generations",
  "activities",
  "exhibitions",
  "view_counts",
  "attachments",
  "upload_reservations",
] as const;

/**
 * 공개 헬스 체크는 부작용 없는 검사만 수행하고, readiness는 쓰기 왕복까지 검증한다.
 */
export type HealthCheckDepth = "shallow" | "deep";

type HealthCheckService =
  | "d1"
  | "db_schema"
  | "view_counts"
  | "r2"
  | "r2_presign"
  | "auth_config"
  | "rate_limiter"
  | "analytics_engine"
  | "durable_object"
  | "assets"
  | "service_binding";

type HealthCheckStatus = "healthy" | "unhealthy" | "skipped";

export type HealthCheckResult = {
  service: HealthCheckService;
  binding: string;
  status: HealthCheckStatus;
  detail: string;
  latencyMs?: number;
  error?: string;
};

export type HealthReport = {
  status: "healthy" | "unhealthy";
  checkedAt: string;
  durationMs: number;
  summary: {
    total: number;
    healthy: number;
    unhealthy: number;
    skipped: number;
  };
  checks: HealthCheckResult[];
};

type BindingEntry<T> = {
  name: string;
  binding: T;
};

const roundToTwoDecimals = (value: number): number => {
  return Number(value.toFixed(2));
};

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "unknown error";
};

const withTimeout = async <T>(
  task: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`health check timeout: ${label} (${timeoutMs}ms)`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([task, timeoutPromise]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const hasFunction = (value: Record<string, unknown>, key: string): boolean => {
  return typeof value[key] === "function";
};

const isFetcherLike = (value: Record<string, unknown>): boolean => {
  return hasFunction(value, "fetch");
};

const isD1Database = (value: unknown): value is D1Database => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    !isFetcherLike(value) &&
    hasFunction(value, "prepare") &&
    hasFunction(value, "batch")
  );
};

const isR2Bucket = (value: unknown): value is R2Bucket => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    !isFetcherLike(value) &&
    hasFunction(value, "put") &&
    hasFunction(value, "head") &&
    hasFunction(value, "delete")
  );
};

const isDurableObjectNamespace = (
  value: unknown,
): value is DurableObjectNamespace => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    !isFetcherLike(value) &&
    hasFunction(value, "idFromName") &&
    hasFunction(value, "get")
  );
};

const isFetcherBinding = (value: unknown): value is Fetcher => {
  if (!isRecord(value)) {
    return false;
  }

  return isFetcherLike(value);
};

const collectBindings = <T>(
  env: Partial<AppBindings>,
  predicate: (value: unknown) => value is T,
): BindingEntry<T>[] => {
  return Object.entries(env)
    .filter(([, value]) => predicate(value))
    .map(([name, binding]) => ({
      name,
      binding: binding as T,
    }));
};

const runTimedCheck = async (input: {
  service: HealthCheckService;
  binding: string;
  detail: string;
  timeoutMs?: number;
  probe: () => Promise<void | string>;
}): Promise<HealthCheckResult> => {
  const startedAt = performance.now();

  try {
    const probeResult = await withTimeout(
      input.probe(),
      input.timeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS,
      `${input.service}:${input.binding}`,
    );
    return {
      service: input.service,
      binding: input.binding,
      status: "healthy",
      detail: probeResult ?? input.detail,
      latencyMs: roundToTwoDecimals(performance.now() - startedAt),
    };
  } catch (error) {
    return {
      service: input.service,
      binding: input.binding,
      status: "unhealthy",
      detail: input.detail,
      latencyMs: roundToTwoDecimals(performance.now() - startedAt),
      error: toErrorMessage(error),
    };
  }
};

const runD1Checks = async (
  env: Partial<AppBindings>,
): Promise<HealthCheckResult[]> => {
  const d1Bindings = collectBindings(env, isD1Database);

  if (d1Bindings.length === 0) {
    return [
      {
        service: "d1",
        binding: "db",
        status: "unhealthy",
        detail: "D1 binding이 구성되지 않았습니다.",
      },
    ];
  }

  return Promise.all(
    d1Bindings.map((entry) =>
      runTimedCheck({
        service: "d1",
        binding: entry.name,
        detail: "SELECT 1 쿼리로 D1 연결 상태를 확인합니다.",
        probe: async () => {
          const result = await entry.binding
            .prepare("SELECT 1 AS result")
            .first<{ result: number }>();
          if (result?.result !== 1) {
            throw new Error("unexpected D1 result");
          }
        },
      }),
    ),
  );
};

const runViewCountCheck = async (
  env: Partial<AppBindings>,
): Promise<HealthCheckResult> => {
  const database = env.DB ?? env.db;
  const binding = env.DB ? "DB" : "db";

  if (!isD1Database(database)) {
    return {
      service: "view_counts",
      binding,
      status: "unhealthy",
      detail: "조회수 API가 사용할 D1 binding이 구성되지 않았습니다.",
    };
  }

  return runTimedCheck({
    service: "view_counts",
    binding,
    detail: "조회수 기록/조회 D1 round-trip으로 /api/public/views 동작 기반을 확인합니다.",
    probe: async () => {
      const resourceType = "activity";
      const resourceId = crypto.randomUUID();
      const store = createD1ViewCountStore(database);

      try {
        await store.recordView(resourceType, resourceId);
        await store.recordView(resourceType, resourceId);

        const counts = await store.getViewCounts(resourceType, [resourceId]);
        if (counts[resourceId] !== 2) {
          throw new Error(
            `unexpected view count result: ${counts[resourceId] ?? "missing"}`,
          );
        }

        return "조회수 기록/조회 round-trip이 정상입니다.";
      } finally {
        try {
          await database
            .prepare(
              `
                DELETE FROM view_counts
                WHERE resource_type = ?
                  AND resource_id = ?
              `,
            )
            .bind(resourceType, resourceId)
            .run();
        } catch {
          // Cleanup failure must not hide the primary health-check result.
        }
      }
    },
  });
};

const runR2BucketChecks = async (
  env: Partial<AppBindings>,
  depth: HealthCheckDepth,
): Promise<HealthCheckResult[]> => {
  const r2Bindings = collectBindings(env, isR2Bucket);

  if (r2Bindings.length === 0) {
    return [
      {
        service: "r2",
        binding: "r2",
        status: "unhealthy",
        detail: "R2 bucket binding이 구성되지 않았습니다.",
      },
    ];
  }

  // 공개 헬스 체크는 누구나 호출할 수 있으므로 버킷에 쓰기를 남기지 않는다.
  if (depth === "shallow") {
    return Promise.all(
      r2Bindings.map((entry) =>
        runTimedCheck({
          service: "r2",
          binding: entry.name,
          detail: "R2 list 읽기 프로브로 스토리지 연결 상태를 확인합니다.",
          probe: async () => {
            await entry.binding.list({ limit: 1 });
          },
        }),
      ),
    );
  }

  return Promise.all(
    r2Bindings.map((entry) =>
      runTimedCheck({
        service: "r2",
        binding: entry.name,
        detail: "R2 put/head/delete round-trip으로 스토리지 상태를 확인합니다.",
        probe: async () => {
          const key = `__healthchecks__/${entry.name}/${crypto.randomUUID()}`;
          try {
            await entry.binding.put(key, "health-check");
            const object = await entry.binding.head(key);
            if (!object) {
              throw new Error("object was not found after put");
            }
          } finally {
            await entry.binding.delete(key);
          }
        },
      }),
    ),
  );
};

const runDbSchemaCheck = async (
  env: Partial<AppBindings>,
): Promise<HealthCheckResult> => {
  const database = env.DB ?? env.db;
  const binding = env.DB ? "DB" : "db";

  if (!isD1Database(database)) {
    return {
      service: "db_schema",
      binding,
      status: "unhealthy",
      detail: "스키마를 확인할 D1 binding이 구성되지 않았습니다.",
    };
  }

  return runTimedCheck({
    service: "db_schema",
    binding,
    detail: "핵심 테이블 존재 여부로 D1 마이그레이션 적용 상태를 확인합니다.",
    probe: async () => {
      const placeholders = CORE_D1_TABLES.map(() => "?").join(", ");
      const found = await database
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`,
        )
        .bind(...CORE_D1_TABLES)
        .all<{ name: string }>();

      const foundNames = new Set((found.results ?? []).map((row) => row.name));
      const missing = CORE_D1_TABLES.filter((table) => !foundNames.has(table));
      if (missing.length > 0) {
        throw new Error(`missing D1 tables: ${missing.join(", ")}`);
      }

      return `핵심 테이블 ${CORE_D1_TABLES.length}개가 모두 존재합니다.`;
    },
  });
};

const runAuthConfigCheck = async (
  env: Partial<AppBindings>,
): Promise<HealthCheckResult> => {
  return runTimedCheck({
    service: "auth_config",
    binding: "BETTER_AUTH_*",
    detail: "better-auth 필수 환경 변수와 OAuth 설정을 확인합니다.",
    probe: async () => {
      // 개발용 기본값 없이 해석해 프로덕션 시크릿 누락을 실패로 처리한다.
      const authEnv = resolveAuthRuntimeEnv(env, false);
      if (authEnv.trustedOrigins.length === 0) {
        throw new Error("no trusted origins configured");
      }
    },
  });
};

const runRateLimiterCheck = async (
  env: Partial<AppBindings>,
): Promise<HealthCheckResult> => {
  const limiter = env.PAGE_VIEW_RATE_LIMITER;

  // wrangler.jsonc에 선언된 필수 바인딩이므로 부재는 skipped가 아닌 실패다.
  if (!limiter || typeof limiter.limit !== "function") {
    return {
      service: "rate_limiter",
      binding: "PAGE_VIEW_RATE_LIMITER",
      status: "unhealthy",
      detail: "조회수 rate limit binding이 구성되지 않았습니다.",
    };
  }

  return runTimedCheck({
    service: "rate_limiter",
    binding: "PAGE_VIEW_RATE_LIMITER",
    detail: "rate limit binding 호출 가능 여부를 확인합니다.",
    probe: async () => {
      // 허용/차단 결과와 무관하게 호출 자체가 성공하면 정상으로 판단한다.
      await limiter.limit({ key: "__healthcheck__" });
    },
  });
};

const runAnalyticsEngineCheck = async (
  env: Partial<AppBindings>,
): Promise<HealthCheckResult> => {
  const dataset = env.PERF_ANALYTICS;

  if (!dataset || typeof dataset.writeDataPoint !== "function") {
    return {
      service: "analytics_engine",
      binding: "PERF_ANALYTICS",
      status: "unhealthy",
      detail: "성능 분석 dataset binding이 구성되지 않았습니다.",
    };
  }

  return {
    service: "analytics_engine",
    binding: "PERF_ANALYTICS",
    status: "healthy",
    detail: "성능 분석 dataset binding이 구성되어 있습니다.",
  };
};

const runR2PresignCheck = async (
  env: Partial<AppBindings>,
): Promise<HealthCheckResult> => {
  return runTimedCheck({
    service: "r2_presign",
    binding: "R2_*",
    detail: "R2 presign 설정/서명 생성을 확인합니다.",
    probe: async () => {
      const presignService = createR2PresignService(env as AppBindings);
      const result = await presignService.issuePresignedPutUrl({
        actorId: "health-check",
        resource: "activities",
        slot: "cover",
        fileName: "health-check.png",
        contentType: "image/png",
        fileSize: 1,
      });
      if (!result.uploadUrl || !result.publicUrl) {
        throw new Error("presigned URL generation failed");
      }
    },
  });
};

const runDurableObjectChecks = async (
  env: Partial<AppBindings>,
): Promise<HealthCheckResult[]> => {
  const namespaces = collectBindings(env, isDurableObjectNamespace);

  if (namespaces.length === 0) {
    return [
      {
        service: "durable_object",
        binding: "*",
        status: "skipped",
        detail: "Durable Object binding이 구성되지 않았습니다.",
      },
    ];
  }

  return Promise.all(
    namespaces.map((entry) =>
      runTimedCheck({
        service: "durable_object",
        binding: entry.name,
        detail: "Durable Object stub fetch로 런타임 상태를 확인합니다.",
        probe: async () => {
          const id = entry.binding.idFromName("__healthcheck__");
          const stub = entry.binding.get(id);
          const response = await stub.fetch("https://healthcheck.internal/health", {
            method: "HEAD",
          });
          if (response.status >= 500) {
            throw new Error(`unexpected DO response status: ${response.status}`);
          }
          return `Durable Object 응답 상태 코드: ${response.status}`;
        },
      }),
    ),
  );
};

const runFetcherBindingChecks = async (
  env: Partial<AppBindings>,
): Promise<HealthCheckResult[]> => {
  const fetcherBindings = collectBindings(env, isFetcherBinding);
  const assetBinding = fetcherBindings.find((entry) => entry.name === "ASSETS");
  const serviceBindings = fetcherBindings.filter((entry) => entry.name !== "ASSETS");

  const checks: Array<Promise<HealthCheckResult>> = [];

  if (!assetBinding) {
    checks.push(
      Promise.resolve({
        service: "assets",
        binding: "ASSETS",
        status: "skipped",
        detail: "ASSETS binding이 구성되지 않았습니다.",
      }),
    );
  } else {
    checks.push(
      runTimedCheck({
        service: "assets",
        binding: assetBinding.name,
        detail: "ASSETS fetch로 정적 자산 서비스 연결을 확인합니다.",
        probe: async () => {
          const response = await assetBinding.binding.fetch(
            "https://assets-health.internal/health",
            {
              method: "HEAD",
            },
          );
          if (response.status >= 500) {
            throw new Error(`unexpected ASSETS response status: ${response.status}`);
          }
          return `ASSETS 응답 상태 코드: ${response.status}`;
        },
      }),
    );
  }

  if (serviceBindings.length === 0) {
    checks.push(
      Promise.resolve({
        service: "service_binding",
        binding: "*",
        status: "skipped",
        detail: "추가 Service binding이 구성되지 않았습니다.",
      }),
    );
  } else {
    for (const entry of serviceBindings) {
      checks.push(
        runTimedCheck({
          service: "service_binding",
          binding: entry.name,
          detail: "Service binding fetch로 응답 가능 여부를 확인합니다.",
          probe: async () => {
            const response = await entry.binding.fetch(
              "https://service-health.internal/health",
              {
                method: "HEAD",
              },
            );
            if (response.status >= 500) {
              throw new Error(
                `unexpected service binding response status: ${response.status}`,
              );
            }
            return `Service binding 응답 상태 코드: ${response.status}`;
          },
        }),
      );
    }
  }

  return Promise.all(checks);
};

const summarizeChecks = (
  checks: HealthCheckResult[],
): HealthReport["summary"] => {
  return checks.reduce(
    (acc, check) => {
      acc.total += 1;
      if (check.status === "healthy") {
        acc.healthy += 1;
      } else if (check.status === "unhealthy") {
        acc.unhealthy += 1;
      } else {
        acc.skipped += 1;
      }
      return acc;
    },
    {
      total: 0,
      healthy: 0,
      unhealthy: 0,
      skipped: 0,
    },
  );
};

/**
 * 공개 응답에서 binding 이름/점검 상세/에러 문자열을 제거한 형태.
 * 인프라 구성을 외부에 노출하지 않으면서 서비스별 상태만 전달한다.
 */
export type PublicHealthCheckResult = {
  service: HealthCheckService;
  status: HealthCheckStatus;
  latencyMs?: number;
};

export type PublicHealthReport = Omit<HealthReport, "checks"> & {
  checks: PublicHealthCheckResult[];
};

export const toPublicHealthReport = (
  report: HealthReport,
): PublicHealthReport => {
  return {
    status: report.status,
    checkedAt: report.checkedAt,
    durationMs: report.durationMs,
    summary: report.summary,
    checks: report.checks.map((check) => ({
      service: check.service,
      status: check.status,
      ...(check.latencyMs === undefined ? {} : { latencyMs: check.latencyMs }),
    })),
  };
};

export const runInfrastructureHealthChecks = async (
  env: Partial<AppBindings> | undefined,
  options: { depth?: HealthCheckDepth } = {},
): Promise<HealthReport> => {
  const startedAt = performance.now();
  const runtimeEnv = env ?? {};
  const depth = options.depth ?? "deep";

  const [
    d1Checks,
    r2BucketChecks,
    r2PresignCheck,
    authConfigCheck,
    rateLimiterCheck,
    analyticsEngineCheck,
    durableObjectChecks,
    fetcherBindingChecks,
    // 쓰기 왕복 검사는 readiness에서만 수행한다.
    deepChecks,
  ] = await Promise.all([
    runD1Checks(runtimeEnv),
    runR2BucketChecks(runtimeEnv, depth),
    runR2PresignCheck(runtimeEnv),
    runAuthConfigCheck(runtimeEnv),
    runRateLimiterCheck(runtimeEnv),
    runAnalyticsEngineCheck(runtimeEnv),
    runDurableObjectChecks(runtimeEnv),
    runFetcherBindingChecks(runtimeEnv),
    depth === "deep"
      ? Promise.all([runDbSchemaCheck(runtimeEnv), runViewCountCheck(runtimeEnv)])
      : Promise.resolve<HealthCheckResult[]>([]),
  ]);

  const checks = [
    ...d1Checks,
    ...deepChecks,
    ...r2BucketChecks,
    r2PresignCheck,
    authConfigCheck,
    rateLimiterCheck,
    analyticsEngineCheck,
    ...durableObjectChecks,
    ...fetcherBindingChecks,
  ];
  const summary = summarizeChecks(checks);

  return {
    status: summary.unhealthy > 0 ? "unhealthy" : "healthy",
    checkedAt: new Date().toISOString(),
    durationMs: roundToTwoDecimals(performance.now() - startedAt),
    summary,
    checks,
  };
};
