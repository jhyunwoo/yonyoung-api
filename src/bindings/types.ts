import type { Actor } from "../lib/authorization/types";
import type { DataService } from "../lib/services/types";

type RuntimeBindingOverrides = {
  DB?: D1Database;
  db?: D1Database;
  R2?: R2Bucket;
  r2?: R2Bucket;
  PUBLIC_API_CACHE?: KVNamespace;
  PERF_ANALYTICS?: AnalyticsEngineDataset;
  PAGE_VIEW_RATE_LIMITER?: RateLimit;
  BETTER_AUTH_URL?: string;
  BETTER_AUTH_TRUSTED_ORIGINS?: string;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_EMAIL_AND_PASSWORD_ENABLED?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  R2_S3_ENDPOINT?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET?: string;
  R2_PUBLIC_BASE_URL?: string;
  R2_PUBLIC_URL_SIGNING_SECRET?: string;
  R2_PUBLIC_URL_SIGNING_SECRET_PREVIOUS?: string;
  DOCS_ENABLED?: string;
  DOCS_AUTH_IN_PROD?: string;
  D1_SESSION_CONSISTENCY?: string;
  D1_WRITE_RETRY_ENABLED?: string;
  D1_WRITE_RETRY_MAX_RETRIES?: string;
  D1_WRITE_RETRY_BASE_DELAY_MS?: string;
  D1_WRITE_RETRY_MAX_DELAY_MS?: string;
  PERF_ANALYTICS_ENABLED?: string;
  PERF_ANALYTICS_SAMPLE_RATE?: string;
  CSP_REPORT_ONLY?: string;
};

// Wrangler emits literal string types for vars declared in wrangler.jsonc.
// Runtime/test overrides legitimately use other validated values, so replace
// those generated keys instead of intersecting them with their literals.
export type Bindings = Omit<
  CloudflareBindings,
  keyof RuntimeBindingOverrides
> &
  RuntimeBindingOverrides;

export type AppVariables = {
  actor: Actor | null;
  requestId: string;
  correlationId: string;
  startedAt: number;
  cacheStatus: "hit" | "miss" | "stale" | "bypass" | "skip-store" | null;
  actorResolved: boolean;
  dataService: DataService | null;
};

export type HonoAppEnv = {
  Bindings: Bindings;
  Variables: AppVariables;
};
