import type { Context } from "hono";
import type { z } from "../openapi/zod";

type ValidationTarget =
  "json" | "form" | "query" | "param" | "header" | "cookie";

/**
 * `@hono/zod-openapi`의 `c.req.valid()`는 라우트 제네릭이 너무 복잡해 호출부에서 `any`로 무너진다.
 * 그대로 쓰면 핸들러 전체가 타입 검사를 잃으므로, 라우트가 선언한 스키마를 명시적으로 넘겨
 * 검증된 입력을 스키마 타입으로 되돌린다.
 *
 * 런타임 재검증은 하지 않는다. 이 값은 이미 라우트 validator를 통과했고, 다시 파싱하면
 * 검증 경로가 두 개가 되어 에러 응답 형식이 갈라진다.
 */
export const readValidated = <TSchema extends z.ZodType>(
  c: Context,
  target: ValidationTarget,
  _contract: TSchema,
): z.output<TSchema> => {
  const request = c.req as unknown as {
    valid: (target: ValidationTarget) => unknown;
  };
  return request.valid(target) as z.output<TSchema>;
};
