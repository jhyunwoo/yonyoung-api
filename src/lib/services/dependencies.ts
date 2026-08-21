import type { Context } from "hono";
import { getActorFromSession } from "../auth/session";
import { createAuth } from "../auth";
import { type Actor } from "../authorization/types";
import type HonoAppType from "../../types/honoAppType";
import { parseBooleanEnv, parseNumberEnv } from "../../bindings/env";
import { resolveD1Database } from "../../infra/db/client";
import { resolveR2Bucket } from "../../infra/r2/client";
import { type DataService, type PresignService } from "./types";
import { createR2PresignService } from "../storage/presign";
import type { OpenAPIDocument } from "../openapi/merge";
import { getDbDataService } from "../db/factory";
import { resolveDocsEnabled } from "../config/runtime-env";
import { createD1SequentialSession, resolveD1SessionMode } from "../db/d1-session";
import { createRetryingD1Database } from "../db/d1-client";
import {
  readR2TotalUsageBytesCached,
  type R2UsageScanResult,
} from "../storage/usage";
import {
  createD1ViewCountStore,
  type ViewCountStore,
} from "../views/view-counts";
import {
  createD1MultipartUploadStateStore,
  type MultipartUploadStateStore,
} from "../uploads/multipart-state";
import {
  createD1UploadReservationStore,
  type UploadReservationStore,
} from "../uploads/upload-reservation";

export type ResolveActor = (
  c: Context<HonoAppType>,
) => Promise<Actor | null> | Actor | null;

export type GetDataService = (c: Context<HonoAppType>) => DataService;

export type GetPresignService = (c: Context<HonoAppType>) => PresignService;

export type ReadR2TotalUsageBytes = (
  c: Context<HonoAppType>,
) => Promise<R2UsageScanResult>;

export type GetAuthOpenApiSchema = (
  c: Context<HonoAppType>,
) => Promise<OpenAPIDocument>;

export type IsDocsEnabled = (c: Context<HonoAppType>) => boolean;

export type AllowPageViewWrite = (
  c: Context<HonoAppType>,
) => Promise<boolean>;

export type AppDependencies = {
  resolveActor: ResolveActor;
  getDataService: GetDataService;
  getPresignService: GetPresignService;
  readR2TotalUsageBytes: ReadR2TotalUsageBytes;
  getAuthOpenApiSchema: GetAuthOpenApiSchema;
  isDocsEnabled: IsDocsEnabled;
  getViewCountStore: (c: Context<HonoAppType>) => ViewCountStore;
  allowPageViewWrite: AllowPageViewWrite;
  getMultipartUploadStateStore: (
    c: Context<HonoAppType>,
  ) => MultipartUploadStateStore;
  getUploadReservationStore: (
    c: Context<HonoAppType>,
  ) => UploadReservationStore;
};

// 업로드 예약이 사용하는 관측 신선도 창(30초)보다 짧게 유지한다.
// 캐시 항목은 대시보드와 공유하므로 저장 TTL이 아니라 읽는 쪽의 허용 나이로 강제한다.
const UPLOAD_USAGE_MAX_AGE_MS = 15_000;

const createRequestDatabase = (c: Context<HonoAppType>) => {
  const database = resolveD1Database(c.env);
  const sessionMode = resolveD1SessionMode(c.env.D1_SESSION_CONSISTENCY);
  const session = createD1SequentialSession(database, {
    mode: sessionMode,
  });

  const retryEnabled = parseBooleanEnv(c.env.D1_WRITE_RETRY_ENABLED, true);
  return createRetryingD1Database(session.database, {
    enabled: retryEnabled,
    options: {
      maxRetries: parseNumberEnv(c.env.D1_WRITE_RETRY_MAX_RETRIES, 2),
      baseDelayMs: parseNumberEnv(c.env.D1_WRITE_RETRY_BASE_DELAY_MS, 25),
      maxDelayMs: parseNumberEnv(c.env.D1_WRITE_RETRY_MAX_DELAY_MS, 500),
    },
  });
};

export const createDefaultDependencies = (): AppDependencies => ({
  resolveActor: getActorFromSession,
  isDocsEnabled: (c) => resolveDocsEnabled(c.env),
  getDataService: (c) => {
    const cached = c.get("dataService");
    if (cached) {
      return cached;
    }

    const dataService = getDbDataService(createRequestDatabase(c) as D1Database);
    c.set("dataService", dataService);
    return dataService;
  },
  getPresignService: (c) => createR2PresignService(c.env),
  // 업로드마다 전체 버킷을 다시 스캔하지 않도록 짧은 TTL 캐시를 사용한다.
  // 실제 한도 집행은 활성 예약 합계를 더하는 D1 트리거가 담당한다.
  readR2TotalUsageBytes: (c) =>
    readR2TotalUsageBytesCached(resolveR2Bucket(c.env), {
      maxAgeMs: UPLOAD_USAGE_MAX_AGE_MS,
      bucketName: c.env.R2_BUCKET,
    }),
  getViewCountStore: (c) => createD1ViewCountStore(createRequestDatabase(c)),
  allowPageViewWrite: async (c) => {
    const limiter = c.env.PAGE_VIEW_RATE_LIMITER;
    if (!limiter) {
      // Analytics writes are optional. Missing production admission control
      // must fail closed while preserving the public endpoint response shape.
      return false;
    }

    const clientKey = c.req.header("cf-connecting-ip")?.trim() || "unknown";
    try {
      const result = await limiter.limit({
        key: `anonymous-page-view:${clientKey}`,
      });
      return result.success;
    } catch {
      return false;
    }
  },
  getMultipartUploadStateStore: (c) =>
    createD1MultipartUploadStateStore(createRequestDatabase(c)),
  getUploadReservationStore: (c) =>
    createD1UploadReservationStore(createRequestDatabase(c)),
  getAuthOpenApiSchema: async (c) => {
    const database = resolveD1Database(c.env);
    const auth = createAuth(database, c.env);
    const request = new Request(
      new URL("/api/auth/open-api/generate-schema", c.req.url),
      {
        method: "GET",
        headers: c.req.raw.headers,
      },
    );
    const response = await auth.handler(request);
    if (!response.ok) {
      throw new Error("인증 OpenAPI 스키마 조회에 실패했습니다.");
    }
    return (await response.json()) as OpenAPIDocument;
  },
});
