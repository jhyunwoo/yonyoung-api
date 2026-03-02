import type { Context } from "hono";
import { getActorFromSession } from "../auth/session";
import { createAuth } from "../auth";
import { Actor } from "../authorization/types";
import HonoAppType from "../../types/honoAppType";
import { DataService, PresignService } from "./types";
import { createR2PresignService } from "../storage/presign";
import type { OpenAPIDocument } from "../openapi/merge";
import { getDbDataService } from "../db/factory";
import { resolveDocsAuthEnabled } from "../config/runtime-env";
import { createD1SequentialSession, resolveD1SessionMode } from "../db/d1-session";
import { createRetryingD1Database } from "../db/d1-client";
import { readR2TotalUsageBytes } from "../storage/usage";

export type ResolveActor = (
  c: Context<HonoAppType>,
) => Promise<Actor | null> | Actor | null;

export type GetDataService = (c: Context<HonoAppType>) => DataService;

export type GetPresignService = (c: Context<HonoAppType>) => PresignService;

export type ReadR2TotalUsageBytes = (
  c: Context<HonoAppType>,
) => Promise<number>;

export type GetAuthOpenApiSchema = (
  c: Context<HonoAppType>,
) => Promise<OpenAPIDocument>;

export type ShouldRequireDocsAuth = (c: Context<HonoAppType>) => boolean;

export type AppDependencies = {
  resolveActor: ResolveActor;
  getDataService: GetDataService;
  getPresignService: GetPresignService;
  readR2TotalUsageBytes: ReadR2TotalUsageBytes;
  getAuthOpenApiSchema: GetAuthOpenApiSchema;
  shouldRequireDocsAuth: ShouldRequireDocsAuth;
};

const parseBooleanString = (
  value: string | undefined,
  fallback: boolean,
): boolean => {
  if (!value) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
};

const parseNumberString = (
  value: string | undefined,
  fallback: number,
): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return parsed;
};

export const createDefaultDependencies = (): AppDependencies => ({
  resolveActor: getActorFromSession,
  shouldRequireDocsAuth: (c) => resolveDocsAuthEnabled(c.env),
  getDataService: (c) => {
    const cached = c.get("dataService");
    if (cached) {
      return cached;
    }

    const sessionMode = resolveD1SessionMode(c.env.D1_SESSION_CONSISTENCY);
    const session = createD1SequentialSession(c.env.db, {
      mode: sessionMode,
    });

    const retryEnabled = parseBooleanString(c.env.D1_WRITE_RETRY_ENABLED, true);
    const databaseWithRetry = createRetryingD1Database(session.database, {
      enabled: retryEnabled,
      options: {
        maxRetries: parseNumberString(c.env.D1_WRITE_RETRY_MAX_RETRIES, 2),
        baseDelayMs: parseNumberString(c.env.D1_WRITE_RETRY_BASE_DELAY_MS, 25),
        maxDelayMs: parseNumberString(c.env.D1_WRITE_RETRY_MAX_DELAY_MS, 500),
      },
    });

    const dataService = getDbDataService(databaseWithRetry as D1Database);
    c.set("dataService", dataService);
    return dataService;
  },
  getPresignService: (c) => createR2PresignService(c.env),
  readR2TotalUsageBytes: (c) => readR2TotalUsageBytes(c.env.r2),
  getAuthOpenApiSchema: async (c) => {
    const auth = createAuth(c.env.db, c.env);
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
