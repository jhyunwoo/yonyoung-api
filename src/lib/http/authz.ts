import { type Context } from "hono";
import { can } from "../authorization/policy";
import { type Action, type Actor, type Resource } from "../authorization/types";
import { unauthorized, forbidden } from "./response";
import type HonoAppType from "../../types/honoAppType";
import { type ActorDependencies } from "../../shared/http/route-guards";

export const requireActor = async (
  c: Context<HonoAppType>,
  dependencies: ActorDependencies,
): Promise<{ actor: Actor } | { response: Response }> => {
  const existingActor = c.get("actor");
  const actorResolved = c.get("actorResolved");
  let actor = existingActor;

  if (!actor && !actorResolved) {
    try {
      actor = await dependencies.resolveActor(c);
    } catch {
      actor = null;
    }
    c.set("actorResolved", true);
  }

  if (!actor) {
    return { response: unauthorized(c) };
  }
  c.set("actor", actor);
  return { actor };
};

export const requirePermission = (
  c: Context<HonoAppType>,
  actor: Actor,
  resource: Resource,
  action: Action,
): Response | null => {
  if (!can(actor.role, resource, action)) {
    return forbidden(c);
  }
  return null;
};
