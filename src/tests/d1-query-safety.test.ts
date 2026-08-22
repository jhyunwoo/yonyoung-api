import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE_ROOT = join(process.cwd(), "src");

const listTypeScriptFiles = (directory: string): string[] => {
  return readdirSync(directory).flatMap((entry) => {
    const fullPath = join(directory, entry);
    if (statSync(fullPath).isDirectory()) {
      return listTypeScriptFiles(fullPath);
    }
    return fullPath.endsWith(".ts") ? [fullPath] : [];
  });
};

// 바인딩 자리표시자 목록(`?, ?, ?`)만은 개수가 가변이라 SQL 문자열에 끼워 넣을 수밖에 없다.
// 값 자체는 항상 bind()로 전달되므로 이 형태만 예외로 허용한다.
const PLACEHOLDER_INTERPOLATION = /\$\{placeholders\}/g;
const PLACEHOLDER_BUILDER = /\.map\(\(\) => "\?"\)\.join\(/;

/**
 * 원시 D1 문 실행은 db-service 한 곳이 아니라 feature repository 여러 곳에 흩어져 있다.
 * 어느 파일에서든 SQL 문자열에 런타임 값을 보간하지 않는지 전수 검사한다.
 */
describe("d1 query safety", () => {
  it("database.prepare 쿼리는 문자열 보간 없이 bind를 사용한다", () => {
    const files = listTypeScriptFiles(SOURCE_ROOT);

    const interpolated: string[] = [];
    let preparedCount = 0;

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const matches = [
        ...source.matchAll(
          /database\s*\.\s*prepare\(\s*`([^`]*?)`\s*,?\s*\)\s*\.\s*bind\(/g,
        ),
      ];
      preparedCount += matches.length;
      for (const match of matches) {
        const sql = (match[1] ?? "").replace(PLACEHOLDER_INTERPOLATION, "");
        if (sql.includes("${")) {
          interpolated.push(file);
          continue;
        }
        if (sql !== match[1] && !PLACEHOLDER_BUILDER.test(source)) {
          interpolated.push(file);
        }
      }
    }

    expect(preparedCount).toBeGreaterThan(0);
    expect(interpolated).toEqual([]);
  });
});
