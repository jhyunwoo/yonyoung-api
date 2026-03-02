import type { AppBindings } from "../../types/honoAppType";

export type AuthRuntimeEnv = {
  baseURL: string;
  secret: string;
  trustedOrigins: string[];
  googleClientId: string;
  googleClientSecret: string;
  emailAndPasswordEnabled: boolean;
};

const AUTH_DEV_DEFAULTS = {
  baseURL: "http://localhost:8787",
  secret: "replace-with-a-long-development-secret-at-least-32-characters",
  trustedOrigins: "http://localhost:3000",
  googleClientId: "replace-with-google-client-id",
  googleClientSecret: "replace-with-google-client-secret",
} as const;

const trimToUndefined = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const readBindingValue = (
  env: Partial<AppBindings> | undefined,
  key: keyof AppBindings,
): string | undefined => {
  return trimToUndefined(env?.[key]);
};

const readProcessValue = (key: string): string | undefined => {
  return trimToUndefined(process.env[key]);
};

const readRuntimeString = (
  env: Partial<AppBindings> | undefined,
  key: keyof AppBindings,
  fallback?: string,
): string => {
  const fromBinding = readBindingValue(env, key);
  if (fromBinding) {
    return fromBinding;
  }

  const fromProcess = readProcessValue(key);
  if (fromProcess) {
    return fromProcess;
  }

  const fallbackValue = trimToUndefined(fallback);
  if (fallbackValue) {
    return fallbackValue;
  }

  throw new Error(`${String(key)} is not set`);
};

const parseCsv = (value: string): string[] => {
  return [
    ...new Set(
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ];
};

const parseBooleanString = (
  value: string | undefined,
  fallback = false,
): boolean => {
  if (!value) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
};

export const resolveAuthRuntimeEnv = (
  env: Partial<AppBindings> | undefined,
  allowDevDefaults: boolean,
): AuthRuntimeEnv => {
  const baseURL = readRuntimeString(
    env,
    "BETTER_AUTH_URL",
    allowDevDefaults ? AUTH_DEV_DEFAULTS.baseURL : undefined,
  );

  const trustedOriginsRaw = readRuntimeString(
    env,
    "BETTER_AUTH_TRUSTED_ORIGINS",
    allowDevDefaults ? AUTH_DEV_DEFAULTS.trustedOrigins : undefined,
  );

  const trustedOrigins = parseCsv(trustedOriginsRaw);
  if (!trustedOrigins.includes(baseURL)) {
    trustedOrigins.push(baseURL);
  }

  const emailAndPasswordEnabled = parseBooleanString(
    readBindingValue(env, "BETTER_AUTH_EMAIL_AND_PASSWORD_ENABLED") ??
      readProcessValue("BETTER_AUTH_EMAIL_AND_PASSWORD_ENABLED"),
    false,
  );

  return {
    baseURL,
    secret: readRuntimeString(
      env,
      "BETTER_AUTH_SECRET",
      allowDevDefaults ? AUTH_DEV_DEFAULTS.secret : undefined,
    ),
    trustedOrigins,
    googleClientId: readRuntimeString(
      env,
      "GOOGLE_CLIENT_ID",
      allowDevDefaults ? AUTH_DEV_DEFAULTS.googleClientId : undefined,
    ),
    googleClientSecret: readRuntimeString(
      env,
      "GOOGLE_CLIENT_SECRET",
      allowDevDefaults ? AUTH_DEV_DEFAULTS.googleClientSecret : undefined,
    ),
    emailAndPasswordEnabled,
  };
};

export const resolveDocsAuthEnabled = (
  env: Partial<AppBindings> | undefined,
): boolean =>
  parseBooleanString(
    readBindingValue(env, "DOCS_AUTH_IN_PROD") ?? readProcessValue("DOCS_AUTH_IN_PROD"),
    false,
  );
