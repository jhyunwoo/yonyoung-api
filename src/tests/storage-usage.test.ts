import { afterEach, describe, expect, it, vi } from "vitest";
import {
  invalidateR2UsageCache,
  readR2TotalUsageBytes,
  readR2TotalUsageBytesCached,
} from "../lib/storage/usage";

const noSleep = async (): Promise<void> => undefined;

/** 캐시 계층 테스트용 최소 Cache 스텁을 전역에 설치한다. */
const installCacheStub = () => {
  const store = new Map<string, string>();
  const cache = {
    match: vi.fn(async (key: string) => {
      const body = store.get(key);
      return body === undefined ? undefined : new Response(body);
    }),
    put: vi.fn(async (key: string, response: Response) => {
      store.set(key, await response.text());
    }),
    delete: vi.fn(async (key: string) => store.delete(key)),
  };

  Object.defineProperty(globalThis, "caches", {
    value: { default: cache },
    configurable: true,
    writable: true,
  });

  return { cache, store };
};

afterEach(() => {
  Reflect.deleteProperty(globalThis, "caches");
  vi.restoreAllMocks();
});

describe("readR2TotalUsageBytes", () => {
  it("페이지네이션된 객체 크기를 모두 합산한다", async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({
        objects: [{ size: 1024 }, { size: 2048 }],
        truncated: true,
        cursor: "cursor-1",
      })
      .mockResolvedValueOnce({
        objects: [{ size: 4096 }],
        truncated: false,
        cursor: undefined,
      });

    const result = await readR2TotalUsageBytes({
      list,
    } as unknown as R2Bucket);

    expect(result.totalUsageBytes).toBe(1024 + 2048 + 4096);
    expect(result.objectCount).toBe(3);
    expect(result.pages).toBe(2);
    expect(result.complete).toBe(true);
    expect(list).toHaveBeenNthCalledWith(1, {});
    expect(list).toHaveBeenNthCalledWith(2, { cursor: "cursor-1" });
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("버킷이 비어 있으면 0을 반환한다", async () => {
    const list = vi.fn().mockResolvedValue({
      objects: [],
      truncated: false,
      cursor: undefined,
    });

    const result = await readR2TotalUsageBytes({
      list,
    } as unknown as R2Bucket);

    expect(result.totalUsageBytes).toBe(0);
    expect(result.complete).toBe(true);
    expect(list).toHaveBeenCalledWith({});
  });

  it("바인딩이 없으면 예외를 던진다", async () => {
    await expect(readR2TotalUsageBytes(undefined)).rejects.toThrow(
      /not configured/,
    );
  });

  it("페이지 예산을 넘기면 부분 결과를 반환한다", async () => {
    const list = vi.fn(async (options: { cursor?: string }) => ({
      objects: [{ size: 10 }],
      truncated: true,
      cursor: `cursor-${options.cursor ?? "0"}`,
    }));

    const result = await readR2TotalUsageBytes(
      { list } as unknown as R2Bucket,
      { maxPages: 3, sleep: noSleep },
    );

    expect(result.complete).toBe(false);
    expect(result.pages).toBe(3);
    expect(result.totalUsageBytes).toBe(30);
    expect(list).toHaveBeenCalledTimes(3);
  });

  it("시간 예산을 넘기면 부분 결과를 반환한다", async () => {
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => {
      now += 500;
      return now;
    });

    const list = vi.fn(async () => ({
      objects: [{ size: 5 }],
      truncated: true,
      cursor: "next",
    }));

    const result = await readR2TotalUsageBytes(
      { list } as unknown as R2Bucket,
      { maxPages: 1000, maxElapsedMs: 1_000, sleep: noSleep },
    );

    expect(result.complete).toBe(false);
    expect(list.mock.calls.length).toBeLessThan(1000);
  });

  it("truncated인데 커서가 없으면 무한 루프 대신 중단한다", async () => {
    const list = vi.fn().mockResolvedValue({
      objects: [{ size: 7 }],
      truncated: true,
      cursor: undefined,
    });

    const result = await readR2TotalUsageBytes({
      list,
    } as unknown as R2Bucket);

    expect(result.complete).toBe(false);
    expect(result.totalUsageBytes).toBe(7);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("크기가 비정상인 객체는 합계에서 제외한다", async () => {
    const list = vi.fn().mockResolvedValue({
      objects: [
        { size: 100 },
        { size: Number.NaN },
        { size: -5 },
        { size: Number.POSITIVE_INFINITY },
        { size: 50 },
      ],
      truncated: false,
    });

    const result = await readR2TotalUsageBytes({
      list,
    } as unknown as R2Bucket);

    expect(result.totalUsageBytes).toBe(150);
    expect(result.objectCount).toBe(2);
  });

  it("일시적인 list 오류는 재시도로 복구한다", async () => {
    const list = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce({
        objects: [{ size: 42 }],
        truncated: false,
      });

    const result = await readR2TotalUsageBytes(
      { list } as unknown as R2Bucket,
      { sleep: noSleep },
    );

    expect(result.totalUsageBytes).toBe(42);
    expect(result.complete).toBe(true);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("재시도를 모두 소진하면 예외를 전파한다", async () => {
    const list = vi.fn().mockRejectedValue(new Error("permanent"));

    await expect(
      readR2TotalUsageBytes({ list } as unknown as R2Bucket, {
        sleep: noSleep,
      }),
    ).rejects.toThrow();
    expect(list).toHaveBeenCalledTimes(3);
  });
});

describe("readR2TotalUsageBytesCached", () => {
  it("완료된 스캔 결과를 캐시에 저장한다", async () => {
    const { cache } = installCacheStub();
    const list = vi.fn().mockResolvedValue({
      objects: [{ size: 128 }],
      truncated: false,
    });

    const result = await readR2TotalUsageBytesCached(
      { list } as unknown as R2Bucket,
      { bucketName: "prod-bucket" },
    );

    expect(result.totalUsageBytes).toBe(128);
    expect(cache.put).toHaveBeenCalledTimes(1);
    expect(cache.put.mock.calls[0]?.[0]).toContain("prod-bucket");
  });

  it("두 번째 호출은 캐시 히트로 스캔을 생략한다", async () => {
    installCacheStub();
    const list = vi.fn().mockResolvedValue({
      objects: [{ size: 64 }],
      truncated: false,
    });
    const bucket = { list } as unknown as R2Bucket;

    await readR2TotalUsageBytesCached(bucket, { bucketName: "b" });
    const second = await readR2TotalUsageBytesCached(bucket, {
      bucketName: "b",
    });

    expect(second.totalUsageBytes).toBe(64);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("버킷이 다르면 캐시를 공유하지 않는다", async () => {
    installCacheStub();
    const list = vi.fn().mockResolvedValue({
      objects: [{ size: 8 }],
      truncated: false,
    });
    const bucket = { list } as unknown as R2Bucket;

    await readR2TotalUsageBytesCached(bucket, { bucketName: "prod" });
    await readR2TotalUsageBytesCached(bucket, { bucketName: "dev" });

    expect(list).toHaveBeenCalledTimes(2);
  });

  it("부분 결과는 캐시하지 않는다", async () => {
    const { cache } = installCacheStub();
    const list = vi.fn().mockResolvedValue({
      objects: [{ size: 16 }],
      truncated: true,
      cursor: undefined,
    });

    const result = await readR2TotalUsageBytesCached(
      { list } as unknown as R2Bucket,
      { bucketName: "b" },
    );

    expect(result.complete).toBe(false);
    expect(cache.put).not.toHaveBeenCalled();
  });

  it("무효화 이후에는 다시 스캔한다", async () => {
    installCacheStub();
    const list = vi.fn().mockResolvedValue({
      objects: [{ size: 32 }],
      truncated: false,
    });
    const bucket = { list } as unknown as R2Bucket;

    await readR2TotalUsageBytesCached(bucket, { bucketName: "b" });
    await invalidateR2UsageCache({ bucketName: "b" });
    await readR2TotalUsageBytesCached(bucket, { bucketName: "b" });

    expect(list).toHaveBeenCalledTimes(2);
  });

  it("캐시 계층이 없어도 스캔 결과를 반환한다", async () => {
    const list = vi.fn().mockResolvedValue({
      objects: [{ size: 256 }],
      truncated: false,
    });

    const result = await readR2TotalUsageBytesCached({
      list,
    } as unknown as R2Bucket);

    expect(result.totalUsageBytes).toBe(256);
  });
});
