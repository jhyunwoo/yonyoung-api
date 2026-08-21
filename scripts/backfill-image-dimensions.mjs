#!/usr/bin/env node
/**
 * 세부 이미지의 원본 픽셀 크기(width/height) 일회성 백필 스크립트.
 *
 * width/height 컬럼 도입(0008 마이그레이션) 이전에 업로드된 행은 값이 NULL이라
 * 공개 갤러리가 로드 후 비율을 보정하는 폴백 경로를 타고 레이아웃 시프트가 생긴다.
 * Cloudflare Image Transformations의 `format=json`이 원본 크기를 그대로 돌려주므로
 * 이를 읽어 D1에 채워 넣는다.
 *
 * 선행 조건: moveto.kr 존에 Image Transformations가 활성화돼 있어야 한다.
 *   curl -sS "$CDN/cdn-cgi/image/format=json/<objectKey>" → {"width":...,"height":...}
 *
 * 사용법:
 *   node scripts/backfill-image-dimensions.mjs --dry-run          # 로컬 D1, 조회만
 *   node scripts/backfill-image-dimensions.mjs --remote --dry-run # 원격 D1, 조회만
 *   node scripts/backfill-image-dimensions.mjs --remote           # 원격 D1에 실제 반영
 *
 * 실패한 이미지는 건너뛰고 NULL로 남긴다(프런트 폴백이 계속 동작하므로 안전).
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DATABASE_NAME = "yonyoung-db";
const PUBLIC_MEDIA_PATH_PREFIX = "/api/public/media/";
const DEFAULT_CDN_BASE_URL = "https://storage.yonyoung.moveto.kr";
const TARGET_TABLES = ["activity_images", "exhibition_images"];
/** D1 요청 1건당 UPDATE 문 수 — 너무 크면 D1 파라미터/구문 한도에 걸린다 */
const UPDATE_CHUNK_SIZE = 50;
/** format=json 동시 요청 수 */
const FETCH_CONCURRENCY = 8;
/** 변환 실패 시 재시도 횟수 (큰 원본은 첫 변환이 실패할 수 있다) */
const FETCH_MAX_ATTEMPTS = 3;
const FETCH_RETRY_BASE_DELAY_MS = 1500;
const UUID_PATTERN = /^[0-9a-fA-F-]{36}$/;

const args = new Set(process.argv.slice(2));
const isRemote = args.has("--remote");
const isDryRun = args.has("--dry-run");
const cdnBaseUrl = (
  process.env.IMAGE_CDN_BASE_URL ?? DEFAULT_CDN_BASE_URL
).replace(/\/+$/, "");

const runWrangler = (wranglerArgs) => {
  const output = execFileSync(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      DATABASE_NAME,
      isRemote ? "--remote" : "--local",
      "--json",
      ...wranglerArgs,
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );

  // wrangler가 배너 등 비-JSON 줄을 앞에 섞어 출력할 수 있어 첫 '[' 부터 파싱한다
  const jsonStart = output.indexOf("[");
  if (jsonStart === -1) {
    throw new Error(`wrangler 응답에서 JSON을 찾지 못했습니다:\n${output}`);
  }
  return JSON.parse(output.slice(jsonStart));
};

const selectRowsMissingDimensions = (table) => {
  const result = runWrangler([
    "--command",
    `SELECT id, image_url FROM ${table} WHERE deleted_at IS NULL AND (width IS NULL OR height IS NULL)`,
  ]);
  return result[0]?.results ?? [];
};

/** DB에 저장된 공개 URL에서 R2 오브젝트 경로를 뽑는다 (web 로더와 동일한 규칙) */
const extractObjectPath = (imageUrl) => {
  try {
    const url = new URL(imageUrl);
    if (url.pathname.startsWith(PUBLIC_MEDIA_PATH_PREFIX)) {
      return url.pathname.slice(PUBLIC_MEDIA_PATH_PREFIX.length) || null;
    }
    if (url.origin === new URL(cdnBaseUrl).origin) {
      return url.pathname.replace(/^\/+/, "") || null;
    }
  } catch {
    return null;
  }
  return null;
};

const fetchDimensionsOnce = async (objectPath) => {
  const response = await fetch(
    `${cdnBaseUrl}/cdn-cgi/image/format=json/${objectPath}`,
  );
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  // 변환이 실패하면 Cloudflare가 JSON 대신 원본 이미지 바이트를 그대로 돌려준다.
  // 용량이 큰 원본(10MB+)의 첫 변환에서 실제로 관측됐고 재시도하면 성공한다.
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) {
    throw new Error(`JSON이 아닌 응답(변환 실패): ${contentType}`);
  }

  // format=json 응답은 최상위에 결과 크기를, original에 원본 크기를 담는다.
  // 리사이즈 파라미터를 주지 않았으므로 둘이 같지만, 키 위치가 달라질 경우를 대비해 둘 다 본다.
  const payload = await response.json();
  const width = Number(payload?.width ?? payload?.original?.width);
  const height = Number(payload?.height ?? payload?.original?.height);
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error(`형식이 올바르지 않은 응답: ${JSON.stringify(payload)}`);
  }
  return { width, height };
};

/** 큰 원본은 첫 변환이 실패할 수 있어 지연을 두고 재시도한다 */
const fetchDimensions = async (objectPath) => {
  let lastError;
  for (let attempt = 0; attempt < FETCH_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await fetchDimensionsOnce(objectPath);
    } catch (error) {
      lastError = error;
      if (attempt < FETCH_MAX_ATTEMPTS - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, FETCH_RETRY_BASE_DELAY_MS * (attempt + 1)),
        );
      }
    }
  }
  throw lastError;
};

/** 동시 요청 수를 제한하면서 순서대로 결과를 모은다 */
const mapWithConcurrency = async (items, limit, mapper) => {
  const results = new Array(items.length);
  let cursor = 0;

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await mapper(items[index], index);
      }
    },
  );

  await Promise.all(workers);
  return results;
};

const applyUpdates = (table, updates) => {
  const directory = mkdtempSync(join(tmpdir(), "backfill-dimensions-"));
  const filePath = join(directory, `${table}.sql`);

  try {
    const statements = updates
      .map(
        ({ id, width, height }) =>
          `UPDATE ${table} SET width = ${width}, height = ${height} WHERE id = '${id}';`,
      )
      .join("\n");
    writeFileSync(filePath, statements, "utf8");
    runWrangler(["--file", filePath]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

const processTable = async (table) => {
  const rows = selectRowsMissingDimensions(table);
  console.log(`\n[${table}] 크기 미상 행: ${rows.length}건`);
  if (rows.length === 0) {
    return { updated: 0, skipped: 0 };
  }

  const resolved = await mapWithConcurrency(
    rows,
    FETCH_CONCURRENCY,
    async (row) => {
      // 생성된 SQL에 직접 넣는 값이므로 id 형식을 먼저 검증한다
      if (typeof row.id !== "string" || !UUID_PATTERN.test(row.id)) {
        console.warn(`  건너뜀 (id 형식 이상): ${row.id}`);
        return null;
      }

      const objectPath = extractObjectPath(row.image_url);
      if (!objectPath) {
        console.warn(`  건너뜀 (오브젝트 경로 추출 실패): ${row.image_url}`);
        return null;
      }

      try {
        const { width, height } = await fetchDimensions(objectPath);
        return { id: row.id, width, height };
      } catch (error) {
        console.warn(`  건너뜀 (${error.message}): ${objectPath}`);
        return null;
      }
    },
  );

  const updates = resolved.filter((item) => item !== null);
  const skipped = rows.length - updates.length;
  console.log(`  측정 성공 ${updates.length}건 / 건너뜀 ${skipped}건`);

  if (isDryRun) {
    console.log(`  --dry-run 이므로 DB에 반영하지 않습니다.`);
    console.log(`  예시: ${JSON.stringify(updates.slice(0, 3))}`);
    return { updated: 0, skipped };
  }

  for (let index = 0; index < updates.length; index += UPDATE_CHUNK_SIZE) {
    const chunk = updates.slice(index, index + UPDATE_CHUNK_SIZE);
    applyUpdates(table, chunk);
    console.log(`  반영 ${index + chunk.length}/${updates.length}`);
  }

  return { updated: updates.length, skipped };
};

const main = async () => {
  console.log(
    `대상 D1: ${isRemote ? "remote" : "local"} / CDN: ${cdnBaseUrl}${isDryRun ? " / DRY RUN" : ""}`,
  );

  let totalUpdated = 0;
  let totalSkipped = 0;
  for (const table of TARGET_TABLES) {
    const { updated, skipped } = await processTable(table);
    totalUpdated += updated;
    totalSkipped += skipped;
  }

  console.log(`\n완료: 반영 ${totalUpdated}건, 건너뜀 ${totalSkipped}건`);
  if (totalSkipped > 0) {
    console.log(
      "건너뛴 행은 width/height가 NULL로 남고 프런트 폴백 경로로 렌더링됩니다.",
    );
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
