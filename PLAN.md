# yonyoung-api Clean Code / Maintainability Refactoring

`yonyoung-api` repository의 전체 코드를 분석하고, 현재 동작과 API 호환성을 보존하면서 코드 품질, 유지보수성, 테스트 가능성, 개발자 가독성을 크게 개선하는 점진적 리팩터링을 수행하라.

이 작업의 목표는 새로운 기능을 추가하거나 프레임워크를 교체하는 것이 아니다.

핵심 목표는 다음과 같다.

1. 코드의 책임과 경계를 명확하게 만든다.
2. feature별 응집도를 높인다.
3. 거대한 God object / God file을 제거한다.
4. HTTP, application logic, persistence, infrastructure의 책임을 분리한다.
5. TypeScript type safety를 강화한다.
6. 반복적인 인증/권한/validation boilerplate를 제거한다.
7. 테스트 가능성과 regression safety를 높인다.
8. 새로운 개발자가 feature 하나를 수정하기 위해 전체 repository를 이해할 필요가 없는 구조를 만든다.
9. Cloudflare Workers/D1/R2 특유의 성능 및 일관성 설계를 보존한다.
10. over-engineering을 피한다.

---

## 0. 매우 중요한 원칙

이번 작업은 "큰 폭의 rewrite"가 아니다.

반드시 기존 behavior를 먼저 이해하고 characterization test로 고정한 뒤 작은 단계로 리팩터링하라.

다음 사항을 임의로 변경하지 마라.

* public API endpoint
* HTTP method
* request format
* response format
* HTTP status code
* OpenAPI contract
* authentication semantics
* Better Auth behavior
* authorization/RBAC semantics
* session semantics
* database schema
* existing migrations
* existing production data assumptions
* soft-delete semantics
* audit log semantics
* public API caching semantics
* R2 URL/object-key semantics
* upload quotas
* upload reservation semantics
* multipart upload lifecycle
* D1 retry/consistency behavior
* security middleware behavior

API 또는 DB schema 변경이 구조적으로 더 좋아 보이더라도 이번 리팩터링에는 포함하지 마라.

필요하다면 TODO 또는 후속 제안으로 남겨라.

dependency upgrade 또한 refactoring과 섞지 마라. 현재 dependency version을 기본적으로 유지한다.

---

# 1. 먼저 repository를 직접 조사하라

수정 전에 repository 전체를 탐색하라.

특히 다음 파일과 관련 코드를 반드시 읽어라.

* `package.json`
* `tsconfig.json`
* `eslint.config.mjs`
* `wrangler.jsonc`
* `vitest.config.ts`
* `vitest.workers.config.ts`
* `.github/workflows/ci.yml`
* `README.md`
* `src/index.ts`
* `src/app/createApp.ts`
* `src/routes/index.ts`
* `src/bindings/types.ts`
* `src/lib/services/types.ts`
* `src/lib/services/dependencies.ts`
* `src/lib/services/db-service.ts`
* `src/lib/openapi/schemas.ts`
* `src/lib/openapi/descriptions.ts`
* `src/lib/db/schema.ts`
* `src/lib/http/authz.ts`
* 모든 `src/modules/*.ts`
* 모든 `src/tests/**/*.test.ts`
* 모든 `tests/unit/**/*.test.ts`
* 모든 `tests/integration/**/*.test.ts`

repository의 import graph와 feature dependency를 파악하라.

기존 architecture가 의도적으로 해결하고 있는 Cloudflare/D1 제약도 파악하라.

특히 다음 코드를 단순화한다는 이유로 제거하지 마라.

* D1 parameter chunking
* D1 retry
* D1 sequential session / consistency handling
* R2 usage caching
* upload reservation
* multipart state handling
* public API caching
* request/correlation ID
* security headers
* CSRF
* CORS
* audit logging
* soft delete
* health/readiness checks

---

# 2. baseline을 먼저 확인하라

변경하기 전에 가능한 모든 기존 quality gate를 실행하라.

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm test:integration
pnpm deploy:dry-run
pnpm security:audit
```

script 이름이나 환경 문제로 특정 명령을 그대로 실행할 수 없다면 `package.json`을 확인해 올바른 명령을 사용하라.

baseline에서 이미 실패하는 항목이 있다면 그것을 명확히 기록하고 리팩터링으로 인해 생긴 실패와 구분하라.

가능하면 기존 generated OpenAPI document를 snapshot 또는 equivalent test로 고정하여 리팩터링 전후 API contract가 변하지 않는지 검증하라.

---

# 3. 현재 확인해야 할 주요 code smell

다음 문제를 repository에서 직접 검증한 뒤 해결하라.

## A. God DataService

현재 `src/lib/services/types.ts`의 `DataService`가 audit, generation, activity, exhibition, linktree, attachment, settings, recruiting, user, dashboard, page-view 등 서로 다른 기능을 모두 소유한다.

`src/lib/services/db-service.ts` 또한 매우 큰 중앙 persistence implementation이다.

이를 한 번에 rewrite하지 마라.

feature를 하나씩 migration하는 strangler 방식으로 분해하라.

예상되는 cohesive persistence capability는 다음과 같다.

```text
ActivityRepository
ExhibitionRepository
GenerationRepository
LinktreeRepository
AttachmentRepository
UserRepository
AuditRepository
SiteSettingsRepository
RecruitingPlanRepository
DashboardReadRepository
```

하지만 모든 repository에 무조건 interface를 만드는 것은 금지한다.

다음 조건 중 하나가 있을 때만 abstraction/interface를 만들어라.

* infrastructure boundary
* test seam
* 여러 implementation이 존재하거나 존재할 합리적 가능성
* 실제로 dependency inversion의 이점이 있는 경우

interface 하나 + implementation 하나를 기계적으로 만드는 ceremonial architecture를 피하라.

---

# 4. Vertical Slice Architecture를 기본 방향으로 사용하라

거대한 horizontal `lib` 계층보다 feature가 자신의 관련 코드를 가까이 소유하도록 만들어라.

대략적인 목표는 다음과 같다.

```text
src/
  app/
    create-app.ts
    middleware/
    system/

  features/
    activities/
    exhibitions/
    generations/
    users/
    linktree/
    attachments/
    recruiting-plan/
    site-settings/
    dashboard/
    page-views/
    uploads/

  platform/
    auth/
    db/
    storage/
    cache/
    observability/
    config/

  shared/
    errors/
    http/
    validation/
    types/
```

이 디렉터리 구조를 무조건 문자 그대로 복사하지는 마라.

현재 repository에 가장 자연스러운 최소 구조를 선택하라.

폴더 수를 늘리는 것이 목적이 아니다.

핵심은 다음 dependency direction이다.

```text
HTTP route
    ↓
feature/application operation
    ↓
persistence/infrastructure abstraction
    ↓
Drizzle / D1 / R2 / Better Auth / Cloudflare
```

feature A가 feature B의 내부 파일을 임의로 import하지 않도록 하라.

공유해야 하는 개념은 의도를 검토한 뒤 explicit public API 또는 truly shared module로 추출하라.

---

# 5. 첫 migration feature는 Activities로 하라

`uploads`가 가장 복잡한 feature 중 하나이지만 첫 migration 대상으로 삼지 마라.

먼저 `activities`를 reference implementation으로 만든다.

Activities 변경 전에 현재 동작을 characterization test로 충분히 보호하라.

최소한 다음 동작을 확인하라.

* activity list
* generation filtering
* activity detail
* create
* update
* delete
* detail image create
* detail image update
* detail image delete
* batch image create
* batch image update
* unauthenticated request
* permission denied request
* invalid params
* invalid query
* invalid body
* missing resource
* rich text sanitization
* empty sanitized rich text rejection
* audit log
* updatedBy
* soft-delete behavior

그 후 Activities를 다음 책임으로 분리하라.

```text
contract
route
application/service
persistence
mapping
```

단순한 경우 handler/controller 파일을 별도로 만들 필요는 없다.

`activity.routes.ts`가 충분히 작고 명확하다면 route handler를 그 안에 두어도 된다.

---

# 6. Route handler를 얇게 만들어라

현재 route handler 안에 authentication, authorization, validation, sanitization, business rule, DB coordination, audit logging, response mapping이 동시에 존재하는 경우가 있다.

최종 handler는 가능한 한 다음 정도의 abstraction level이어야 한다.

```ts
const input = c.req.valid("json");
const actor = c.get("actor");

const activity = await activityService.create({
  actor,
  input,
});

return ok(c, activity, 201);
```

정확한 syntax는 현재 Hono/OpenAPI typing에 맞게 구현하라.

route layer가 담당할 것:

* HTTP contract
* validated input 읽기
* HTTP-specific metadata
* application operation 호출
* response serialization

application layer가 담당할 것:

* business invariant
* resource coordination
* sanitization if business relevant
* audit coordination
* meaningful application errors

persistence layer가 담당할 것:

* Drizzle/D1 query
* row mapping
* persistence-specific optimization

---

# 7. validation path를 하나로 통일하라

`@hono/zod-openapi` route contract가 이미 request schema를 검증하는 경우 동일 데이터를 다시 `safeParse`, `parseBody`, `parseParams` 등으로 검증하지 마라.

가능한 경우:

```ts
c.req.valid("json")
c.req.valid("query")
c.req.valid("param")
```

을 사용하라.

validation error format은 application-wide OpenAPI/Hono validation hook에서 일관되게 처리하라.

단, schema validation과 business validation을 구분하라.

예:

```text
타입/형식/필수 필드       → Zod
resource 존재 여부        → application
권한                      → authorization
sanitize 후 실제 내용 여부 → application/domain invariant
```

기존 error message 및 HTTP response contract가 변경되지 않도록 테스트하라.

---

# 8. Authentication / Authorization boilerplate를 줄여라

현재 반복되는 다음 패턴을 조사하라.

```ts
const actorResult = await requireActor(...);

if ("response" in actorResult) {
  return actorResult.response;
}

const denied = requirePermission(...);

if (denied) {
  return denied;
}
```

Hono middleware 또는 typed route guard를 이용하여 다음과 같이 의도가 route declaration 근처에서 드러나는 구조를 검토하라.

```ts
requirePermission("activity", "create")
```

handler에서는 가능하면:

```ts
const actor = c.get("actor");
```

처럼 이미 검증된 actor를 가져오게 하라.

기존 `can()` authorization policy와 RBAC model 자체는 유지한다.

authorization logic을 여러 middleware에 중복시키지 마라.

---

# 9. AppDependencies를 feature-specific dependency로 분해하라

현재 하나의 큰 `AppDependencies`가 모든 service/store를 노출하는 구조를 점진적으로 축소하라.

예를 들어 Activity feature가 실제로 필요한 것이:

```ts
type ActivityDependencies = {
  activities: ActivityRepository;
  audit: AuditWriter;
};
```

뿐이라면 feature에 전체 application dependency bag을 전달하지 마라.

Upload는 별도의 dependency contract를 사용한다.

composition root에서 실제 Cloudflare/D1/R2 adapter를 조립하라.

단, 전체 repository를 한 번에 변경하지 말고 feature migration과 함께 진행하라.

migration 중 compatibility adapter를 잠시 유지하는 것은 허용한다.

---

# 10. `createApp()`을 composition root로 단순화하라

현재 `createApp()`에서 다음 책임을 분리하라.

* health schemas
* health routes
* status routes
* readiness routes
* response timing middleware
* middleware registration
* feature route registration

최종적으로 `createApp()`을 읽었을 때 application topology가 보이고 세부 구현은 숨겨져야 한다.

예:

```ts
export const createApp = (...) => {
  const app = createOpenApiApp();

  registerMiddleware(app, ...);
  registerSystemRoutes(app, ...);
  registerFeatureRoutes(app, ...);
  registerErrorHandling(app);

  return app;
};
```

정확한 naming은 repository convention에 맞춰라.

---

# 11. OpenAPI schema를 feature-local로 이동하라

현재 중앙 `src/lib/openapi/schemas.ts`와 description 관련 거대 파일을 점진적으로 분해하라.

각 feature가 자신의 API contract를 소유하도록 하라.

예:

```text
features/activities/activity.contract.ts
features/exhibitions/exhibition.contract.ts
features/users/user.contract.ts
```

공통 contract만 shared location에 남겨라.

예:

* standard error response
* UUID parameter
* pagination
* truly shared primitives

Zod/OpenAPI schema를 API contract의 source of truth로 유지하라.

별도 DTO class 또는 다른 validation framework를 추가하지 마라.

동일한 정보를 여러 schema/type에 복제하지 마라.

가능하면 Zod에서 타입을 infer하라.

---

# 12. TypeScript type safety를 강화하라

현재 TypeScript `strict` 설정을 유지하고 더 잘 활용하라.

`Promise<any>`와 불필요한 explicit `any`를 제거하라.

불명확한 타입을 `any`로 해결하지 말고 실제 boundary를 모델링하라.

단, 외부 library의 type limitation으로 unavoidable한 경우:

1. 가장 좁은 scope에서 사용하고
2. 이유를 설명하고
3. validation 또는 type guard로 boundary를 보호하라.

가능한 경우 `unknown` + narrowing을 사용하라.

불필요한 type assertion과 double cast:

```ts
as unknown as X
```

를 피하라.

type-only import를 일관되게 사용하라.

---

# 13. ESLint에 type-aware linting을 도입하라

현재 installed `typescript-eslint` 버전과 현재 config를 확인하고 Flat Config 방식으로 type-aware linting을 구성하라.

기본적으로 `recommendedTypeChecked` 수준을 먼저 적용하라.

다음 rule을 특히 검토하라.

```text
@typescript-eslint/no-floating-promises
@typescript-eslint/no-misused-promises
@typescript-eslint/await-thenable
@typescript-eslint/consistent-type-imports
@typescript-eslint/switch-exhaustiveness-check
@typescript-eslint/no-explicit-any
```

한 번에 `strictTypeChecked` 전체를 적용하여 수백 개의 mechanical change를 만드는 것은 피하라.

각 rule을 켠 이유가 코드 correctness 또는 maintainability에 연결되어야 한다.

Cloudflare Worker에서 Promise는 반드시:

* await
* return
* intentional `void` with justification
* ExecutionContext.waitUntil

중 하나로 명확하게 처리하라.

---

# 14. formatter를 명확히 하라

현재 repository에 canonical formatter가 없다면 Prettier 또는 repository에 적절한 equivalent formatter를 도입하는 것을 검토하라.

formatting과 semantic linting 역할을 분리하라.

다음 script 형태를 제공하는 것이 좋다.

```text
format
format:check
lint
typecheck
quality
```

`quality`는 적절한 static verification을 묶는다.

CI에도 format check가 필요하면 추가하라.

기존 file 전체를 무의미하게 한 번에 reformat하여 git history를 파괴하지 않도록 변경 전략을 세워라.

---

# 15. 의미 없는 JSDoc을 제거하라

다음 종류의 자동 생성된 것처럼 보이는 JSDoc은 제거하라.

```text
X의 핵심 비즈니스 로직을 수행합니다.
input은 함수 로직에서 사용하는 입력값입니다.
함수 실행 결과를 반환합니다.
```

코드에서 바로 읽을 수 있는 내용을 주석으로 반복하지 마라.

다음 종류의 comment는 유지하거나 개선하라.

* D1 limits
* cache correctness reason
* security invariant
* consistency assumption
* backward compatibility reason
* non-obvious performance optimization
* workaround and its removal condition

comment는 "what"보다 "why"를 설명해야 한다.

---

# 16. Cloudflare-specific behavior를 보존하라

이 프로젝트를 일반 Node.js backend처럼 리팩터링하지 마라.

Cloudflare Workers execution model을 고려하라.

특히:

* request-specific mutable state를 module global에 넣지 마라.
* floating Promise를 만들지 마라.
* post-response non-critical work가 있다면 `waitUntil()`이 실제로 적절한지 판단하라.
* D1/R2/KV binding을 불필요한 REST call로 대체하지 마라.
* generated Wrangler bindings를 source of truth로 유지하라.
* WorkerEntrypoint semantics를 보존하라.
* public API caching entrypoint를 깨지 마라.
* request/correlation ID propagation을 보존하라.

현재 `src/index.ts`의 cached public entrypoint와 authenticated routes 분리는 정확한 동작을 characterization test로 보호한 뒤에만 수정하라.

---

# 17. production binding 타입을 검토하라

현재 `CloudflareBindings` 위에 많은 runtime binding을 optional override하는 구조를 검토하라.

production binding과 test/legacy override를 구분할 수 있다면 분리하여 실제 production code의 compile-time guarantee를 높여라.

예를 들어 `DB`/`db`, `R2`/`r2`처럼 legacy alias가 실제로 필요한지 usage를 전수 조사하라.

더 이상 필요하지 않은 alias는 테스트와 import를 migration한 뒤 제거하라.

단, secret/env가 Wrangler generated type에서 어떻게 표현되는지 실제 generated file과 config를 먼저 확인하라.

추측해서 required type으로 바꾸지 마라.

---

# 18. D1-specific optimization을 보존하라

D1의 bound parameter limit 때문에 존재하는 chunking 등 기존 workaround를 제거하지 마라.

현재 코드의 query batching, retry, sequential session, consistency 설정이 왜 존재하는지 먼저 확인하라.

다중 write가 하나의 logical operation이라면 atomicity를 검토하라.

예:

```text
parent soft delete
+
children soft delete
```

단, 일반 SQL database의 API를 가정하여 무조건 `db.transaction()`을 사용하지 마라.

현재 Cloudflare D1 / Drizzle driver에서 지원되는 batch/atomicity API를 확인한 뒤 적용하라.

network round trip을 늘리는 repository abstraction을 만들지 마라.

"깨끗한 코드"를 위해 D1 성능을 희생하지 마라.

---

# 19. Database schema organization

현재 큰 DB schema 파일은 필요하다면 domain별 파일로 분리하라.

예:

```text
platform/db/schema/
  auth.ts
  generations.ts
  activities.ts
  exhibitions.ts
  users.ts
  linktree.ts
  attachments.ts
  audit.ts
  analytics.ts
  index.ts
```

이번 작업에서는 schema organization만 변경하고 actual migration/schema change는 하지 마라.

Drizzle metadata와 migration output에 예상치 못한 변화가 없는지 반드시 확인하라.

---

# 20. repository hygiene

git tree를 확인하여 generated artifact와 IDE-specific file이 tracking되고 있다면 정리하라.

특히:

```text
coverage/
.idea/
```

를 조사하라.

적절하면 `.gitignore`에 추가하고 tracked generated artifact를 제거하라.

단, `worker-configuration.d.ts`는 CI에서 Wrangler-generated contract를 검증하는 용도로 의도적으로 tracking되고 있으므로 임의로 제거하지 마라.

---

# 21. legacy re-export cleanup

`src/middlewares/*`처럼 canonical implementation을 단순 re-export하는 compatibility file을 조사하라.

모든 internal import가 canonical path를 사용하도록 migration한 뒤 더 이상 필요 없는 wrapper를 제거하라.

단순 public barrel 역할이 명확한 file은 유지할 수 있다.

모든 barrel file을 무조건 제거하지 마라.

---

# 22. 테스트 구조를 개선하라

현재 다음 위치를 모두 조사하라.

```text
src/tests/
tests/unit/
tests/integration/
```

중복된 fixture/setup/helper를 찾아라.

테스트를 다음과 같이 정리하는 방안을 적용하라.

```text
tests/
  unit/
  integration/
  fixtures/
  builders/
```

또는 feature-local unit test + top-level integration test를 사용할 수 있다.

repository에 가장 자연스러운 convention 하나를 선택해 문서화하라.

다음과 같은 reusable test builder/factory를 검토하라.

```text
createActor
createUser
createActivity
createExhibition
createAuthenticatedRequest
createMockRepository
```

거대한 test file을 behavior별로 분리하라.

테스트 파일을 단순히 production file과 동일한 크기의 또 다른 God file로 만들지 마라.

---

# 23. coverage를 실질적인 regression gate로 만들어라

현재 coverage exclude 목록을 검토하라.

특히 이번 리팩터링의 핵심 대상인 persistence/application code가 coverage에서 제외되어 있다면 feature migration과 함께 coverage 대상으로 점진적으로 포함하라.

무조건 전체 repository 100% coverage를 목표로 하지 마라.

다음에 더 높은 우선순위를 둬라.

* authorization
* application business rules
* audit behavior
* upload reservation
* multipart state transition
* storage quota
* cache correctness
* D1 failure handling
* security-sensitive paths

단순 schema declaration이나 trivial mapper 때문에 의미 없는 test를 만들지 마라.

---

# 24. Uploads는 마지막 주요 migration으로 진행하라

`uploads.ts`는 가장 위험도가 높은 파일 중 하나다.

Activities/Exhibitions 등에서 target architecture를 먼저 검증한 뒤 진행하라.

다음 책임을 명확하게 분리하는 것을 목표로 한다.

```text
upload contract
upload authorization/policy
payload validation
storage capacity
reservation
single upload grant
multipart initiation
multipart part URL
multipart completion
multipart abort
reservation settlement/release
HTTP routes
```

가능하면 upload lifecycle/state transition이 코드에서 명확하게 드러나도록 한다.

그러나 state machine framework 같은 새로운 dependency는 실제 필요가 없다면 추가하지 마라.

현재 upload semantics를 characterization test로 먼저 잠근다.

---

# 25. observability

기존 request ID, correlation ID, structured logger, timing 정보를 유지하라.

`createApp.ts` 안의 anonymous timing middleware가 있다면 named middleware로 추출하여 의미를 명확히 하라.

현재 Wrangler observability config와 Cloudflare Workers logging/tracing 기능을 확인하라.

추가 observability 개선이 architecture refactor와 독립적이라면 별도 후속 작업으로 남겨도 된다.

리팩터링 과정에서 logging field 이름이나 log correlation semantics를 임의로 바꾸지 마라.

---

# 26. over-engineering 방지 규칙

다음 행동을 하지 마라.

* 모든 function을 class로 만들기
* 모든 repository에 interface 만들기
* 모든 feature에 controller/service/repository/entity/DTO를 기계적으로 만들기
* 단순 CRUD에 복잡한 DDD aggregate 도입
* CQRS framework 도입
* event bus 도입
* 새로운 DI container 도입
* 새로운 ORM 도입
* 새로운 web framework 도입
* 무의미한 wrapper function 추가
* 한 줄짜리 function을 이유 없이 여러 계층으로 감싸기
* 파일 line count만 줄이기 위해 응집된 코드를 임의 분할하기
* premature generic abstraction
* Activity와 Exhibition이 비슷하다는 이유만으로 너무 일찍 generic CRUD framework 만들기

Rule of Three를 적용하라.

두 feature가 비슷해 보여도 실제 세 번째 사용 사례가 나타나기 전에는 지나치게 generic한 abstraction을 만들지 마라.

가독성이 abstraction 수보다 중요하다.

---

# 27. naming 원칙

다음 이름을 피하라.

```text
utils
helpers
manager
common
misc
handleData
processData
doSomething
service (책임이 모호한 경우)
```

가능한 한 domain intent가 드러나도록 이름을 사용하라.

예:

```text
reserveUploadCapacity
sanitizeActivityDescription
findLatestAuditActors
ActivityRepository
UploadReservationStore
```

boolean은 가능하면 질문처럼 읽히게 한다.

```text
is...
has...
can...
should...
```

---

# 28. 함수 설계 원칙

함수를 무조건 특정 line 이하로 자르지 마라.

대신 다음 기준으로 분리하라.

* abstraction level이 바뀌는가?
* 변경 이유가 다른가?
* 이름을 붙이면 domain intent가 명확해지는가?
* 독립적으로 테스트할 가치가 있는가?
* 반복되는 invariant인가?

함수 parameter가 너무 많다면 단순히 parameter object로 숨기기 전에 책임이 너무 많은지 먼저 검토하라.

---

# 29. error handling

현재 standard error envelope와 AppError/error handler 구조를 먼저 이해하라.

business/application error와 HTTP response 생성을 가능한 한 분리하되 기존 API contract는 유지하라.

catch-all `catch {}`가 실제로 fail-closed semantics를 위한 것인지 확인하라.

security-sensitive fail-closed behavior는 유지하라.

에러를 조용히 삼키는 것이 deliberate best-effort operation이라면 코드에서 그 이유가 명확해야 한다.

---

# 30. 리팩터링 순서

다음 순서를 기본으로 사용하되 repository 조사 결과에 따라 작은 조정은 허용한다.

### Phase 0

Baseline + characterization

### Phase 1

Repository hygiene + formatter + type-aware lint

### Phase 2

App composition / middleware / system routes cleanup

### Phase 3

Activities characterization tests

### Phase 4

Activities vertical slice migration

### Phase 5

Exhibitions migration

### Phase 6

Generations / Linktree / Attachments migration

### Phase 7

Users / Site Settings / Recruiting / Dashboard migration

### Phase 8

DataService compatibility layer removal

### Phase 9

OpenAPI contract localization

### Phase 10

Uploads characterization + migration

### Phase 11

DB schema organization / D1 atomicity review

### Phase 12

Test organization + coverage improvement

### Phase 13

Architecture/documentation cleanup

큰 phase 하나를 giant patch로 만들지 마라.

가능하면 하나의 logically-reviewable change 단위로 작업하라.

---

# 31. 각 단계마다 반드시 검증하라

각 meaningful phase 후 최소:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

를 실행하라.

Cloudflare/D1/R2 관련 구조를 변경했다면:

```bash
pnpm test:integration
pnpm deploy:dry-run
```

도 실행하라.

최종적으로 가능한 모든 quality gate를 다시 실행하라.

테스트를 통과시키기 위해 기존 expected behavior를 임의로 수정하지 마라.

리팩터링 때문에 기존 test가 실패했다면 우선 implementation을 수정하라.

test expectation 변경이 필요한 경우 왜 기존 test가 architecture detail을 잘못 고정하고 있었는지 명확한 근거가 있어야 한다.

---

# 32. OpenAPI regression 검증

리팩터링 전후 generated OpenAPI 결과를 비교하라.

다음 변경이 의도치 않게 발생하지 않았는지 확인하라.

* path
* method
* operationId
* tags
* security declarations
* params
* query
* request body
* response status
* response schema
* schema names
* required/optional
* nullable
* enum
* examples/descriptions 중 client contract에 영향을 줄 수 있는 항목

구조 리팩터링만으로 API contract diff가 발생해서는 안 된다.

---

# 33. 최종 architecture documentation

작업 후 README 또는 `docs/architecture.md`에 최소 다음을 기록하라.

## Architecture overview

```text
request
→ Hono middleware
→ feature route
→ application operation
→ persistence/infrastructure
→ Cloudflare binding
```

## Directory ownership

각 top-level directory가 무엇을 소유하는지 설명한다.

## Dependency rules

어느 계층이 어느 계층을 import할 수 있는지 설명한다.

## Adding a new feature

새 feature를 추가할 때 어디에:

* contract
* route
* business logic
* persistence
* tests

를 추가해야 하는지 짧게 설명한다.

문서는 현재 코드와 일치해야 한다.

미래의 이상적인 architecture를 문서화하지 마라.

---

# 34. 완료 조건

다음 조건을 모두 만족해야 한다.

## Correctness

* 기존 API behavior 유지
* 기존 OpenAPI contract 유지
* DB schema/migration unintended diff 없음
* auth/RBAC behavior 유지
* upload behavior 유지
* caching behavior 유지

## Type safety

* TypeScript strict 유지
* 새로운 `any` 추가 금지
* 기존 avoidable `Promise<any>` 제거
* typed linting 적용
* floating Promise 없음

## Architecture

* `DataService` God object 제거 또는 상당 부분 strangled
* giant `db-service.ts`가 feature persistence로 분해
* giant OpenAPI schema가 feature-local contract로 분해
* feature가 필요한 dependency만 명시
* `createApp`이 composition root 역할에 집중
* route handlers가 얇아짐
* application rules가 HTTP에서 분리됨
* canonical imports가 명확함

## Maintainability

* meaningless JSDoc 제거
* important invariant comments 유지
* generated artifacts/IDE metadata 정리
* test helpers/builders 정리
* architecture documentation 추가

## Verification

최종적으로 가능한 모든 명령이 성공해야 한다.

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm test:integration
pnpm cf-typegen
git diff --exit-code -- worker-configuration.d.ts
pnpm deploy:dry-run
pnpm security:audit
```

---

# 35. 작업 방식

코드를 수정하기 전에 간단한 repository audit 결과와 migration plan을 먼저 작성하라.

그 후 실제 수정 작업을 수행하라.

각 단계에서:

1. 어떤 smell/problem을 해결하는지
2. 왜 이 구조가 더 나은지
3. 어떤 기존 behavior를 보호해야 하는지
4. 어떤 테스트로 regression을 막는지

를 명확히 판단하라.

파일을 옮기거나 이름만 바꾸는 cosmetic refactor보다 dependency와 responsibility 개선을 우선하라.

기존 코드에 이미 좋은 abstraction이 있다면 재작성하지 말고 재사용하라.

---

# 36. 최종 보고 형식

작업 완료 후 다음 내용을 보고하라.

## 1. Initial findings

repository에서 실제로 발견한 architecture/code quality 문제

## 2. Changes made

구조별 변경 사항

## 3. Architecture before / after

간단한 dependency diagram 포함

## 4. Removed technical debt

제거한 God objects, duplication, unsafe types, legacy wrappers 등

## 5. Preserved invariants

Cloudflare/D1/Auth/Upload/API에서 의도적으로 유지한 동작

## 6. Tests added

새 characterization/unit/integration tests

## 7. Verification

실행한 명령과 각각의 결과

## 8. Remaining debt

이번 작업에서 의도적으로 건드리지 않은 사항

## 9. Recommended follow-up

다음 PR로 분리하는 것이 더 좋은 개선사항

---

가장 중요한 기준은 다음 한 문장이다.

**코드 줄 수나 파일 수를 줄이는 것이 아니라, 개발자가 하나의 기능을 수정할 때 알아야 하는 문맥의 범위를 줄여라.**

그리고 모든 구조 개선보다 production behavior 보존을 우선하라.
