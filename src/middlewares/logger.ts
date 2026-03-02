import type { MiddlewareHandler } from "hono";
import type HonoAppType from "../types/honoAppType";

const SENSITIVE_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "proxy-authorization",
]);

const redactHeaders = (headers: Headers): Record<string, string> => {
  const selected = [
    "user-agent",
    "content-type",
    "cf-connecting-ip",
    "cf-ray",
    "authorization",
    "cookie",
  ];
  const snapshot: Record<string, string> = {};

  for (const key of selected) {
    const value = headers.get(key);
    if (!value) {
      continue;
    }

    snapshot[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) ? "[REDACTED]" : value;
  }

  return snapshot;
};

const logLine = (entry: Record<string, unknown>) => {
  console.log(JSON.stringify(entry));
};

const sanitizeErrorMessage = (message: string): string => {
  return message
    .replace(
      /(authorization|cookie|token|secret|password)\s*[:=]\s*([^\n\r,;]+)/gi,
      (_match, key: string) => `${key}=[REDACTED]`,
    )
    .replace(/bearer\s+[a-z0-9._-]+/gi, "Bearer [REDACTED]");
};

const resolveExecutionContext = (
  c: { executionCtx?: ExecutionContext },
): ExecutionContext | undefined => {
  try {
    return c.executionCtx;
  } catch {
    return undefined;
  }
};

const readRequestId = (c: {
  get: (key: "requestId") => string;
}): string => c.get("requestId");

const enqueueLog = (
  c: {
    executionCtx?: ExecutionContext;
  },
  entry: Record<string, unknown>,
) => {
  const task = Promise.resolve().then(() => {
    logLine(entry);
  });

  const executionCtx = resolveExecutionContext(c);
  if (executionCtx && typeof executionCtx.waitUntil === "function") {
    executionCtx.waitUntil(task);
    return;
  }

  void task;
};

export const loggerMiddleware: MiddlewareHandler<HonoAppType> = async (
  c,
  next,
) => {
  const startedAt = c.get("startedAt") ?? performance.now();
  const requestId = c.get("requestId");

  enqueueLog(c, {
    level: "info",
    event: "request.received",
    timestamp: new Date().toISOString(),
    requestId,
    method: c.req.method,
    route: c.req.path,
    headers: redactHeaders(c.req.raw.headers),
  });

  try {
    await next();
  } finally {
    const latencyMs = performance.now() - startedAt;

    enqueueLog(c, {
      level: "info",
      event: "request.completed",
      timestamp: new Date().toISOString(),
      requestId,
      method: c.req.method,
      route: c.req.path,
      status: c.res.status,
      latencyMs: Number(latencyMs.toFixed(2)),
      cacheStatus: c.get("cacheStatus") ?? null,
    });
  }
};

export const logError = (
  c: {
    req: { method: string; path: string };
    get: (key: "requestId") => string;
    executionCtx?: ExecutionContext;
  },
  error: unknown,
) => {
  const message = error instanceof Error ? error.message : String(error);

  enqueueLog(c, {
    level: "error",
    event: "request.failed",
    timestamp: new Date().toISOString(),
    requestId: readRequestId(c),
    method: c.req.method,
    route: c.req.path,
    message: sanitizeErrorMessage(message),
  });
};
