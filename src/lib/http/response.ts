import { Context } from "hono";
import type { ApiErrorCode } from "../../shared/api-contracts";
import { HttpError } from "./errors";

const normalizeValue = (value: unknown): unknown => {
  if (value instanceof Date) {
    return value.getTime();
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeValue(entry));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, normalizeValue(entry)]),
    );
  }

  return value;
};

export const ok = <T>(c: Context, data: T, status = 200) => {
  return c.json({ data: normalizeValue(data) }, status as 200 | 201);
};

export const noContent = (c: Context) => {
  return c.body(null, 204);
};

const errorResponse = (
  c: Context,
  status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 422 | 429 | 500,
  code: ApiErrorCode,
  message: string,
) => {
  const requestId = (
    c as Context & {
      get: (key: "requestId") => string | undefined;
    }
  ).get?.("requestId");

  return c.json(
    {
      error: {
        code,
        message,
        requestId: requestId ?? "unknown-request-id",
      },
    },
    status,
  );
};

export const fromHttpError = (c: Context, error: HttpError) =>
  errorResponse(
    c,
    error.status,
    error.code,
    error.expose ? error.message : "서버 내부 오류가 발생했습니다.",
  );

export const badRequest = (c: Context, message: string) =>
  errorResponse(c, 400, "BAD_REQUEST", message);

export const unauthorized = (c: Context, message = "로그인이 필요합니다.") =>
  errorResponse(c, 401, "UNAUTHORIZED", message);

export const forbidden = (c: Context, message = "권한이 없습니다.") =>
  errorResponse(c, 403, "FORBIDDEN", message);

export const notFound = (c: Context, message = "대상을 찾을 수 없습니다.") =>
  errorResponse(c, 404, "NOT_FOUND", message);

export const conflict = (c: Context, message: string) =>
  errorResponse(c, 409, "CONFLICT", message);

export const payloadTooLarge = (c: Context, message: string) =>
  errorResponse(c, 413, "BAD_REQUEST", message);

export const unsupportedMediaType = (c: Context, message: string) =>
  errorResponse(c, 415, "BAD_REQUEST", message);

export const unprocessableEntity = (c: Context, message: string) =>
  errorResponse(c, 422, "BAD_REQUEST", message);

export const internalError = (
  c: Context,
  message = "서버 내부 오류가 발생했습니다.",
) => errorResponse(c, 500, "INTERNAL_ERROR", message);
