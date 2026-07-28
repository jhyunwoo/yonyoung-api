import { createR2Client } from "../../infra/r2/client";

export const R2_STORAGE_LIMIT_BYTES = 10 * 1024 * 1024 * 1024;

/**
 * 전체 버킷 스캔은 페이지당 1회의 R2 호출을 소모한다. Workers의 요청당 서브리퀘스트
 * 한도와 CPU 시간을 넘기면 스캔이 통째로 실패하므로, 예산을 넘기면 예외 대신
 * 부분 결과(`complete: false`)를 돌려주고 호출부가 판단하게 한다.
 */
export const R2_USAGE_MAX_PAGES = 200;
export const R2_USAGE_MAX_ELAPSED_MS = 8_000;

const R2_USAGE_PAGE_MAX_RETRIES = 2;
const R2_USAGE_RETRY_BASE_DELAY_MS = 50;
const R2_USAGE_RETRY_MAX_DELAY_MS = 400;

const R2_USAGE_CACHE_TTL_SECONDS = 300;
const DEFAULT_CACHE_BUCKET_NAME = "default";

export type R2UsageScanResult = {
  totalUsageBytes: number;
  objectCount: number;
  pages: number;
  /** 예산 초과나 커서 이상으로 중단되면 false. false면 합계는 하한값일 뿐이다. */
  complete: boolean;
  elapsedMs: number;
  observedAt: number;
};

type ReadR2TotalUsageBytesOptions = {
  maxPages?: number;
  maxElapsedMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

type ReadR2TotalUsageBytesCachedOptions = ReadR2TotalUsageBytesOptions & {
  waitUntil?: (promise: Promise<unknown>) => void;
  ttlSeconds?: number;
  bucketName?: string;
};

const defaultSleep = async (ms: number): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
};

/**
 * 캐시 키를 버킷 단위로 분리한다. 전역 상수 키를 쓰면 같은 존에 배포된 dev/preview
 * Worker가 프로덕션 수치를 덮어쓸 수 있다.
 */
const buildUsageCacheKey = (bucketName?: string): string => {
  const normalized = bucketName?.trim();
  return `https://r2-usage.internal/${encodeURIComponent(
    normalized && normalized.length > 0 ? normalized : DEFAULT_CACHE_BUCKET_NAME,
  )}/total-usage-bytes`;
};

const resolveCache = (): Cache | undefined => {
  try {
    return (caches as unknown as { default?: Cache }).default;
  } catch {
    return undefined;
  }
};

const listObjectsWithRetry = async (
  client: ReturnType<typeof createR2Client>,
  options: R2ListOptions,
  sleep: (ms: number) => Promise<void>,
): Promise<R2Objects> => {
  let lastError: unknown;

  for (let attempt = 0; attempt <= R2_USAGE_PAGE_MAX_RETRIES; attempt += 1) {
    try {
      return await client.listObjects(options);
    } catch (error) {
      lastError = error;
      if (attempt === R2_USAGE_PAGE_MAX_RETRIES) {
        break;
      }

      const delayMs = Math.min(
        R2_USAGE_RETRY_BASE_DELAY_MS * 2 ** attempt,
        R2_USAGE_RETRY_MAX_DELAY_MS,
      );
      await sleep(delayMs);
    }
  }

  throw lastError;
};

export const readR2TotalUsageBytes = async (
  r2?: R2Bucket,
  options: ReadR2TotalUsageBytesOptions = {},
): Promise<R2UsageScanResult> => {
  if (!r2) {
    throw new Error("R2 bucket binding is not configured.");
  }

  const maxPages = options.maxPages ?? R2_USAGE_MAX_PAGES;
  const maxElapsedMs = options.maxElapsedMs ?? R2_USAGE_MAX_ELAPSED_MS;
  const sleep = options.sleep ?? defaultSleep;

  const client = createR2Client(r2);
  const startedAt = Date.now();

  let totalUsageBytes = 0;
  let objectCount = 0;
  let pages = 0;
  let complete = false;
  let cursor: string | undefined = undefined;

  while (true) {
    const listed = await listObjectsWithRetry(
      client,
      cursor ? { cursor } : {},
      sleep,
    );
    pages += 1;

    for (const object of listed.objects) {
      const size = object.size;
      // 크기가 비정상인 객체가 합계를 NaN으로 오염시키지 않도록 건너뛴다.
      if (!Number.isFinite(size) || size < 0) {
        continue;
      }
      totalUsageBytes += size;
      objectCount += 1;
    }

    if (!listed.truncated) {
      complete = true;
      break;
    }

    const nextCursor = listed.cursor;
    // truncated인데 커서가 없으면 같은 페이지를 무한 반복하게 된다.
    if (!nextCursor) {
      break;
    }

    if (pages >= maxPages || Date.now() - startedAt >= maxElapsedMs) {
      break;
    }

    cursor = nextCursor;
  }

  return {
    totalUsageBytes,
    objectCount,
    pages,
    complete,
    elapsedMs: Date.now() - startedAt,
    observedAt: startedAt,
  };
};

/**
 * R2 전체 사용량을 Workers Cache API에 단기(기본 5분) 캐시해 반환한다.
 * 전체 버킷 스캔은 객체 수에 비례해 수 초까지 걸리므로(대시보드 p90 병목),
 * 표시용 집계는 캐시로 충분하다. 캐시 계층 오류 시에는 직접 스캔으로 폴백한다.
 * 부분 결과는 캐시하지 않는다.
 */
export const readR2TotalUsageBytesCached = async (
  r2: R2Bucket | undefined,
  options: ReadR2TotalUsageBytesCachedOptions = {},
): Promise<R2UsageScanResult> => {
  if (!r2) {
    throw new Error("R2 bucket binding is not configured.");
  }

  const ttlSeconds = options.ttlSeconds ?? R2_USAGE_CACHE_TTL_SECONDS;
  const cacheKey = buildUsageCacheKey(options.bucketName);
  const cache = resolveCache();

  if (cache) {
    try {
      const cached = await cache.match(cacheKey);
      if (cached) {
        const body = (await cached.json()) as Partial<R2UsageScanResult>;
        if (
          typeof body.totalUsageBytes === "number" &&
          Number.isFinite(body.totalUsageBytes) &&
          body.complete === true
        ) {
          return {
            totalUsageBytes: body.totalUsageBytes,
            objectCount: body.objectCount ?? 0,
            pages: body.pages ?? 0,
            complete: true,
            elapsedMs: body.elapsedMs ?? 0,
            observedAt: body.observedAt ?? Date.now(),
          };
        }
      }
    } catch {
      // 캐시 조회 실패는 무시하고 직접 스캔으로 진행한다.
    }
  }

  const result = await readR2TotalUsageBytes(r2, options);

  // 불완전한 스캔을 캐시하면 잘못된 하한값이 TTL 동안 고정된다.
  if (cache && result.complete) {
    try {
      const putPromise = cache.put(
        cacheKey,
        new Response(JSON.stringify(result), {
          headers: {
            "content-type": "application/json",
            "cache-control": `public, max-age=${ttlSeconds}`,
          },
        }),
      );
      if (options.waitUntil) {
        options.waitUntil(putPromise.catch(() => undefined));
      } else {
        await putPromise.catch(() => undefined);
      }
    } catch {
      // 캐시 저장 실패는 결과 반환에 영향을 주지 않는다.
    }
  }

  return result;
};

/**
 * 업로드 정산/삭제처럼 사용량을 바꾸는 작업 이후 캐시를 비워, 대시보드가 최대 TTL만큼
 * 옛 수치를 보여주는 문제를 없앤다.
 */
export const invalidateR2UsageCache = async (
  options: {
    bucketName?: string;
    waitUntil?: (promise: Promise<unknown>) => void;
  } = {},
): Promise<void> => {
  const cache = resolveCache();
  if (!cache) {
    return;
  }

  const cacheKey = buildUsageCacheKey(options.bucketName);

  try {
    const deletePromise = Promise.resolve(cache.delete(cacheKey)).then(
      () => undefined,
      () => undefined,
    );
    if (options.waitUntil) {
      options.waitUntil(deletePromise);
      return;
    }
    await deletePromise;
  } catch {
    // 캐시 무효화 실패가 호출부 흐름을 막아서는 안 된다.
  }
};
