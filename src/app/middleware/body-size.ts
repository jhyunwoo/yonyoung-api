import type { MiddlewareHandler } from "hono";
import type HonoAppType from "../../types/honoAppType";
import { AppError } from "../../shared/errors/AppError";

const DEFAULT_MAX_BODY_BYTES = 5 * 1024 * 1024;
const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);

const payloadTooLargeError = (maxBytes: number): AppError =>
  AppError.payloadTooLarge(
    `요청 본문이 허용된 최대 크기(${maxBytes} bytes)를 초과했습니다.`,
  );

const readContentLength = (request: Request): number | null => {
  const header = request.headers.get("content-length");
  if (!header) {
    return null;
  }

  const parsed = Number(header);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

export const createMaxBodySizeMiddleware = (
  maxBytes = DEFAULT_MAX_BODY_BYTES,
): MiddlewareHandler<HonoAppType> => {
  return async (c, next) => {
    if (!BODY_METHODS.has(c.req.method.toUpperCase())) {
      await next();
      return;
    }

    const request = c.req.raw;
    const contentLength = readContentLength(request);
    if (contentLength !== null && contentLength > maxBytes) {
      await request.body?.cancel().catch(() => undefined);
      throw payloadTooLargeError(maxBytes);
    }

    if (!request.body) {
      await next();
      return;
    }

    // Request.clone() tees the stream. Reading the clone lets us count the
    // actual bytes while leaving both c.req.raw and Hono's body helpers intact
    // for downstream handlers. The accepted branch is bounded by maxBytes.
    const reader = request.clone().body!.getReader();
    let receivedBytes = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        receivedBytes += value.byteLength;
        if (receivedBytes > maxBytes) {
          // Cancel both tee branches concurrently. Waiting for only one branch
          // first can leave the tee cancellation promise unresolved.
          await Promise.allSettled([
            reader.cancel(),
            request.body.cancel(),
          ]);
          throw payloadTooLargeError(maxBytes);
        }
      }
    } finally {
      reader.releaseLock();
    }

    await next();
  };
};

export const maxBodySizeMiddleware = createMaxBodySizeMiddleware();
