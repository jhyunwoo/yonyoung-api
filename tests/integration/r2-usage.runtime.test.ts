import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  readR2TotalUsageBytes,
  readR2TotalUsageBytesCached,
} from "../../src/lib/storage/usage";

/**
 * 실제 Workers 런타임(R2 바인딩 + Cache API)에서 사용량 집계를 검증한다.
 * 단위 테스트의 목은 커서를 "마지막 키"로 취급하지만 실제 R2 커서는 불투명 토큰이고,
 * Cache API도 목으로는 재현되지 않는다. 집계가 틀어지는 경로는 여기서만 잡힌다.
 */
describe("r2 usage scan on the real workers runtime", () => {
  const bucket = () => (env as unknown as { r2: R2Bucket }).r2;

  const emptyBucket = async () => {
    let cursor: string | undefined;
    for (;;) {
      const listed: R2Objects = await bucket().list(
        cursor ? { cursor } : undefined,
      );
      if (listed.objects.length > 0) {
        await bucket().delete(listed.objects.map((object) => object.key));
      }
      if (!listed.truncated) {
        return;
      }
      cursor = listed.cursor;
    }
  };

  beforeEach(emptyBucket);

  it("Cache API 경로가 같은 관측 결과를 재사용한다", async () => {
    await bucket().put("cached/a", "0123456789");

    const first = await readR2TotalUsageBytesCached(bucket(), {
      bucketName: "reuse-bucket",
    });
    const second = await readR2TotalUsageBytesCached(bucket(), {
      bucketName: "reuse-bucket",
    });

    expect(first.totalUsageBytes).toBe(10);
    expect(second.totalUsageBytes).toBe(10);
    // 관측 시각이 같으면 두 번째 호출이 캐시에서 왔다는 뜻이다.
    expect(second.observedAt).toBe(first.observedAt);
  }, 30_000);

  it("요구한 신선도를 넘긴 캐시 값은 저장 TTL이 남아 있어도 재스캔한다", async () => {
    await bucket().put("stale/a", "0123456789");

    // 대시보드가 기본 TTL(300초)로 저장한다.
    const stored = await readR2TotalUsageBytesCached(bucket(), {
      bucketName: "stale-bucket",
    });
    await bucket().put("stale/b", "0123456789");

    // 업로드 한도 판정은 훨씬 짧은 신선도를 요구하므로 저장된 값을 쓰면 안 된다.
    const fresh = await readR2TotalUsageBytesCached(bucket(), {
      bucketName: "stale-bucket",
      maxAgeMs: 0,
    });

    expect(stored.totalUsageBytes).toBe(10);
    expect(fresh.totalUsageBytes).toBe(20);
  }, 30_000);

  it("실제 R2 바인딩의 크기 합계를 그대로 집계한다", async () => {
    await bucket().put("size/a", "0123456789");
    await bucket().put("size/b", "01234");

    const result = await readR2TotalUsageBytes(bucket());

    expect(result.complete).toBe(true);
    expect(result.objectCount).toBe(2);
    expect(result.totalUsageBytes).toBe(15);
  }, 30_000);
});
