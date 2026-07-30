import { Context } from "hono";
import HonoAppType from "../../types/honoAppType";
import { runInBackground } from "./background-task";

const PUBLIC_CACHE_TTL_SECONDS = 120;
const PUBLIC_CACHE_STALE_REVALIDATE_SECONDS = 300;
const PUBLIC_CACHE_MAX_AGE_SECONDS = 30;
const PUBLIC_CACHE_KV_EXPIRATION_TTL_SECONDS =
  PUBLIC_CACHE_TTL_SECONDS + PUBLIC_CACHE_STALE_REVALIDATE_SECONDS + 60;
const PUBLIC_CACHE_KV_READ_CACHE_TTL_SECONDS = 30;
const PUBLIC_CACHE_KV_KEY_PREFIX = "public-api:v1:";
const PUBLIC_CACHE_KV_ENVELOPE_VERSION = 1;
const CACHE_STATUS_HEADER = "X-Public-Cache-Status";
const CACHE_SOURCE_HEADER = "X-Public-Cache-Source";
const CACHED_AT_HEADER = "X-Public-Cache-Cached-At";
const CACHEABLE_RESPONSE_FORBIDDEN_HEADERS = ["set-cookie"] as const;
const PERSONALIZATION_HEADERS = ["authorization", "cookie"] as const;
const TRANSIENT_RESPONSE_HEADERS = [
  CACHE_STATUS_HEADER.toLowerCase(),
  CACHE_SOURCE_HEADER.toLowerCase(),
  "server-timing",
  "x-correlation-id",
  "x-request-id",
  "x-response-time",
] as const;

type PublicCacheStatus =
  | "hit"
  | "miss"
  | "stale"
  | "bypass"
  | "skip-store";
type PublicCacheSource = "edge" | "kv" | "origin" | "bypass";

type KvCachedResponseEnvelope = {
  version: typeof PUBLIC_CACHE_KV_ENVELOPE_VERSION;
  cachedAt: number;
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
  body: string;
};

export const PUBLIC_CACHE_CONTROL = `public, max-age=${PUBLIC_CACHE_MAX_AGE_SECONDS}, s-maxage=${PUBLIC_CACHE_TTL_SECONDS}`;

const getDefaultCache = (): Cache | null => {
  const cacheStorage = (
    globalThis as typeof globalThis & {
      caches?: CacheStorage & { default?: Cache };
    }
  ).caches;
  return cacheStorage?.default ?? null;
};

const getKvCache = (c: Context<HonoAppType>): KVNamespace | null =>
  c.env?.PUBLIC_API_CACHE ?? null;

const hasHeaderValue = (
  headers: Headers,
  names: readonly string[],
): boolean => {
  return names.some((name) => {
    const value = headers.get(name);
    return typeof value === "string" && value.trim().length > 0;
  });
};

const shouldBypassPublicCache = (request: Request): boolean =>
  hasHeaderValue(request.headers, PERSONALIZATION_HEADERS);

const isCacheableResponse = (response: Response): boolean => {
  if (!response.ok) {
    return false;
  }

  return !hasHeaderValue(
    response.headers,
    CACHEABLE_RESPONSE_FORBIDDEN_HEADERS,
  );
};

const addCacheResultHeaders = (
  response: Response,
  status: PublicCacheStatus,
  source: PublicCacheSource,
): Response => {
  const headers = new Headers(response.headers);
  headers.set(CACHE_STATUS_HEADER, status);
  headers.set(CACHE_SOURCE_HEADER, source);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

const annotateCacheMetadata = (
  response: Response,
  cachedAtMs: number,
): Response => {
  if (!isCacheableResponse(response)) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("Cache-Control", PUBLIC_CACHE_CONTROL);
  headers.set(CACHED_AT_HEADER, `${cachedAtMs}`);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

const readCachedAt = (response: Response): number | null => {
  const value = response.headers.get(CACHED_AT_HEADER);
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
};

const isFreshCache = (cachedAt: number, now: number): boolean =>
  now - cachedAt <= PUBLIC_CACHE_TTL_SECONDS * 1000;

const isStaleButRevalidatable = (cachedAt: number, now: number): boolean =>
  now - cachedAt <=
  (PUBLIC_CACHE_TTL_SECONDS + PUBLIC_CACHE_STALE_REVALIDATE_SECONDS) * 1000;

const setCacheStatusVariable = (
  c: Context<HonoAppType>,
  status: PublicCacheStatus,
) => {
  c.set("cacheStatus", status);
};

const createEdgeCacheKey = (requestUrl: string): Request =>
  new Request(requestUrl, { method: "GET" });

const createKvCacheKey = (requestUrl: string): string | null => {
  const url = new URL(requestUrl);
  const sortedSearch = new URLSearchParams(
    [...url.searchParams.entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      const keyComparison = leftKey.localeCompare(rightKey);
      return keyComparison !== 0
        ? keyComparison
        : leftValue.localeCompare(rightValue);
    }),
  ).toString();
  const key = `${PUBLIC_CACHE_KV_KEY_PREFIX}${url.pathname}${
    sortedSearch ? `?${sortedSearch}` : ""
  }`;

  // Workers KV keys are limited to 512 bytes. Public API routes are normally
  // well below this; oversized query strings simply skip the KV tier.
  return new TextEncoder().encode(key).byteLength <= 512 ? key : null;
};

const isKvCachedResponseEnvelope = (
  value: unknown,
): value is KvCachedResponseEnvelope => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<KvCachedResponseEnvelope>;
  return (
    candidate.version === PUBLIC_CACHE_KV_ENVELOPE_VERSION &&
    typeof candidate.cachedAt === "number" &&
    Number.isFinite(candidate.cachedAt) &&
    candidate.cachedAt > 0 &&
    typeof candidate.status === "number" &&
    Number.isInteger(candidate.status) &&
    candidate.status >= 200 &&
    candidate.status <= 299 &&
    typeof candidate.statusText === "string" &&
    typeof candidate.body === "string" &&
    Array.isArray(candidate.headers) &&
    candidate.headers.every(
      (header) =>
        Array.isArray(header) &&
        header.length === 2 &&
        typeof header[0] === "string" &&
        typeof header[1] === "string",
    )
  );
};

const responseFromKvEnvelope = (
  envelope: KvCachedResponseEnvelope,
): Response => {
  const headers = new Headers(envelope.headers);
  headers.set(CACHED_AT_HEADER, String(envelope.cachedAt));
  return new Response(envelope.body, {
    status: envelope.status,
    statusText: envelope.statusText,
    headers,
  });
};

const responseToKvEnvelope = async (
  response: Response,
): Promise<KvCachedResponseEnvelope | null> => {
  const cachedAt = readCachedAt(response);
  if (cachedAt === null || !isCacheableResponse(response)) {
    return null;
  }

  const headers = [...response.headers.entries()].filter(
    ([name]) =>
      !TRANSIENT_RESPONSE_HEADERS.includes(
        name.toLowerCase() as (typeof TRANSIENT_RESPONSE_HEADERS)[number],
      ),
  );

  return {
    version: PUBLIC_CACHE_KV_ENVELOPE_VERSION,
    cachedAt,
    status: response.status,
    statusText: response.statusText,
    headers,
    body: await response.clone().text(),
  };
};

const readFromKv = async (
  kv: KVNamespace,
  key: string,
): Promise<Response | null> => {
  try {
    const envelope = await kv.get<KvCachedResponseEnvelope>(key, {
      type: "json",
      cacheTtl: PUBLIC_CACHE_KV_READ_CACHE_TTL_SECONDS,
    });
    return isKvCachedResponseEnvelope(envelope)
      ? responseFromKvEnvelope(envelope)
      : null;
  } catch {
    return null;
  }
};

const writeToKv = async (
  kv: KVNamespace,
  key: string,
  response: Response,
): Promise<void> => {
  const envelope = await responseToKvEnvelope(response);
  if (!envelope) {
    return;
  }

  await kv.put(key, JSON.stringify(envelope), {
    expirationTtl: PUBLIC_CACHE_KV_EXPIRATION_TTL_SECONDS,
    metadata: {
      cachedAt: envelope.cachedAt,
      status: envelope.status,
      version: envelope.version,
    },
  });
};

const storeInAvailableCaches = async (
  input: {
    edgeCache: Cache | null;
    edgeKey: Request;
    kvCache: KVNamespace | null;
    kvKey: string | null;
    response: Response;
  },
): Promise<void> => {
  const tasks: Promise<unknown>[] = [];

  if (input.edgeCache) {
    tasks.push(input.edgeCache.put(input.edgeKey, input.response.clone()));
  }

  if (input.kvCache && input.kvKey) {
    tasks.push(writeToKv(input.kvCache, input.kvKey, input.response));
  }

  if (tasks.length === 0) {
    return;
  }

  await Promise.all(tasks);
};

const backfillEdgeCache = async (
  c: Context<HonoAppType>,
  cache: Cache,
  cacheKey: Request,
  response: Response,
): Promise<void> => {
  await runInBackground(c, cache.put(cacheKey, response.clone()), {
    fallback: "await",
  });
};

export const withPublicCacheHeaders = (response: Response): Response => {
  return annotateCacheMetadata(response, Date.now());
};

export const respondWithPublicCache = async (
  c: Context<HonoAppType>,
  buildResponse: () => Promise<Response>,
): Promise<Response> => {
  const request = c.req.raw;
  if (shouldBypassPublicCache(request)) {
    setCacheStatusVariable(c, "bypass");
    const response = withPublicCacheHeaders(await buildResponse());
    return addCacheResultHeaders(response, "bypass", "bypass");
  }

  const edgeCache = getDefaultCache();
  const kvCache = getKvCache(c);
  const edgeKey = createEdgeCacheKey(c.req.url);
  const kvKey = createKvCacheKey(c.req.url);
  const now = Date.now();

  if (edgeCache) {
    try {
      const cached = await edgeCache.match(edgeKey);
      if (cached) {
        const cachedAt = readCachedAt(cached);
        if (cachedAt !== null) {
          if (isFreshCache(cachedAt, now)) {
            setCacheStatusVariable(c, "hit");
            return addCacheResultHeaders(cached, "hit", "edge");
          }

          if (isStaleButRevalidatable(cachedAt, now)) {
            setCacheStatusVariable(c, "stale");
            await runInBackground(
              c,
              (async () => {
                const refreshed = annotateCacheMetadata(
                  await buildResponse(),
                  Date.now(),
                );
                if (!isCacheableResponse(refreshed)) {
                  return;
                }
                await storeInAvailableCaches({
                  edgeCache,
                  edgeKey,
                  kvCache,
                  kvKey,
                  response: refreshed,
                });
              })(),
            );
            return addCacheResultHeaders(cached, "stale", "edge");
          }
        }
      }
    } catch {
      // Edge cache failures must not prevent the KV/origin fallbacks.
    }
  }

  if (kvCache && kvKey) {
    const cached = await readFromKv(kvCache, kvKey);
    if (cached) {
      const cachedAt = readCachedAt(cached);
      if (cachedAt !== null) {
        if (isFreshCache(cachedAt, now)) {
          setCacheStatusVariable(c, "hit");
          if (edgeCache) {
            await backfillEdgeCache(c, edgeCache, edgeKey, cached);
          }
          return addCacheResultHeaders(cached, "hit", "kv");
        }

        if (isStaleButRevalidatable(cachedAt, now)) {
          setCacheStatusVariable(c, "stale");
          await runInBackground(
            c,
            (async () => {
              const refreshed = annotateCacheMetadata(
                await buildResponse(),
                Date.now(),
              );
              if (!isCacheableResponse(refreshed)) {
                return;
              }
              await storeInAvailableCaches({
                edgeCache,
                edgeKey,
                kvCache,
                kvKey,
                response: refreshed,
              });
            })(),
          );
          return addCacheResultHeaders(cached, "stale", "kv");
        }
      }
    }
  }

  const response = annotateCacheMetadata(await buildResponse(), now);
  if (!isCacheableResponse(response)) {
    setCacheStatusVariable(c, "skip-store");
    return addCacheResultHeaders(response, "skip-store", "origin");
  }

  if (!edgeCache && (!kvCache || !kvKey)) {
    setCacheStatusVariable(c, "skip-store");
    return addCacheResultHeaders(response, "skip-store", "origin");
  }

  setCacheStatusVariable(c, "miss");
  await runInBackground(
    c,
    storeInAvailableCaches({
      edgeCache,
      edgeKey,
      kvCache,
      kvKey,
      response,
    }),
    {
      fallback: "await",
    },
  );

  return addCacheResultHeaders(response, "miss", "origin");
};
