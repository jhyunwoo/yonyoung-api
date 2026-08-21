import { type OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { z } from "../../shared/openapi/zod";
import { Scalar } from "@scalar/hono-api-reference";
import type { Context } from "hono";
import {
  OPENAPI_BASE_DOCUMENT,
  OPENAPI_JSON_PATHS,
  OPENAPI_UI_PATHS,
} from "../openapi";
import { runInBackground } from "../../lib/http/background-task";
import { AppError } from "../../shared/errors/AppError";
import { enrichOpenApiDocument } from "../../lib/openapi/enrich";
import {
  mergeOpenApiDocuments,
  type OpenAPIDocument,
} from "../../lib/openapi/merge";
import { errorResponses } from "../../lib/openapi/responses";
import { ApiOpenApiDocumentSchema } from "../../shared/openapi/openapi-document.contract";
import type { AppDependencies } from "../../lib/services/dependencies";
import type HonoAppType from "../../types/honoAppType";

type App = OpenAPIHono<HonoAppType>;

const OPENAPI_CACHE_TTL_MS = 120_000;
const OPENAPI_CACHE_STALE_MS = 300_000;
const DOCS_CACHE_CONTROL =
  "public, max-age=30, s-maxage=120, stale-while-revalidate=300";

type OpenApiCacheEntry = {
  document: OpenAPIDocument;
  expiresAt: number;
  staleUntil: number;
};

const openApiDocumentCache = new Map<string, OpenApiCacheEntry>();
const openApiDocumentRefreshTasks = new Map<string, Promise<void>>();

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
      404: errorResponses[404],
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
      404: errorResponses[404],
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

const readAuthSchemaCacheSignature = (c: Context<HonoAppType>): string => {
  const env = c.env;
  return [
    env?.BETTER_AUTH_URL ?? "",
    env?.BETTER_AUTH_TRUSTED_ORIGINS ?? "",
    env?.BETTER_AUTH_EMAIL_AND_PASSWORD_ENABLED ?? "",
    env?.GOOGLE_CLIENT_ID ?? "",
    env?.GOOGLE_CLIENT_SECRET ?? "",
  ].join("|");
};

const readOpenApiDocumentCacheKey = (c: Context<HonoAppType>): string => {
  return `${new URL(c.req.url).origin}|${readAuthSchemaCacheSignature(c)}`;
};

const cacheOpenApiDocument = (
  cacheKey: string,
  document: OpenAPIDocument,
): void => {
  const now = Date.now();
  openApiDocumentCache.set(cacheKey, {
    document,
    expiresAt: now + OPENAPI_CACHE_TTL_MS,
    staleUntil: now + OPENAPI_CACHE_TTL_MS + OPENAPI_CACHE_STALE_MS,
  });
};

const setDocsCacheHeaders = (c: Context<HonoAppType>): void => {
  c.header("Cache-Control", DOCS_CACHE_CONTROL);
};

const assertDocsEnabled = (
  c: Context<HonoAppType>,
  dependencies: AppDependencies,
): void => {
  if (!dependencies.isDocsEnabled(c)) {
    throw AppError.notFound("개발 환경에서만 OpenAPI 문서를 제공합니다.");
  }
};

// 문서 생성은 Better Auth 스키마 fetch를 포함하므로 실패/타임아웃을 전제로 캐시와 폴백을 둔다.
export const registerDocsRoutes = (app: App, dependencies: AppDependencies) => {
  const openApiJsonRoutes = OPENAPI_JSON_PATHS.map((path, index) =>
    createOpenApiJsonRoute(
      path,
      index === 0 ? "getOpenApiDocument" : "getOpenApiDocumentAlias",
    ),
  );

  for (const route of openApiJsonRoutes) {
    app.openapi(route, async (c) => {
      assertDocsEnabled(c, dependencies);

      const cacheKey = readOpenApiDocumentCacheKey(c);
      const now = Date.now();
      const cached = openApiDocumentCache.get(cacheKey);

      if (cached && now <= cached.expiresAt) {
        setDocsCacheHeaders(c);
        return c.json(cached.document, 200);
      }

      if (cached && now <= cached.staleUntil) {
        if (!openApiDocumentRefreshTasks.has(cacheKey)) {
          const refreshTask = (async () => {
            try {
              const refreshedDocument = await buildOpenApiDocument(
                c,
                app,
                dependencies,
              );
              cacheOpenApiDocument(cacheKey, refreshedDocument);
            } finally {
              openApiDocumentRefreshTasks.delete(cacheKey);
            }
          })();
          openApiDocumentRefreshTasks.set(cacheKey, refreshTask);
          await runInBackground(c, refreshTask, {
            fallback: "fire-and-forget",
          });
        }

        setDocsCacheHeaders(c);
        return c.json(cached.document, 200);
      }

      try {
        const document = await buildOpenApiDocument(c, app, dependencies);
        cacheOpenApiDocument(cacheKey, document);
        setDocsCacheHeaders(c);
        return c.json(document, 200);
      } catch {
        throw AppError.internalWithReason(
          "OpenAPI 문서를 생성하지 못했습니다.",
        );
      }
    });
  }

  const scalarReference = Scalar<HonoAppType>({
    url: "/api/openapi.json",
    pageTitle: "Yonyoung API Docs",
    theme: "saturn",
  });

  const docsUiRoutes = OPENAPI_UI_PATHS.map((path, index) =>
    createDocsUiRoute(
      path,
      index === 0 ? "getScalarApiReference" : "getScalarApiReferenceAlias",
    ),
  );

  for (const route of docsUiRoutes) {
    app.openapi(route, async (c) => {
      assertDocsEnabled(c, dependencies);

      try {
        setDocsCacheHeaders(c);
        // Scalar 미들웨어가 완성된 HTML Response를 만들어 준다. 라우트 계약은
        // text/html 문자열이므로 여기서만 그 사실을 타입으로 이어 준다.
        const rendered = await scalarReference(c, async () => undefined);
        return (rendered ?? c.res) as ReturnType<typeof c.html>;
      } catch {
        throw AppError.internalWithReason(
          "OpenAPI 문서 UI를 렌더링하지 못했습니다.",
        );
      }
    });
  }
};
