import { sql } from "drizzle-orm";

/** D1은 CURRENT_TIMESTAMP이 초 단위라, 모든 timestamp_ms 컬럼은 이 기본값을 공유한다. */
export const nowTimestamp = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;
