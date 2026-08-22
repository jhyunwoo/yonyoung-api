import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/tests/**/*.test.ts", "tests/unit/**/*.test.ts"],
    // 실제 wrangler 워커를 부팅하는 테스트는 vitest.integration.config.ts가 담당한다.
    exclude: ["src/tests/worker.runtime.integration.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      // 선언/조립만 하는 파일은 커버리지 대상에서 제외한다.
      // feature repository는 이 목록에 넣지 않는다 — 영속화 로직은 회귀 게이트 대상이다.
      exclude: [
        "src/app.ts",
        "src/lib/auth.ts",
        "src/lib/auth/session.ts",
        "src/lib/openapi/descriptions.ts",
        "src/lib/openapi/enrich.ts",
        "src/lib/openapi/merge.ts",
        "src/lib/services/dependencies.ts",
        "src/lib/validation/request.ts",
        "src/platform/db/schema/**",
        "src/platform/db/data-service-composition.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 70,
      },
    },
  },
});
