import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { openAPI } from "better-auth/plugins";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import * as schema from "../platform/db/schema";
import createDB from "./db";
import type { AppBindings } from "../types/honoAppType";
import {
  resolveAuthRuntimeEnv,
  type AuthRuntimeEnv,
} from "./config/runtime-env";
import { isHttpUrl } from "./validation/url";

const LOCAL_HOSTNAME = "localhost";

const assertSafePublicUserUrls = (user: unknown): void => {
  if (!user || typeof user !== "object") {
    return;
  }

  const fields = user as {
    image?: unknown;
    personalLink?: unknown;
  };
  for (const [fieldName, value] of [
    ["image", fields.image],
    ["personalLink", fields.personalLink],
  ] as const) {
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value !== "string" || !isHttpUrl(value)) {
      throw new APIError("BAD_REQUEST", {
        message: `${fieldName}은 http(s) URL만 사용할 수 있습니다.`,
      });
    }
  }
};

const isIpHostname = (hostname: string): boolean => {
  return /^[0-9.]+$/.test(hostname) || hostname.includes(":");
};

const parseHostname = (value: string): string | undefined => {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return undefined;
  }
};

const parseHost = (value: string): string | undefined => {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return undefined;
  }
};

const MULTI_PART_PUBLIC_SUFFIXES = new Set([
  "ac.kr",
  "co.kr",
  "go.kr",
  "or.kr",
  "ne.kr",
  "re.kr",
  "pe.kr",
  "co.uk",
  "ac.uk",
  "org.uk",
  "me.uk",
  "co.jp",
  "ac.jp",
  "or.jp",
  "ne.jp",
  "com.au",
  "org.au",
  "edu.au",
  "net.au",
  "com.br",
  "org.br",
  "net.br",
]);

export const resolveCrossSubDomainCookieDomain = (
  baseURL: string,
): string | undefined => {
  try {
    const hostname = new URL(baseURL).hostname.toLowerCase();
    if (hostname === LOCAL_HOSTNAME || isIpHostname(hostname)) {
      return undefined;
    }

    const labels = hostname.split(".").filter(Boolean);
    if (labels.length < 3) {
      return undefined;
    }

    const lastTwo = labels.slice(-2).join(".");
    if (MULTI_PART_PUBLIC_SUFFIXES.has(lastTwo) && labels.length < 5) {
      return undefined;
    }

    return labels.slice(1).join(".");
  } catch {
    return undefined;
  }
};

export const resolveAuthAllowedHosts = (
  baseURL: string,
  trustedOrigins: string[],
): string[] => {
  const hosts = new Set<string>();
  const baseHost = parseHost(baseURL);
  if (baseHost) {
    hosts.add(baseHost);
  }

  for (const origin of trustedOrigins) {
    const host = parseHost(origin);
    if (host) {
      hosts.add(host);
    }
  }

  return [...hosts];
};

export const shouldEnableCrossSubDomainCookies = (
  cookieDomain: string | undefined,
  trustedOrigins: string[],
): boolean => {
  if (!cookieDomain) {
    return false;
  }

  const normalizedCookieDomain = cookieDomain.toLowerCase();
  const suffix = `.${normalizedCookieDomain}`;

  return trustedOrigins.every((origin) => {
    const hostname = parseHostname(origin);
    if (!hostname) {
      return false;
    }

    return hostname === normalizedCookieDomain || hostname.endsWith(suffix);
  });
};

const createAuthWithEnv = (database: D1Database, env: AuthRuntimeEnv) => {
  const db = createDB(database);
  const crossSubDomainCookieDomain = resolveCrossSubDomainCookieDomain(
    env.baseURL,
  );
  const enableCrossSubDomainCookies = shouldEnableCrossSubDomainCookies(
    crossSubDomainCookieDomain,
    env.trustedOrigins,
  );
  const authAllowedHosts = resolveAuthAllowedHosts(env.baseURL, env.trustedOrigins);
  const useSecureCookies = env.baseURL.startsWith("https://");
  const baseURLProtocol = useSecureCookies ? "https" : "http";

  return betterAuth({
    baseURL: {
      allowedHosts: authAllowedHosts,
      fallback: env.baseURL,
      protocol: baseURLProtocol,
    },
    basePath: "/api/auth",
    secret: env.secret,
    trustedOrigins: env.trustedOrigins,
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema,
    }),
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            assertSafePublicUserUrls(user);
          },
        },
        update: {
          before: async (user) => {
            assertSafePublicUserUrls(user);
          },
        },
      },
    },
    socialProviders: {
      google: {
        clientId: env.googleClientId,
        clientSecret: env.googleClientSecret,
      },
    },
    emailAndPassword: {
      enabled: env.emailAndPasswordEnabled,
    },
    session: {
      // 세션 데이터를 서명된 쿠키에 단기 캐시해 요청마다 발생하던
      // D1 세션 조회(원거리 리전에서 왕복 ~200ms)를 제거한다.
      // 권한(role)은 어차피 getActorFromSession에서 매 요청 DB로 재확인하므로
      // 인가 정확도에는 영향이 없다. 세션 폐기 전파 지연은 최대 5분.
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60,
      },
    },
    user: {
      additionalFields: {
        familyName: {
          type: "string",
          required: false,
        },
        givenName: {
          type: "string",
          required: false,
        },
        college: {
          type: "string",
          required: false,
        },
        department: {
          type: "string",
          required: false,
        },
        studentNumber: {
          type: "string",
          required: false,
        },
        phoneNumber: {
          type: "string",
          required: false,
        },
        collaborationAvailable: {
          type: "boolean",
          required: false,
          defaultValue: false,
        },
        personalLink: {
          type: "string",
          required: false,
        },
        role: {
          type: "string",
          required: false,
          input: false,
          defaultValue: "unverified",
        },
        generationId: {
          type: "string",
          required: false,
          input: false,
        },
        latestGenerationSortOrder: {
          type: "number",
          required: false,
          input: false,
        },
      },
    },
    plugins: [
      openAPI({
        disableDefaultReference: true,
      }),
    ],
    advanced: {
      trustedProxyHeaders: true,
      useSecureCookies,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: useSecureCookies,
      },
      ...(enableCrossSubDomainCookies && crossSubDomainCookieDomain
        ? {
            crossSubDomainCookies: {
              enabled: true,
              domain: crossSubDomainCookieDomain,
            },
          }
        : {}),
    },
  });
};

export const getAuthCorsOrigins = (env?: Partial<AppBindings>): string[] => {
  return resolveAuthRuntimeEnv(env, true).trustedOrigins;
};

type AuthCacheEntry = {
  envSignature: string;
  instance: ReturnType<typeof createAuthWithEnv>;
};

const authCache = new WeakMap<D1Database, AuthCacheEntry>();

const buildAuthCacheSignature = (env: AuthRuntimeEnv): string =>
  [
    env.baseURL,
    env.secret,
    env.trustedOrigins.join(","),
    env.googleClientId,
    env.googleClientSecret,
    String(env.emailAndPasswordEnabled),
  ].join("|");

export const createAuth = (
  database: D1Database,
  env?: Partial<AppBindings>,
) => {
  const resolvedEnv = resolveAuthRuntimeEnv(env, false);
  const envSignature = buildAuthCacheSignature(resolvedEnv);

  const cachedAuth = authCache.get(database);
  if (cachedAuth && cachedAuth.envSignature === envSignature) {
    return cachedAuth.instance;
  }

  const auth = createAuthWithEnv(database, resolvedEnv);
  authCache.set(database, {
    envSignature,
    instance: auth,
  });

  return auth;
};

// Better Auth CLI needs an exported auth instance for schema generation.
export const auth = createAuthWithEnv(
  {} as D1Database,
  resolveAuthRuntimeEnv(undefined, true),
);
