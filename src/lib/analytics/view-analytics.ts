/**
 * 홈페이지 게시물 조회수 기록/조회 서비스.
 *
 * - Writer: Cloudflare Analytics Engine `writeDataPoint`를 래핑하여 조회 이벤트를 기록합니다.
 * - Reader: Cloudflare Analytics API (GraphQL)를 호출하여 리소스별 누적 조회수를 조회합니다.
 */

/** 조회수 추적 대상 리소스 타입 */
export type ViewResourceType = "activity" | "exhibition";

const VALID_RESOURCE_TYPES = new Set<ViewResourceType>(["activity", "exhibition"]);

/**
 * 주어진 문자열이 유효한 ViewResourceType인지 검증합니다.
 */
export const isValidViewResourceType = (value: string): value is ViewResourceType =>
  VALID_RESOURCE_TYPES.has(value as ViewResourceType);

// ─────────────────────────────────────────────────
//  Writer
// ─────────────────────────────────────────────────

export interface ViewAnalyticsWriter {
  /**
   * 단건 조회 이벤트를 기록합니다.
   * fire-and-forget 방식이므로 반환값이 없습니다.
   */
  recordView(resourceType: ViewResourceType, resourceId: string): void;
}

/**
 * Analytics Engine 기반 Writer를 생성합니다.
 *
 * writeDataPoint 스키마:
 * - blobs[0]: resourceType ("activity" | "exhibition")
 * - blobs[1]: resourceId (UUID)
 * - doubles[0]: 1 (카운트 단위)
 * - indexes[0]: "{resourceType}:{resourceId}" (쿼리 최적화용 인덱스)
 */
export const createViewAnalyticsWriter = (
  dataset: AnalyticsEngineDataset | undefined,
  enabled: boolean,
): ViewAnalyticsWriter => ({
  recordView(resourceType: ViewResourceType, resourceId: string): void {
    if (!enabled || !dataset) {
      return;
    }

    try {
      dataset.writeDataPoint({
        blobs: [resourceType, resourceId],
        doubles: [1],
        indexes: [`${resourceType}:${resourceId}`],
      });
    } catch {
      // 조회수 기록 실패가 요청을 중단시키면 안 됩니다.
    }
  },
});

// ─────────────────────────────────────────────────
//  Reader
// ─────────────────────────────────────────────────

export interface ViewAnalyticsReader {
  /**
   * 지정한 리소스 타입 + 리소스 ID 목록의 누적 조회수를 반환합니다.
   * 결과에 포함되지 않은 리소스 ID는 조회수 0으로 간주합니다.
   */
  getViewCounts(
    resourceType: ViewResourceType,
    resourceIds: string[],
  ): Promise<Record<string, number>>;
}

const ANALYTICS_API_URL = "https://api.cloudflare.com/client/v4/graphql";

interface AnalyticsApiResponse {
  data?: {
    viewer?: {
      accounts?: Array<{
        viewAnalytics?: Array<{
          sum?: { double1?: number };
          dimensions?: { blob1?: string };
        }>;
      }>;
    };
  };
  errors?: Array<{ message: string }>;
}

/**
 * Cloudflare Analytics API (GraphQL) 기반 Reader를 생성합니다.
 */
export const createViewAnalyticsReader = (
  accountId: string | undefined,
  apiToken: string | undefined,
  datasetName = "yonyoung_views",
): ViewAnalyticsReader => ({
  async getViewCounts(
    resourceType: ViewResourceType,
    resourceIds: string[],
  ): Promise<Record<string, number>> {
    if (!accountId || !apiToken || resourceIds.length === 0) {
      return {};
    }

    const indexFilter = resourceIds.map(
      (id) => `${resourceType}:${id}`,
    );

    const query = `
      query GetViewCounts($accountTag: String!, $dataset: String!, $indexes: [String!]!) {
        viewer {
          accounts(filter: { accountTag: $accountTag }) {
            analyticsEngineDatasets: ${datasetName}(
              limit: ${resourceIds.length}
              filter: {
                AND: [
                  { dataset: $dataset }
                  { index1_in: $indexes }
                ]
              }
            ) {
              sum {
                double1
              }
              dimensions {
                blob1
              }
            }
          }
        }
      }
    `;

    try {
      const response = await fetch(ANALYTICS_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          variables: {
            accountTag: accountId,
            dataset: datasetName,
            indexes: indexFilter,
          },
        }),
      });

      if (!response.ok) {
        return {};
      }

      const result = (await response.json()) as AnalyticsApiResponse;
      if (result.errors && result.errors.length > 0) {
        return {};
      }

      const rows =
        result.data?.viewer?.accounts?.[0]?.viewAnalytics ?? [];

      const counts: Record<string, number> = {};
      for (const row of rows) {
        const resourceId = row.dimensions?.blob1;
        const count = row.sum?.double1;
        if (resourceId && typeof count === "number") {
          counts[resourceId] = Math.max(0, Math.round(count));
        }
      }

      return counts;
    } catch {
      // fail-open: API 오류 시 빈 결과 반환
      return {};
    }
  },
});

/**
 * 비활성 Reader (기본값).
 * API 토큰이 없을 때 사용되며, 항상 빈 결과를 반환합니다.
 */
export const createNoopViewAnalyticsReader = (): ViewAnalyticsReader => ({
  async getViewCounts(): Promise<Record<string, number>> {
    return {};
  },
});
