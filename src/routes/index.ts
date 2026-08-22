import { OpenAPIHono, type OpenAPIHonoOptions } from "@hono/zod-openapi";
import { registerActivityRoutes } from "../features/activities/activity.routes";
import { registerAttachmentRoutes } from "../features/attachments/attachment.routes";
import { registerAuditRoutes } from "../features/audit/audit.routes";
import { registerAuthRoutes } from "../features/auth/auth.routes";
import { registerDashboardRoutes } from "../features/dashboard/dashboard.routes";
import { registerDocsRoutes } from "../app/docs/docs.routes";
import { registerExhibitionRoutes } from "../features/exhibitions/exhibition.routes";
import { registerGenerationRoutes } from "../features/generations/generation.routes";
import { registerLinktreeRoutes } from "../features/linktree/linktree.routes";
import { registerPageViewRoutes } from "../features/page-views/page-view.routes";
import { registerPublicRoutes } from "../features/public/public.routes";
import { registerRecruitingPlanRoutes } from "../features/recruiting-plan/recruiting-plan.routes";
import { registerSiteSettingsRoutes } from "../features/site-settings/site-settings.routes";
import { registerUploadRoutes } from "../features/uploads/upload.routes";
import { registerUserRoutes } from "../features/users/user.routes";
import type { AppDependencies } from "../lib/services/dependencies";
import type HonoAppType from "../types/honoAppType";

const createDomainRouter = (
  register: (router: OpenAPIHono<HonoAppType>) => void,
  defaultHook: OpenAPIHonoOptions<HonoAppType>["defaultHook"],
): OpenAPIHono<HonoAppType> => {
  const router = new OpenAPIHono<HonoAppType>({ defaultHook });
  register(router);
  return router;
};

const mountDomainRouter = (
  app: OpenAPIHono<HonoAppType>,
  router: OpenAPIHono<HonoAppType>,
) => {
  app.route("/", router);
  app.openAPIRegistry.definitions.push(...router.openAPIRegistry.definitions);
};

export const mountDomainRouters = (
  app: OpenAPIHono<HonoAppType>,
  dependencies: AppDependencies,
  defaultHook: OpenAPIHonoOptions<HonoAppType>["defaultHook"],
) => {
  mountDomainRouter(
    app,
    createDomainRouter((router) => {
      registerAuthRoutes(router);
    }, defaultHook),
  );

  mountDomainRouter(
    app,
    createDomainRouter((router) => {
      registerGenerationRoutes(router, dependencies);
      registerActivityRoutes(router, dependencies);
      registerExhibitionRoutes(router, dependencies);
      registerLinktreeRoutes(router, dependencies);
      registerUserRoutes(router, dependencies);
      registerSiteSettingsRoutes(router, dependencies);
      registerAttachmentRoutes(router, dependencies);
      registerRecruitingPlanRoutes(router, dependencies);
      registerDashboardRoutes(router, dependencies);
      registerAuditRoutes(router, dependencies);
    }, defaultHook),
  );

  mountDomainRouter(
    app,
    createDomainRouter((router) => {
      registerUploadRoutes(router, dependencies);
      registerPublicRoutes(router, dependencies);
      registerPageViewRoutes(router, dependencies);
    }, defaultHook),
  );

  registerDocsRoutes(app, dependencies);
};
