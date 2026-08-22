# yonyoung-api Architecture

## 요청 흐름

```text
Request
  → Hono middleware (requestId → logger → response timing → CORS → CSRF → security headers → session)
  → feature route (HTTP 계약 · 검증된 입력 읽기 · 응답 직렬화)
  → application 규칙 (권한 · sanitize · 감사 로그 · 도메인 불변식)
  → feature repository (Drizzle 쿼리 · row 매핑)
  → Cloudflare binding (D1 / R2 / KV / Durable Object)
```

`/api/public/*`의 GET/HEAD는 `src/index.ts`에서 별도의 `PublicApi` WorkerEntrypoint로 넘어간다.
Wrangler가 그 클래스에만 Workers Caching을 켜 두므로, 인증이 필요한 라우트는 캐시 조회 비용도
치르지 않고 캐시에 저장될 위험도 없다. 이 분리는 성능이 아니라 **보안 경계**다.

## 디렉터리 소유권

| 경로                     | 소유하는 것                                                                                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/`               | 애플리케이션 조립. `createApp.ts`(composition root), `middleware/`, `system/`(health·status·readiness), `docs/`(OpenAPI 문서 라우트)            |
| `src/features/<domain>/` | 한 도메인의 세로 단면: `*.contract.ts`(Zod/OpenAPI), `*.routes.ts`(HTTP), `*.repository.ts`(영속화), 도메인 정책·상태 전이 파일                 |
| `src/platform/`          | 인프라 어댑터와 그 위의 얇은 도우미. `db/schema/`(Drizzle 스키마), `db/data-service-composition.ts`, `db/query-chunking.ts`, `db/row-values.ts` |
| `src/shared/`            | 도메인이 없는 공용 요소. `errors/`, `http/`(라우트 가드·검증 입력 읽기), `openapi/`(공통 필드/스키마), `auth/`, `logging/`                      |
| `src/lib/`               | 아직 feature로 옮기지 않은 가로 계층(스토리지 presign, 업로드 상태 저장소, 헬스체크, 캐시, 권한 정책 등)                                        |
| `src/routes/index.ts`    | feature 라우터를 앱에 마운트하는 곳                                                                                                             |
| `src/tests/`             | Node 환경 단위·라우트 테스트, 공유 빌더(`test-helpers.ts`, `support/`)                                                                          |
| `tests/integration/`     | 실제 Workers 런타임(`@cloudflare/vitest-pool-workers`) 테스트                                                                                   |

## 의존 방향

```text
app  →  features  →  platform / shared / lib
                 ↘
                   shared
```

- `features/<a>`는 `features/<b>`의 **내부** 파일을 import 하지 않는다.
  공유가 필요하면 `shared/` 또는 `platform/`으로 올린다.
  예외는 명시적으로 공개된 두 지점뿐이다.
  - `features/audit/audit.repository.ts`의 `listLatestAuditActorsByResourceId`
    — 모든 도메인 목록 응답의 `updatedBy`가 이 결과를 쓴다.
  - `features/<x>/<x>.contract.ts`가 export 하는 스키마 — 공개된 API 계약이다.
- `platform/`과 `shared/`는 `features/`를 import 하지 않는다.
  (`platform/db/data-service-composition.ts`는 예외 — 이름 그대로 조립만 하는 composition root다.)

## 계층별 책임

### route (`features/<domain>/<domain>.routes.ts`)

- `createRoute`로 HTTP 계약을 선언한다.
- 입력은 `readValidated(c, "json" | "param" | "query", <스키마>)`로 읽는다.
  라우트 계약이 이미 검증했으므로 핸들러에서 다시 `safeParse` 하지 않는다.
- 인증/권한은 `requireAuthenticatedActor` / `assertPermission`으로 처리한다.
- 실패는 `throw AppError.*`로 알린다. 전역 `errorHandler`가 표준 에러 봉투로 직렬화한다.

### application 규칙

sanitize, 도메인 불변식(예: "sanitize 후에도 내용이 남아 있어야 한다"), 감사 로그 기록처럼
HTTP와 무관한 판단은 route 파일 안의 이름 붙은 헬퍼나 별도 정책 파일이 가진다.
`features/uploads/upload.policy.ts`, `features/uploads/multipart-upload.ts`가 그 예다.

### repository (`features/<domain>/<domain>.repository.ts`)

- Drizzle 쿼리와 row → entity 매핑만 담당한다.
- D1 제약을 흡수한다: `selectInChunks`(바인딩 파라미터 100개 한도), 일괄 삽입의 `database.batch`,
  레거시 컬럼 폴백.
- HTTP를 모른다. "없음"은 `null`/`false`로 돌려주고 상태 코드 판단은 route가 한다.

## 새 feature 추가하기

`src/features/<domain>/`에 다음을 만든다.

| 무엇을                    | 어디에                                                                                        |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| Zod/OpenAPI 스키마        | `<domain>.contract.ts` (공통 파라미터는 `shared/openapi/common.contract.ts` 재사용)           |
| 라우트 + 핸들러           | `<domain>.routes.ts`                                                                          |
| 도메인 규칙/상태 전이     | `<domain>.policy.ts` 등 의도가 드러나는 이름의 파일                                           |
| DB 접근                   | `<domain>.repository.ts`                                                                      |
| 테이블 정의               | `src/platform/db/schema/<domain>.ts` + `schema/index.ts`에 re-export                          |
| 라우터 등록               | `src/routes/index.ts`                                                                         |
| DataService 노출(필요 시) | `src/platform/db/data-service-composition.ts`                                                 |
| 테스트                    | 라우트: `src/tests/<domain>.routes.test.ts` · 영속화: `src/tests/<domain>.repository.test.ts` |

## 회귀 가드

- `src/tests/openapi-contract.snapshot.test.ts`
  — 89개 오퍼레이션의 path/method/operationId/tags/security/params/body/response와 component
  스키마 이름을 스냅샷으로 고정한다. 구조 리팩터링만으로 이 스냅샷이 바뀌면 안 된다.
- `src/tests/d1-query-safety.test.ts`
  — `src/` 전체에서 원시 D1 SQL에 런타임 값을 보간하지 않는지 전수 검사한다.
  가변 개수 바인딩 자리표시자(`${placeholders}`)만 예외로 허용한다.
- `pnpm db:generate`가 "No schema changes"를 내는지 확인하면 스키마 파일 재배치가
  마이그레이션에 영향을 주지 않았음을 보장할 수 있다.

## feature 별 dependency

각 `register*Routes` 는 애플리케이션 전체 `AppDependencies` 대신 자기가 실제로 쓰는
것만 `Pick` 한 타입을 받는다(예: `ActivityRouteDependencies = Pick<AppDependencies,
"resolveActor" | "getDataService">`). composition root 는 같은 객체를 그대로 넘기지만,
파일을 열면 그 feature 가 무엇에 의존하는지 선언부만 보고 알 수 있고 새 의존이
소리 없이 늘어나면 컴파일이 막는다.

## 남아 있는 호환 계층

`DataService`(`src/lib/services/types.ts`)는 아직 모든 도메인의 영속화 메서드를 한 타입으로
노출한다. 구현은 이미 feature repository로 전부 옮겨졌고, `data-service-composition.ts`는
그것들을 이 파사드로 조립하기만 한다. route가 필요한 repository만 직접 주입받도록 바뀌는
만큼 이 파사드는 얇아지고, 최종적으로는 사라진다.
