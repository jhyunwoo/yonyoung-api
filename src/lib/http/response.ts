import { type Context } from "hono";
import { AppError } from "../../shared/errors/AppError";
import { toErrorResponse } from "../../shared/errors/httpProblem";
import { type HttpError } from "./errors";

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

/**
 * JSON 직렬화 후의 응답 모양. `normalizeValue`가 Date를 epoch ms로 바꾸므로
 * OpenAPI 스키마(timestamp = number)와 같은 타입이 된다.
 */
export type SerializedResponseBody<T> = T extends Date
  ? number
  : T extends (infer U)[]
    ? SerializedResponseBody<U>[]
    : T extends object
      ? { [K in keyof T]: SerializedResponseBody<T[K]> }
      : T;

export const ok = <T, TStatus extends 200 | 201 = 200>(
  c: Context,
  data: T,
  status: TStatus = 200 as TStatus,
) => {
  return c.json(
    { data: normalizeValue(data) as SerializedResponseBody<T> },
    status,
  );
};

export const noContent = (c: Context) => {
  return c.body(null, 204);
};

const respondWithAppError = (c: Context, error: AppError): Response => {
  return toErrorResponse(c, error);
};

export const fromHttpError = (c: Context, error: HttpError) =>
  respondWithAppError(c, error);

export const badRequest = (c: Context, message: string) =>
  respondWithAppError(c, AppError.badRequest(message));

export const unauthorized = (c: Context, message = "로그인이 필요합니다.") =>
  respondWithAppError(c, AppError.unauthorized(message));

export const forbidden = (c: Context, message = "권한이 없습니다.") =>
  respondWithAppError(c, AppError.forbidden(message));

export const notFound = (c: Context, message = "대상을 찾을 수 없습니다.") =>
  respondWithAppError(c, AppError.notFound(message));

export const conflict = (c: Context, message: string) =>
  respondWithAppError(c, AppError.conflict(message));

export const payloadTooLarge = (c: Context, message: string) =>
  respondWithAppError(c, AppError.payloadTooLarge(message));

export const unsupportedMediaType = (c: Context, message: string) =>
  respondWithAppError(c, AppError.unsupportedMediaType(message));

export const unprocessableEntity = (c: Context, message: string) =>
  respondWithAppError(
    c,
    new AppError({
      httpStatus: 422,
      code: "BAD_REQUEST",
      message,
    }),
  );

export const internalError = (
  c: Context,
  message = "서버 내부 오류가 발생했습니다.",
) =>
  respondWithAppError(
    c,
    message === "서버 내부 오류가 발생했습니다."
      ? AppError.internal(message)
      : new AppError({
          httpStatus: 500,
          code: "INTERNAL_ERROR",
          message,
          expose: true,
        }),
  );
