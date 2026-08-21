import { type OpenAPIHono } from "@hono/zod-openapi";
import { createAuth } from "../../lib/auth";
import { resolveD1Database } from "../../infra/db/client";
import type HonoAppType from "../../types/honoAppType";

type App = OpenAPIHono<HonoAppType>;

export function registerAuthRoutes(app: App) {
  app.on(["GET", "POST"], "/api/auth/*", async (c) => {
    const requestOrigin = new URL(c.req.url).origin;
    const auth = createAuth(resolveD1Database(c.env), {
      ...c.env,
      BETTER_AUTH_URL: requestOrigin,
    });
    return auth.handler(c.req.raw);
  });
}
