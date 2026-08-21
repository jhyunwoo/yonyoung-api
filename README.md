# Yonyoung API

Cloudflare Workers 기반 Hono API 서버입니다.

## Tech Stack

- Runtime: Cloudflare Workers
- API Framework: Hono + `@hono/zod-openapi`
- Database: Cloudflare D1 + Drizzle ORM
- Object Storage: Cloudflare R2
- Auth: Better Auth
- Validation: Zod

## Architecture

```text
src/
  app/          # 애플리케이션 조립 (createApp, middleware, system/docs 라우트)
  features/     # 도메인별 세로 단면 (contract · routes · policy · repository)
  platform/     # 인프라 어댑터 (Drizzle 스키마, D1 헬퍼, DataService 조립)
  shared/       # 도메인 없는 공용 요소 (errors, http guards, openapi primitives)
  lib/          # 아직 feature로 옮기지 않은 가로 계층 (storage, uploads, health, cache)
  routes/       # feature 라우터 마운트
  index.ts      # Worker entrypoint (공개 API 캐시 경계 포함)

tests/
  integration/  # 실제 Workers 런타임 테스트
  setup/
  unit/
```

계층 책임, 의존 방향, 새 feature 추가 위치는 [`docs/architecture.md`](docs/architecture.md)에 있습니다.

## API Docs

- OpenAPI JSON: `/api/openapi.json`, `/doc`
- API UI: `/api/docs`, `/ui`

`@hono/zod-openapi` 스키마가 API 문서의 단일 소스입니다.

## Local Development

```bash
pnpm install
pnpm dev
```

`pnpm dev`는 실행 전에 `wrangler d1 migrations apply yonyoung-db --local`을 자동 수행합니다.
기존에 실행 중이던 `wrangler dev`가 있으면 먼저 종료한 뒤 다시 실행하세요.

## Quality Gates

```bash
pnpm quality        # format:check + lint + typecheck
pnpm test
pnpm test:coverage
pnpm test:integration
```

### Test Notes

- Node tests: `src/tests/**/*.test.ts`, `tests/unit/**/*.test.ts`
- Workers runtime tests: `tests/integration/**/*.test.ts` via `@cloudflare/vitest-pool-workers`

## Deployment

```bash
pnpm deploy
```

### Workers Builds troubleshooting

If Cloudflare Workers Builds fails with the message below, the selected build token in the
Cloudflare dashboard is stale and must be replaced in the dashboard settings:

```text
The build token selected for this build has been deleted or rolled and cannot be used for this build.
```

Recovery steps:

1. In Cloudflare Dashboard, open `Workers & Pages` and select the `yonyoung-api` Worker.
2. Open `Settings > Build`.
3. In `API token`, select `Create new token` or choose another active user token.
4. Save the build settings and retry the failed build.

For this repository, the expected Worker name is `yonyoung-api` and the Wrangler configuration
file is at the repository root: `wrangler.jsonc`.

## CI

PR에서 다음 검증이 수행됩니다.

- `pnpm lint`
- `pnpm format:check`
- `pnpm typecheck`
- `pnpm cf-typegen` + `worker-configuration.d.ts` diff 검사
- `pnpm test`
- `pnpm test:coverage`
- `pnpm test:integration`
- `pnpm deploy:dry-run`
- `pnpm security:audit`
