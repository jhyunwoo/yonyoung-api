/**
 * Public content view-count persistence.
 *
 * Counts are stored directly in D1 so reads reflect completed writes without
 * depending on Cloudflare Analytics Engine aggregation latency.
 */

export type ViewResourceType = "activity" | "exhibition";

const VALID_RESOURCE_TYPES = new Set<ViewResourceType>([
  "activity",
  "exhibition",
]);

export const isValidViewResourceType = (
  value: string,
): value is ViewResourceType =>
  VALID_RESOURCE_TYPES.has(value as ViewResourceType);

export interface ViewCountStore {
  recordView(resourceType: ViewResourceType, resourceId: string): Promise<void>;
  getViewCounts(
    resourceType: ViewResourceType,
    resourceIds: string[],
  ): Promise<Record<string, number>>;
}

type ViewCountDatabase = Pick<D1Database, "prepare">;

const normalizeCount = (value: unknown): number => {
  const count =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : 0;

  if (!Number.isFinite(count) || count <= 0) {
    return 0;
  }

  return Math.floor(count);
};

const uniqueResourceIds = (resourceIds: string[]): string[] =>
  Array.from(new Set(resourceIds));

export const createD1ViewCountStore = (
  database: ViewCountDatabase,
): ViewCountStore => ({
  async recordView(
    resourceType: ViewResourceType,
    resourceId: string,
  ): Promise<void> {
    const now = Date.now();

    const result = await database
      .prepare(
        `
          INSERT INTO view_counts (
            resource_type,
            resource_id,
            view_count,
            created_at,
            updated_at
          )
          VALUES (?, ?, 1, ?, ?)
          ON CONFLICT(resource_type, resource_id)
          DO UPDATE SET
            view_count = view_counts.view_count + 1,
            updated_at = excluded.updated_at
        `,
      )
      .bind(resourceType, resourceId, now, now)
      .run();

    if ((result as { success?: boolean }).success === false) {
      throw new Error("view count write failed");
    }
  },

  async getViewCounts(
    resourceType: ViewResourceType,
    resourceIds: string[],
  ): Promise<Record<string, number>> {
    const ids = uniqueResourceIds(resourceIds);
    if (ids.length === 0) {
      return {};
    }

    const placeholders = ids.map(() => "?").join(", ");
    const rows = await database
      .prepare(
        `
          SELECT resource_id, view_count
          FROM view_counts
          WHERE resource_type = ?
            AND resource_id IN (${placeholders})
        `,
      )
      .bind(resourceType, ...ids)
      .all<{ resource_id: string; view_count: number | string }>();

    const counts: Record<string, number> = {};
    for (const row of rows.results ?? []) {
      if (typeof row.resource_id === "string") {
        counts[row.resource_id] = normalizeCount(row.view_count);
      }
    }

    return counts;
  },
});

export const createNoopViewCountStore = (): ViewCountStore => ({
  async recordView(): Promise<void> {
    return undefined;
  },
  async getViewCounts(): Promise<Record<string, number>> {
    return {};
  },
});
