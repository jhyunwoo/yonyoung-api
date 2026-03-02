import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import type { Context } from "hono";
import { OPENAPI_BASE_DOCUMENT, OPENAPI_JSON_PATHS, OPENAPI_UI_PATHS } from "../app/openapi";
import { internalError } from "../lib/http/response";
import { enrichOpenApiDocument } from "../lib/openapi/enrich";
import { mergeOpenApiDocuments } from "../lib/openapi/merge";
import { errorResponses } from "../lib/openapi/responses";
import { ApiOpenApiDocumentSchema } from "../lib/openapi/schemas";
import type { AppDependencies } from "../lib/services/dependencies";
import HonoAppType from "../types/honoAppType";

type App = OpenAPIHono<HonoAppType>;

const createOpenApiJsonRoute = (path: string, operationId: string) =>
  createRoute({
    method: "get",
    path,
    tags: ["Docs"],
    operationId,
    responses: {
      200: {
        description: "통합 OpenAPI 문서 조회 성공",
        content: {
          "application/json": {
            schema: ApiOpenApiDocumentSchema,
          },
        },
      },
      500: errorResponses[500],
    },
  });

const createDocsUiRoute = (path: string, operationId: string) =>
  createRoute({
    method: "get",
    path,
    tags: ["Docs"],
    operationId,
    responses: {
      200: {
        description: "Scalar API Reference 페이지",
        content: {
          "text/html": {
            schema: z.string(),
          },
        },
      },
      500: errorResponses[500],
    },
  });

const buildOpenApiDocument = async (
  c: Context<HonoAppType>,
  app: App,
  dependencies: AppDependencies,
) => {
  const internalDoc = app.getOpenAPI31Document({
    ...OPENAPI_BASE_DOCUMENT,
    servers: [{ url: new URL(c.req.url).origin }],
  });
  const authDoc = await dependencies.getAuthOpenApiSchema(c);
  const merged = mergeOpenApiDocuments(internalDoc, authDoc);
  return enrichOpenApiDocument(merged);
};

/**
 * registerDocsRoutes 생성/등록 절차를 수행해 시스템 상태를 갱신합니다.
 * @param app 함수 로직에서 사용하는 입력값입니다.
 * @param dependencies 함수 로직에서 사용하는 입력값입니다.
 * @returns 처리 결과 값을 반환합니다.
 * @remarks 네트워크 실패/타임아웃 상황을 고려해 예외 처리와 기본값 규약을 유지해야 합니다.
 */
export const registerDocsRoutes = (
  app: App,
  dependencies: AppDependencies,
) => {
  const openApiJsonRoutes = OPENAPI_JSON_PATHS.map((path, index) =>
    createOpenApiJsonRoute(path, index === 0 ? "getOpenApiDocument" : "getOpenApiDocumentAlias"),
  );

  for (const route of openApiJsonRoutes) {
    app.openapi(route, async (c): Promise<any> => {
      try {
        const document = await buildOpenApiDocument(c, app, dependencies);
        return c.json(document, 200);
      } catch {
        return internalError(c, "OpenAPI 문서를 생성하지 못했습니다.");
      }
    });
  }

  const scalarReference = Scalar<HonoAppType>({
    url: "/api/openapi.json",
    pageTitle: "Yonyoung API Docs",
    theme: "saturn",
  });

  const docsUiRoutes = OPENAPI_UI_PATHS.map((path, index) =>
    createDocsUiRoute(path, index === 0 ? "getScalarApiReference" : "getScalarApiReferenceAlias"),
  );

  for (const route of docsUiRoutes) {
    app.openapi(route, async (c): Promise<any> => {
      try {
        return scalarReference(c, async () => {});
      } catch {
        return internalError(c, "OpenAPI 문서 UI를 렌더링하지 못했습니다.");
      }
    });
  }
};
