# 대시보드 조회수 통계 API 문서

> 대시보드 그래프 및 지표 표시를 위해 오늘/이번 주의 조회수와 이전 기간 대비 비교 데이터를 제공하는 API 명세입니다.

---

## 기본 정보

| 항목         | 값                                |
| ------------ | --------------------------------- |
| Base URL     | `https://yonyoung.yonsei.ac.kr`   |
| 경로         | `/api/admin/page-views/dashboard` |
| 메서드       | `GET`                             |
| 인증         | **필요** (관리자 권한 쿠키 세션)  |
| Content-Type | `application/json`                |

---

## 응답 명세 (200 OK)

요청 성공 시 다음과 같은 구조의 통계 데이터를 반환합니다.

### 데이터 구조 (`data`)

| 필드명               | 타입     | 설명                                                 |
| -------------------- | -------- | ---------------------------------------------------- |
| `today`              | `object` | 오늘의 방문 통계                                     |
| `today.count`        | `number` | 오늘 총 방문 수 (KST 기준)                           |
| `today.prevCount`    | `number` | 어제 총 방문 수 (KST 기준)                           |
| `thisWeek`           | `object` | 이번 주의 방문 통계                                  |
| `thisWeek.count`     | `number` | 이번 주 총 방문 수 (월요일~현재, KST 기준)           |
| `thisWeek.prevCount` | `number` | 지난 주 총 방문 수 (지난 주 월요일~일요일, KST 기준) |
| `dailyTrend`         | `array`  | 최근 30일간의 일별 방문 추세                         |
| `dailyTrend[].date`  | `string` | 날짜 (YYYY-MM-DD, KST 기준)                          |
| `dailyTrend[].count` | `number` | 해당 날짜의 방문 수                                  |

### 응답 예시

```json
{
  "data": {
    "today": {
      "count": 150,
      "prevCount": 120
    },
    "thisWeek": {
      "count": 850,
      "prevCount": 780
    },
    "dailyTrend": [
      { "date": "2026-05-10", "count": 110 },
      { "date": "2026-05-11", "count": 130 },
      { "date": "2026-05-12", "count": 120 }
    ]
  }
}
```

---

## 에러 응답

| 코드               | 설명                                   |
| ------------------ | -------------------------------------- |
| `401 Unauthorized` | 세션이 유효하지 않거나 로그인이 필요함 |
| `403 Forbidden`    | 조회 권한이 없는 사용자                |

---

## 구현 상세 참고 (개발자용)

- **시간대 처리**: 모든 통계는 한국 시간(KST, UTC+9)을 기준으로 집계됩니다.
- **주간 기준**: 월요일을 주의 시작일로 간주합니다.
- **데이터 소스**: `page_views` 테이블의 원시 로그 데이터를 실시간으로 집계하여 반환합니다.
- **비교 로직**:
  - `today.prevCount`: 어제 00:00:00 ~ 23:59:59 (KST)
  - `thisWeek.prevCount`: 지난 주 월요일 00:00:00 ~ 지난 주 일요일 23:59:59 (KST)
