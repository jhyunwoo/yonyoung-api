import type { Context } from "hono";
import { can } from "../../lib/authorization/policy";
import type { Action, Actor, Resource } from "../../lib/authorization/types";
import type { AppDependencies } from "../../lib/services/dependencies";

/** actor 해석에 필요한 것만 받는다. 라우트 가드는 나머지 의존성을 알 필요가 없다. */
export type ActorDependencies = Pick<AppDependencies, "resolveActor">;
import type HonoAppType from "../../types/honoAppType";
import { AppError } from "../errors/AppError";

/**
 * 세션에서 actor를 확정한다. 인증되지 않았으면 AppError를 던져 전역 errorHandler가
 * 표준 에러 봉투로 직렬화하게 한다.
 *
 * `requireActor`(Response 반환형)와 응답 내용은 동일하지만, 던지는 쪽은 핸들러 반환 타입이
 * route contract의 성공 응답으로 좁혀지므로 `Promise<any>` 주석이 필요 없다.
 */
export const requireAuthenticatedActor = async (
  c: Context<HonoAppType>,
  dependencies: ActorDependencies,
): Promise<Actor> => {
  const existingActor = c.get("actor");
  const actorResolved = c.get("actorResolved");
  let actor = existingActor;

  if (!actor && !actorResolved) {
    try {
      actor = await dependencies.resolveActor(c);
    } catch {
      // 세션 조회 실패는 미인증과 동일하게 취급한다(fail-closed).
      actor = null;
    }
    c.set("actorResolved", true);
  }

  if (!actor) {
    throw AppError.unauthorized();
  }

  c.set("actor", actor);
  return actor;
};

export const assertPermission = (
  actor: Actor,
  resource: Resource,
  action: Action,
): void => {
  if (!can(actor.role, resource, action)) {
    throw AppError.forbidden();
  }
};

export const assertCondition = (
  condition: boolean,
  error: () => AppError,
): void => {
  if (!condition) {
    throw error();
  }
};
