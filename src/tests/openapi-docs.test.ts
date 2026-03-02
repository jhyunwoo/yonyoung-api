import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { REQUIRED_DESCRIPTION_SECTIONS } from "../lib/openapi/descriptions";
import { OpenAPIDocument } from "../lib/openapi/merge";
import { createActor } from "./test-helpers";

const authOpenApiFixture: OpenAPIDocument = {
  openapi: "3.1.1",
  info: {
    title: "Better Auth",
    version: "1.0.0",
  },
  paths: {
    "/get-session": {
      get: {
        operationId: "getSession",
        responses: {
          200: {
            description: "ok",
          },
        },
      },
    },
    "/sign-in/social": {
      post: {
        operationId: "signInSocial",
        responses: {
          200: {
            description: "ok",
          },
        },
      },
    },
  },
  components: {
    schemas: {
      AuthSession: {
        type: "object",
      },
    },
    securitySchemes: {
      apiKeyCookie: {
        type: "apiKey",
        in: "cookie",
        name: "apiKeyCookie",
      },
    },
  },
  tags: [{ name: "Default", description: "Auth default endpoints" }],
};

type CreateDocsAppInput = {
  actor?: ReturnType<typeof createActor> | null;
  requireDocsAuth?: boolean;
  getAuthOpenApiSchema?: () => Promise<OpenAPIDocument>;
};

const createDocsApp = (input: CreateDocsAppInput = {}) => {
  const {
    actor = null,
    requireDocsAuth = false,
    getAuthOpenApiSchema = async () => authOpenApiFixture,
  } = input;

  return createApp({
    resolveActor: async () => actor,
    getAuthOpenApiSchema,
    shouldRequireDocsAuth: () => requireDocsAuth,
  });
};

describe("OpenAPI docs routes", () => {
  it("docs 인증 활성화 여부와 무관하게 비로그인 접근은 /api/docs에서 200을 반환한다", async () => {
    const app = createDocsApp({ requireDocsAuth: true });

    const response = await app.request("/api/docs");
    expect(response.status).toBe(200);
  });

  it("docs 인증 활성화 여부와 무관하게 비로그인 접근은 /api/openapi.json에서 200을 반환한다", async () => {
    const app = createDocsApp({ requireDocsAuth: true });

    const response = await app.request("/api/openapi.json");
    expect(response.status).toBe(200);
  });

  it("docs 인증 활성화 시 로그인 사용자는 /api/docs와 /api/openapi.json에 접근할 수 있다", async () => {
    const app = createDocsApp({
      actor: createActor("regular_member"),
      requireDocsAuth: true,
    });

    const docsResponse = await app.request("/api/docs");
    expect(docsResponse.status).toBe(200);

    const openApiResponse = await app.request("/api/openapi.json");
    expect(openApiResponse.status).toBe(200);
  });

  it("docs 인증 비활성화 상태에서 통합 OpenAPI 문서를 반환한다", async () => {
    const app = createDocsApp({ requireDocsAuth: false });

    const response = await app.request("/api/openapi.json");
    expect(response.status).toBe(200);

    const body = (await response.json()) as OpenAPIDocument;
    expect(body.openapi).toBe("3.1.1");

    expect(body.paths?.["/api/activities"]).toBeDefined();
    expect(body.paths?.["/api/users/{id}"]).toBeDefined();

    expect(body.paths?.["/api/auth/get-session"]).toBeDefined();
    expect(body.paths?.["/api/auth/sign-in/social"]).toBeDefined();

    const activityPost = body.paths?.["/api/activities"]?.post;
    expect(activityPost?.security).toEqual([{ cookieAuth: [] }]);

    expect(activityPost?.requestBody).toBeDefined();
    expect(activityPost?.responses?.["201"]).toBeDefined();

    expect(body.components?.schemas?.ApiErrorResponse).toBeDefined();
    expect(body.components?.schemas?.AuthSession).toBeDefined();

    expect(typeof activityPost?.summary).toBe("string");
    expect(activityPost?.summary?.length ?? 0).toBeGreaterThan(0);
    for (const section of REQUIRED_DESCRIPTION_SECTIONS) {
      expect(activityPost?.description).toContain(section);
    }

    const getSession = body.paths?.["/api/auth/get-session"]?.get;
    expect(typeof getSession?.summary).toBe("string");
    for (const section of REQUIRED_DESCRIPTION_SECTIONS) {
      expect(getSession?.description).toContain(section);
    }

    expect(activityPost?.responses?.["403"]?.description).toContain(
      "역할 기반 권한 정책",
    );
  });

  it("docs 인증 비활성화 상태에서 /api/docs 페이지를 반환한다", async () => {
    const app = createDocsApp({ requireDocsAuth: false });

    const response = await app.request("/api/docs");
    expect(response.status).toBe(200);
    const csp = response.headers.get("content-security-policy-report-only");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("https://cdn.jsdelivr.net");
    expect(response.headers.get("content-security-policy")).toBeNull();
    const html = await response.text();
    expect(html.length).toBeGreaterThan(0);
    expect(html.toLowerCase()).toContain("scalar");
  });
});
