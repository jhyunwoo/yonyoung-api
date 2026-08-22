import type { Context } from "hono";
import type { ZodType } from "zod";
import { AppError } from "../../shared/errors/AppError";

type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; message: string };

const createErrorMessage = (error: unknown) => {
  if (error && typeof error === "object" && "issues" in error) {
    const issues = (error as { issues?: Array<{ message?: string }> }).issues;
    if (issues && issues.length > 0) {
      return issues.map((issue) => issue.message ?? "유효성 검사 실패").join(", ");
    }
  }

  return "요청 데이터가 올바르지 않습니다.";
};

export const parseParams = <T>(
  c: Context,
  schema: ZodType<T>,
): ParseResult<T> => {
  const parsed = schema.safeParse(c.req.param());
  if (!parsed.success) {
    return { success: false, message: createErrorMessage(parsed.error) };
  }
  return { success: true, data: parsed.data };
};

export const parseBody = async <T>(
  c: Context,
  schema: ZodType<T>,
  options?: {
    maxBytes?: number;
  },
): Promise<ParseResult<T>> => {
  const maxBytes = options?.maxBytes ?? 5 * 1024 * 1024;
  const contentLengthHeader = c.req.header("content-length");
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw AppError.payloadTooLarge(
        `요청 본문이 허용된 최대 크기(${maxBytes} bytes)를 초과했습니다.`,
      );
    }
  }

  const encoder = new TextEncoder();
  let rawText: string;
  try {
    rawText = await c.req.text();
  } catch {
    return { success: false, message: "Malformed JSON in request body" };
  }

  if (!rawText || rawText.trim().length === 0) {
    return { success: false, message: "JSON 본문이 필요합니다." };
  }

  const bytes = encoder.encode(rawText).byteLength;
  if (bytes > maxBytes) {
    throw AppError.payloadTooLarge(
      `요청 본문이 허용된 최대 크기(${maxBytes} bytes)를 초과했습니다.`,
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(rawText);
  } catch {
    return { success: false, message: "Malformed JSON in request body" };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, message: createErrorMessage(parsed.error) };
  }

  return { success: true, data: parsed.data };
};
