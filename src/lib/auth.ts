import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { openAPI } from "better-auth/plugins";
import { betterAuth } from "better-auth";
import * as schema from "./db/schema";
import createDB from "./db";
import type { AppBindings } from "../types/honoAppType";
import { resolveAuthRuntimeEnv, type AuthRuntimeEnv } from "./config/runtime-env";

const LOCAL_HOSTNAME = "localhost";

const isIpHostname = (hostname: string): boolean => {
  return /^[0-9.]+$/.test(hostname) || hostname.includes(":");
};

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

    return labels.slice(1).join(".");
  } catch {
    return undefined;
  }
};

const createAuthWithEnv = (database: D1Database, env: AuthRuntimeEnv) => {
  const db = createDB(database);
  const crossSubDomainCookieDomain = resolveCrossSubDomainCookieDomain(
    env.baseURL,
  );

  return betterAuth({
    baseURL: env.baseURL,
    basePath: "/api/auth",
    secret: env.secret,
    trustedOrigins: env.trustedOrigins,
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema,
    }),
    socialProviders: {
      google: {
        clientId: env.googleClientId,
        clientSecret: env.googleClientSecret,
      },
    },
    emailAndPassword: {
      enabled: env.emailAndPasswordEnabled,
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
      crossSubDomainCookies: {
        enabled: !!crossSubDomainCookieDomain,
        ...(crossSubDomainCookieDomain
          ? { domain: crossSubDomainCookieDomain }
          : {}),
      },
      useSecureCookies: env.baseURL.startsWith("https://"),
    },
  });
};

export const getAuthCorsOrigins = (env?: Partial<AppBindings>): string[] => {
  return resolveAuthRuntimeEnv(env, true).trustedOrigins;
};

type AuthCacheEntry = {
  envSignature: string;
  instance: ReturnType<typeof betterAuth>;
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

export const createAuth = (database: D1Database, env?: Partial<AppBindings>) => {
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
