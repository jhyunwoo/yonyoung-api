# 조회수 API 문서

> 홈페이지 게시물(활동·전시)의 조회수를 기록하고 조회하기 위한 Public API 명세입니다.

---

## 기본 정보

| 항목 | 값 |
|------|-----|
| Base URL | `https://yonyoung.yonsei.ac.kr` |
| 인증 | **불필요** (Public API) |
| Content-Type | `application/json` |

---

## 1. 조회수 기록

사용자가 게시물 상세 페이지에 진입할 때 호출하여 조회수를 1 증가시킵니다.

### 요청

```
POST /api/public/views
```

#### Headers

| 이름 | 값 | 필수 |
|------|-----|------|
| `Content-Type` | `application/json` | ✅ |

#### Request Body

```json
{
  "resourceType": "activity",
  "resourceId": "20000000-0000-4000-8000-000000000001"
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `resourceType` | `string` | ✅ | 리소스 타입. `"activity"` 또는 `"exhibition"` 중 하나 |
| `resourceId` | `string` (UUID) | ✅ | 조회수를 기록할 리소스의 UUID |

### 응답

#### 성공 — `204 No Content`

본문 없음. 서버가 D1 `view_counts` 테이블에 조회수를 기록한 뒤 응답합니다.

#### 실패 — `400 Bad Request`

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "잘못된 요청입니다.",
    "requestId": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```

### 사용 예시

#### JavaScript (fetch)

```javascript
// 활동 상세 페이지 진입 시
await fetch("https://yonyoung.yonsei.ac.kr/api/public/views", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    resourceType: "activity",
    resourceId: "20000000-0000-4000-8000-000000000001",
  }),
});
```

#### React / Next.js 예시

```tsx
useEffect(() => {
  // 페이지 진입 시 조회수 기록
  void fetch("/api/public/views", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      resourceType: "activity",  // 또는 "exhibition"
      resourceId: activity.id,
    }),
  }).catch(() => {
    // 조회수 기록 실패는 무시
  });
}, [activity.id]);
```

---

## 2. 조회수 조회

여러 게시물의 조회수를 한 번에 조회합니다. 목록 페이지에서 각 카드에 조회수를 표시할 때 사용합니다.

### 요청

```
GET /api/public/views?resourceType={type}&resourceIds={id1},{id2},{id3}
```

#### Query Parameters

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `resourceType` | `string` | ✅ | 리소스 타입. `"activity"` 또는 `"exhibition"` |
| `resourceIds` | `string` | ✅ | 쉼표(`,`)로 구분된 리소스 UUID 목록. 최대 **100개** |

### 응답

#### 성공 — `200 OK`

```json
{
  "data": {
    "20000000-0000-4000-8000-000000000001": 42,
    "20000000-0000-4000-8000-000000000002": 15,
    "20000000-0000-4000-8000-000000000003": 0
  }
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `data` | `Record<string, number>` | 리소스 ID를 키, 누적 조회수를 값으로 하는 객체. 요청한 모든 ID가 포함되며 조회수가 없는 경우 `0` |

#### 캐시 헤더

조회수 조회는 직전 기록 결과가 stale cache에 가려지지 않도록 캐시하지 않습니다:

```
Cache-Control: no-store, no-cache, must-revalidate
```

#### 실패 — `400 Bad Request`

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "resourceIds는 필수입니다.",
    "requestId": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```

### 사용 예시

#### JavaScript (fetch)

```javascript
// 활동 목록의 조회수 일괄 조회
const ids = activities.map((a) => a.id).join(",");
const res = await fetch(
  `https://yonyoung.yonsei.ac.kr/api/public/views?resourceType=activity&resourceIds=${ids}`
);
const { data: viewCounts } = await res.json();
// viewCounts = { "id-1": 42, "id-2": 15, ... }
```

#### React / Next.js 전체 예시

```tsx
import { useEffect, useState } from "react";

type ViewCounts = Record<string, number>;

function useViewCounts(
  resourceType: "activity" | "exhibition",
  resourceIds: string[]
) {
  const [counts, setCounts] = useState<ViewCounts>({});

  useEffect(() => {
    if (resourceIds.length === 0) return;

    const ids = resourceIds.join(",");
    fetch(`/api/public/views?resourceType=${resourceType}&resourceIds=${ids}`)
      .then((res) => res.json())
      .then(({ data }) => setCounts(data))
      .catch(() => setCounts({}));
  }, [resourceType, resourceIds.join(",")]);

  return counts;
}

// 사용
function ActivityList({ activities }: { activities: Array<{ id: string; title: string }> }) {
  const viewCounts = useViewCounts(
    "activity",
    activities.map((a) => a.id)
  );

  return (
    <ul>
      {activities.map((activity) => (
        <li key={activity.id}>
          {activity.title} — 조회수: {viewCounts[activity.id] ?? 0}
        </li>
      ))}
    </ul>
  );
}
```

---

## 리소스 타입 정리

| `resourceType` 값 | 대상 | 관련 API |
|---|---|---|
| `"activity"` | 활동 게시물 | `GET /api/public/activities` |
| `"exhibition"` | 전시 게시물 | `GET /api/public/exhibitions` |

---

## 에러 응답 형식

모든 에러 응답은 동일한 envelope 형식을 따릅니다:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "에러 메시지",
    "requestId": "요청 추적 ID"
  }
}
```

| HTTP 상태 | `code` | 발생 조건 |
|-----------|--------|----------|
| `400` | `BAD_REQUEST` | `resourceType`이 유효하지 않음, `resourceId`/`resourceIds`가 UUID가 아님, 필수 파라미터 누락, `resourceIds` 100개 초과 |

---

## 주의사항

- **조회수 기록(`POST`)은 DB 기록 완료 후 `204`를 반환**합니다. 프론트엔드는 사용자 경험을 막지 않도록 `void fetch(...)` 형태로 호출할 수 있습니다.
- **조회수 조회(`GET`)는 캐시하지 않습니다.** 직전에 성공한 기록은 다음 조회에서 바로 반영됩니다.
- **한 번에 최대 100개**의 리소스 ID만 조회할 수 있습니다. 100개를 초과하면 `400` 에러가 반환됩니다.
- 조회수가 기록되지 않은 리소스 ID는 조회 시 `0`이 반환됩니다.
