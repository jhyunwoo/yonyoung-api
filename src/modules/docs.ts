import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import type { Context } from "hono";
import { requireActor } from "../lib/http/authz";
import { internalError } from "../lib/http/response";
import { enrichOpenApiDocument } from "../lib/openapi/enrich";
import { mergeOpenApiDocuments } from "../lib/openapi/merge";
import { errorResponses } from "../lib/openapi/responses";
import { ApiOpenApiDocumentSchema } from "../lib/openapi/schemas";
import type { AppDependencies } from "../lib/services/dependencies";
import HonoAppType from "../types/honoAppType";

type App = OpenAPIHono<HonoAppType>;

const OPENAPI_BASE_DOCUMENT = {
  openapi: "3.1.1",
  info: {
    title: "Yonyoung API",
    version: "1.0.0",
    description: "Yonyoung 서비스 API 문서",
  },
  components: {
    securitySchemes: {
      cookieAuth: {
        type: "apiKey" as const,
        in: "cookie" as const,
        name: "better-auth.session_token",
      },
    },
  },
};

const openApiJsonRoute = createRoute({
  method: "get",
  path: "/api/openapi.json",
  tags: ["Docs"],
  operationId: "getOpenApiDocument",
  responses: {
    200: {
      description: "통합 OpenAPI 문서 조회 성공",
      content: {
        "application/json": {
          schema: ApiOpenApiDocumentSchema,
        },
      },
    },
    401: errorResponses[401],
    500: errorResponses[500],
  },
});

const docsRoute = createRoute({
  method: "get",
  path: "/api/docs",
  tags: ["Docs"],
  operationId: "getScalarApiReference",
  responses: {
    200: {
      description: "Scalar API Reference 페이지",
      content: {
        "text/html": {
          schema: z.string(),
        },
      },
    },
    401: errorResponses[401],
  },
});

const ensureDocsAccess = async (
  c: Context<HonoAppType>,
  dependencies: AppDependencies,
) => {
  if (!dependencies.shouldRequireDocsAuth(c)) {
    return null;
  }

  const actorResult = await requireActor(c, dependencies);
  if ("response" in actorResult) {
    return actorResult.response;
  }

  return null;
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
  app.openapi(openApiJsonRoute, /** app.openapi 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @param c 요청/실행 컨텍스트 객체입니다. @returns 비동기 처리 결과를 Promise로 반환합니다. @remarks 네트워크 실패/타임아웃 상황을 고려해 예외 처리와 기본값 규약을 유지해야 합니다. */ async (c): Promise<any> => {
    const authResponse = await ensureDocsAccess(c, dependencies);
    if (authResponse) {
      return authResponse;
    }

    try {
      const internalDoc = app.getOpenAPI31Document({
        ...OPENAPI_BASE_DOCUMENT,
        servers: [{ url: new URL(c.req.url).origin }],
      });
      const authDoc = await dependencies.getAuthOpenApiSchema(c);
      const merged = mergeOpenApiDocuments(internalDoc, authDoc);
      const enriched = enrichOpenApiDocument(merged);
      return c.json(enriched, 200);
    } catch {
      return internalError(c, "OpenAPI 문서를 생성하지 못했습니다.");
    }
  });

  const scalarReference = Scalar<HonoAppType>({
    url: "/api/openapi.json",
    pageTitle: "Yonyoung API Docs",
    theme: "saturn",
  });

  app.openapi(docsRoute, /** app.openapi 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @param c 요청/실행 컨텍스트 객체입니다. @returns 비동기 처리 결과를 Promise로 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ async (c): Promise<any> => {
    const authResponse = await ensureDocsAccess(c, dependencies);
    if (authResponse) {
      return authResponse;
    }

    return scalarReference(c, /** scalarReference 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @returns 비동기 처리 결과를 Promise로 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ async () => {});
  });
};
