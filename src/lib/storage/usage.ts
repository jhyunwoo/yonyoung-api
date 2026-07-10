import { createR2Client } from "../../infra/r2/client";

export const R2_STORAGE_LIMIT_BYTES = 10 * 1024 * 1024 * 1024;

const R2_USAGE_CACHE_KEY = "https://r2-usage.internal/total-usage-bytes";
const R2_USAGE_CACHE_TTL_SECONDS = 300;

type ReadR2TotalUsageBytesCachedOptions = {
  waitUntil?: (promise: Promise<unknown>) => void;
  ttlSeconds?: number;
};

/**
 * R2 전체 사용량을 Workers Cache API에 단기(기본 5분) 캐시해 반환한다.
 * 전체 버킷 스캔은 객체 수에 비례해 수 초까지 걸리므로(대시보드 p90 병목),
 * 표시용 집계는 캐시로 충분하다. 캐시 계층 오류 시에는 직접 스캔으로 폴백한다.
 */
export const readR2TotalUsageBytesCached = async (
  r2: R2Bucket | undefined,
  options: ReadR2TotalUsageBytesCachedOptions = {},
): Promise<number> => {
  if (!r2) {
    throw new Error("R2 bucket binding is not configured.");
  }

  const ttlSeconds = options.ttlSeconds ?? R2_USAGE_CACHE_TTL_SECONDS;

  let cache: Cache | undefined;
  try {
    cache = (caches as unknown as { default?: Cache }).default;
  } catch {
    cache = undefined;
  }

  if (cache) {
    try {
      const cached = await cache.match(R2_USAGE_CACHE_KEY);
      if (cached) {
        const body = (await cached.json()) as { totalUsageBytes?: number };
        if (typeof body.totalUsageBytes === "number") {
          return body.totalUsageBytes;
        }
      }
    } catch {
      // 캐시 조회 실패는 무시하고 직접 스캔으로 진행한다.
    }
  }

  const totalUsageBytes = await readR2TotalUsageBytes(r2);

  if (cache) {
    try {
      const putPromise = cache.put(
        R2_USAGE_CACHE_KEY,
        new Response(JSON.stringify({ totalUsageBytes }), {
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

  return totalUsageBytes;
};

export const readR2TotalUsageBytes = async (r2?: R2Bucket): Promise<number> => {
  if (!r2) {
    throw new Error("R2 bucket binding is not configured.");
  }

  const client = createR2Client(r2);
  let totalUsageBytes = 0;
  let cursor: string | undefined = undefined;

  while (true) {
    const listed = await client.listObjects(cursor ? { cursor } : {});
    for (const object of listed.objects) {
      totalUsageBytes += object.size;
    }

    if (!listed.truncated) {
      break;
    }

    cursor = listed.cursor;
  }

  return totalUsageBytes;
};
