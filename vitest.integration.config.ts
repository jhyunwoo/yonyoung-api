import { defineConfig } from "vitest/config";

/**
 * `unstable_dev`로 실제 wrangler 워커를 띄우는 테스트만 따로 실행한다.
 * 기본 Node 테스트 실행(`vitest.config.ts`)에 섞이면 매번 워커 부팅 비용을 치르게 되므로
 * 거기서는 제외해 두었고, 이 설정이 그 파일을 명시적으로 포함한다.
 */
export default defineConfig({
  test: {
    include: ["src/tests/worker.runtime.integration.test.ts"],
    environment: "node",
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
