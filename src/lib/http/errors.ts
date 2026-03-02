import type { ApiErrorCode } from "../../shared/api-contracts";

type HttpErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 415 | 422 | 429 | 500;

export class HttpError extends Error {
  readonly status: HttpErrorStatus;
  readonly code: ApiErrorCode;
  readonly expose: boolean;

  constructor(options: {
    status: HttpErrorStatus;
    code: ApiErrorCode;
    message: string;
    expose?: boolean;
  }) {
    super(options.message);
    this.name = "HttpError";
    this.status = options.status;
    this.code = options.code;
    this.expose = options.expose ?? options.status < 500;
  }

  static badRequest(message: string): HttpError {
    return new HttpError({
      status: 400,
      code: "BAD_REQUEST",
      message,
    });
  }

  static unauthorized(message = "로그인이 필요합니다."): HttpError {
    return new HttpError({
      status: 401,
      code: "UNAUTHORIZED",
      message,
    });
  }

  static forbidden(message = "권한이 없습니다."): HttpError {
    return new HttpError({
      status: 403,
      code: "FORBIDDEN",
      message,
    });
  }

  static notFound(message = "대상을 찾을 수 없습니다."): HttpError {
    return new HttpError({
      status: 404,
      code: "NOT_FOUND",
      message,
    });
  }

  static conflict(message: string): HttpError {
    return new HttpError({
      status: 409,
      code: "CONFLICT",
      message,
    });
  }

  static internal(message = "서버 내부 오류가 발생했습니다."): HttpError {
    return new HttpError({
      status: 500,
      code: "INTERNAL_ERROR",
      message,
      expose: false,
    });
  }
}

export const isHttpError = (error: unknown): error is HttpError =>
  error instanceof HttpError;
