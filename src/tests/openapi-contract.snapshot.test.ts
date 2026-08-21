import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { OPENAPI_BASE_DOCUMENT } from "../app/openapi";

type OperationSummary = {
  operationId?: string;
  tags?: string[];
  security?: unknown;
  parameters?: unknown;
  requestBody?: unknown;
  responses?: unknown;
};

/**
 * 구조 리팩터링만으로 API contract diff가 생기면 안 된다.
 * 경로/메서드/operationId/tags/security/params/body/response와 component schema 목록을
 * 통째로 스냅샷으로 고정한다.
 */
const buildContractSnapshot = () => {
  const app = createApp();
  const document = app.getOpenAPI31Document({
    ...OPENAPI_BASE_DOCUMENT,
    servers: [{ url: "https://api.example.test" }],
  }) as {
    paths?: Record<string, Record<string, OperationSummary>>;
    components?: { schemas?: Record<string, unknown> };
  };

  const operations: Record<string, OperationSummary> = {};
  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      operations[`${method.toUpperCase()} ${path}`] = {
        operationId: operation.operationId,
        tags: operation.tags,
        security: operation.security,
        parameters: operation.parameters,
        requestBody: operation.requestBody,
        responses: operation.responses,
      };
    }
  }

  return {
    operations: Object.fromEntries(
      Object.entries(operations).sort(([a], [b]) => a.localeCompare(b)),
    ),
    componentSchemas: Object.keys(document.components?.schemas ?? {}).sort(),
  };
};

describe("openapi contract", () => {
  it("경로/메서드/operationId/스키마 구조가 리팩터링 전후로 동일하다", () => {
    expect(buildContractSnapshot()).toMatchSnapshot();
  });

  it("등록된 모든 오퍼레이션이 고유한 operationId를 가진다", () => {
    const { operations } = buildContractSnapshot();
    const operationIds = Object.values(operations).map(
      (operation) => operation.operationId,
    );

    expect(operationIds.filter((id) => !id)).toHaveLength(0);
    expect(new Set(operationIds).size).toBe(operationIds.length);
  });
});
