import type { ErrorHandler } from "hono";
import { fromHttpError, internalError } from "../lib/http/response";
import { HttpError, isHttpError } from "../lib/http/errors";
import { logError } from "./logger";
import type HonoAppType from "../types/honoAppType";

const MALFORMED_JSON_MESSAGES = [
  "Unexpected end of JSON input",
  "JSON",
  "Malformed JSON",
];

const looksLikeMalformedJson = (error: Error): boolean => {
  return MALFORMED_JSON_MESSAGES.some((needle) => error.message.includes(needle));
};

export const errorHandler: ErrorHandler<HonoAppType> = (error, c) => {
  if (isHttpError(error)) {
    if (error.status >= 500) {
      logError(c, error);
    }

    return fromHttpError(c, error);
  }

  if (error instanceof Error && looksLikeMalformedJson(error)) {
    return fromHttpError(c, HttpError.badRequest("Malformed JSON body"));
  }

  logError(c, error);
  return internalError(c);
};
