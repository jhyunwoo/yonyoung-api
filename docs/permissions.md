# 권한(RBAC) 정리

연영 홈페이지 API의 역할별 가능/불가능 동작 정리 문서.
소스 오브 트루스는 `src/lib/authorization/policy.ts`(권한 매트릭스)와 각 모듈의 추가 가드이며,
이 문서는 공지·연영장터 기능이 제거된 이후 상태를 기준으로 한다.

## 역할과 서열

역할 문자열은 `src/shared/auth/roles.ts`에서 정규화된다. 알 수 없는 값은 `unverified`로 취급한다.

| 역할                                                 | 설명                   | 서열 |
| ---------------------------------------------------- | ---------------------- | ---- |
| `president`                                          | 회장                   | 4    |
| `vice_president`                                     | 부회장                 | 3    |
| `manager`                                            | 운영진(부장)           | 2    |
| `new_member` / `associate_member` / `regular_member` | 부원 (셋 다 동일 권한) | 1    |
| `unverified`                                         | 미승인 (가입 직후)     | 0    |

- 서열은 `canAssignRole` 판정에 쓰인다: **본인 서열보다 높은 역할을 남에게 부여할 수 없다.**
- 문서에서 "회장단" = president + vice_president, "부원"은 member 계열 3종을 뜻한다.

## 리소스 × 역할 매트릭스 (`policy.ts`)

C=생성, R=조회, U=수정, D=삭제. ✔=가능, ✖=불가.

| 리소스                                      | president | vice_president | manager  | 부원 | unverified |
| ------------------------------------------- | --------- | -------------- | -------- | ---- | ---------- |
| `generation` (기수)                         | CRUD      | CRU / D✖       | R        | R    | ✖          |
| `activity` (활동)                           | CRUD      | CRUD           | CRUD     | R    | ✖          |
| `exhibition` (전시)                         | CRUD      | CRU / D✖       | CRU / D✖ | R    | ✖          |
| `linktree` (링크 모음)                      | CRUD      | CRUD           | CRUD     | R    | ✖          |
| `user` (멤버)                               | CRUD      | CRUD           | R        | R    | ✖          |
| `site_setting` (사이트 설정·후원 자료·모집) | CRUD      | CRUD           | R        | R    | ✖          |

## 라우트별 정리 (모듈 추가 가드 포함)

### 기수 — `/api/generations`

- 목록/상세 조회: `generation.read` — manager 이하 부원까지 가능.
- 생성/수정: 회장단만 (`generation.create/update`).
- **삭제: 회장 전용** (부회장은 `generation.delete` ✖).

### 활동 — `/api/activities`

- CRUD 및 세부 이미지 관리: manager 이상.
- 부원은 조회만 가능.

### 전시 — `/api/exhibitions`

- 생성/수정/세부 이미지: manager 이상.
- **삭제: 회장 전용** (부회장·manager 모두 `exhibition.delete` ✖).

### 링크 모음 — `/api/linktree`

- CRUD: manager 이상. 부원은 조회만.

### 멤버 — `/api/users`

- 목록 조회: 부원은 **본인 1건만** 반환되고, manager 이상은 전체 목록을 본다.
- 상세 조회: manager 이상 전체, 부원은 본인만.
- 수정(`PATCH /users/{id}`):
  - 회장단(`user.update`)은 모든 필드(역할·기수 포함) 수정 가능. 단:
    - 본인보다 높거나 같은 서열의 **다른** 사용자는 수정 불가.
    - 본인 서열보다 높은 역할 부여 불가 (`canAssignRole`).
    - **president가 최소 1명 유지**되어야 한다 (마지막 회장 강등 차단).
  - 부원/manager는 **본인 프로필만** 수정 가능하며, 수정 가능한 필드도 프로필 항목(사진·이름·연락처·협업 여부·개인 링크 등)으로 제한된다.
- 일괄 역할 변경(`PATCH /users/bulk-role`): `user.update` 보유자(회장단)만. 서열·president 최소 1명 규칙 동일 적용.
- 삭제(`DELETE /users/{id}`):
  - 회장단(`user.delete`)은 본인보다 낮은 서열의 사용자 삭제 가능.
  - 부원은 **본인 탈퇴만** 가능.
  - 마지막 president는 삭제 불가.

### 사이트 설정 — `/api/site-settings`

- 조회/수정 모두 회장단 전용 (`site_setting.update` 기준, 공개 조회는 `/api/public/site-settings`).

### 모집 계획 — `/api/recruiting-plan`

- 조회/업서트 모두 회장단 전용. 공개 조회는 `/api/public/recruiting-plan/current`.

### 첨부파일 — `/api/attachments`

scope에 따라 다른 정책 리소스를 따른다 (`src/modules/attachments.ts`):

| scope         | 대상                  | 등록/수정/삭제            | 목록 조회(인증) |
| ------------- | --------------------- | ------------------------- | --------------- |
| `site_donate` | 후원 페이지 회계 자료 | 회장단만 (`site_setting`) | 부원 이상       |
| `activity`    | 활동 페이지 자료      | manager 이상 (`activity`) | 부원 이상       |

- 파일 첨부(fileUrl 세트) 또는 외부 링크(linkUrl) 중 정확히 하나로 등록한다.
- 파일 첨부의 `fileUrl`은 우리 서비스가 발급한 공개 미디어 URL(`/api/public/media/...`, `file` 슬롯)만 허용.
- 공개 목록: `GET /api/public/attachments` — 인증 불필요.

### 업로드(presign) — `/api/*/presign/*`, `/api/*/multipart/*`

해당 리소스의 create/update 권한을 요구한다:

| 경로                                                 | 권한                    | 허용 형식                            |
| ---------------------------------------------------- | ----------------------- | ------------------------------------ |
| `/api/activities/presign/cover·detail` (+multipart)  | manager 이상            | 이미지                               |
| `/api/exhibitions/presign/cover·detail` (+multipart) | manager 이상            | 이미지                               |
| `/api/activities/presign/file`                       | manager 이상            | 문서(pdf/xlsx/xls/docx/hwp/hwpx/zip) |
| `/api/site/presign/file`                             | 회장단                  | 문서(pdf/xlsx/xls/docx/hwp/hwpx/zip) |
| `/api/recruiting/presign/image`                      | 회장단 (`site_setting`) | 이미지                               |
| `/api/users/presign/profile` (+multipart)            | 부원 이상 (본인 프로필) | 이미지                               |

- 멀티파트 part/complete/abort는 **본인이 발급받은 objectKey**에 대해서만 처리된다.
- 모든 업로드는 R2 버킷 10GB 한도 초과가 예상되면 413으로 차단된다.

### 감사 로그 — `/api/audit/{resourceType}/{resourceId}`

- resourceType별로 매핑된 리소스의 `read` 권한을 요구한다
  (예: `activity` 로그는 `activity.read`, `attachment` 로그는 `site_setting.read`).
- 사실상 unverified를 제외한 전원이 조회 가능.

### 대시보드 통계 — `/api/admin/dashboard`, `/api/admin/page-views/*`

- `user.read` 기준 — unverified를 제외한 전원 조회 가능.

### 공개(무인증) — `/api/public/*`

activities, exhibitions, generations, photographers, linktree, site-settings,
recruiting-plan/current, attachments, views(조회수), media(서명된 미디어 파일)
— 전부 인증 없이 조회 가능. 미디어는 HMAC 서명(sig)이 유효해야 한다.

## 프런트엔드 가드 요약 (yonyoung-web)

최종 권한 판정은 항상 API가 수행하고, 웹은 UX 차원의 가드만 둔다:

- `features/auth/server/auth-guard.ts`: 세션 필수 페이지 보호, unverified는 승인 대기 페이지로 유도.
- `features/dashboard/settings/dashboard-settings-menu.ts`: 설정 메뉴 노출 규칙 —
  부원은 "개인 프로필 설정"만, manager 이상은 링크 모음·멤버 관리 추가,
  회장단은 기본 설정·모집 계획·기수 관리까지 노출.
- 서버 액션(`features/dashboard/actions/*`)은 `accessScope`(`manager` | `leadership` | `user_manager`)로
  1차 검증 후 API에 위임한다. 첨부파일은 scope에 따라 `site_donate`→leadership, `activity`→manager.
