import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import type HonoAppType from "../types/honoAppType";
import type { AppBindings } from "../types/honoAppType";
import { badRequest, forbidden, noContent, notFound, ok } from "../lib/http/response";
import { parseBody } from "../lib/validation/request";
import type { AppDependencies } from "../lib/services/dependencies";
import { requireActor, requirePermission } from "../lib/http/authz";
import { recordAuditLog } from "../lib/audit";
import { respondWithPublicCache } from "../lib/http/public-cache";
import { can } from "../lib/authorization/policy";
import type { Resource, Role } from "../lib/authorization/types";
import type { AttachmentScope, CreateAttachmentInput } from "../lib/services/types";
import {
  parseManagedObjectKey,
  resolvePublicObjectBaseOrigin,
  resolvePublicObjectSigningSecrets,
  verifySignedPublicObjectSignature,
} from "../lib/storage/presign";
import {
  dataResponse,
  createdResponse,
  errorResponses,
  jsonBody,
  noContentResponse,
} from "../lib/openapi/responses";
import {
  ApiAttachmentListQuerySchema,
  ApiAttachmentSchema,
  ApiCreateAttachmentSchema,
  ApiIdParamSchema,
  ApiUpdateAttachmentSchema,
} from "../lib/openapi/schemas";
import { isHttpUrl } from "../lib/validation/url";

type App = OpenAPIHono<HonoAppType>;

// 첨부파일 권한은 scope별로 다른 리소스 정책을 따른다:
// site_donate(후원 페이지)는 site_setting(회장/부회장 전용), activity는 활동 관리 권한(운영진 이상)
const policyResourceByScope: Record<AttachmentScope, Resource> = {
  activity: "activity",
  site_donate: "site_setting",
};

const uploadPathByScope: Record<AttachmentScope, "activities" | "site"> = {
  activity: "activities",
  site_donate: "site",
};

const canManageScope = (role: Role, scope: AttachmentScope): boolean => {
  const resource = policyResourceByScope[scope];
  return can(role, resource, "create") || can(role, resource, "update");
};

/**
 * fileUrl이 유효한 공개 미디어 URL이며 해당 scope의 file 슬롯 objectKey를
 * 가리키는지 검증한다. actorId를 전달한 생성 경로에서는 발급 대상 사용자도 검증한다.
 */
const isValidManagedFileUrl = async (input: {
  fileUrl: string;
  scope: AttachmentScope;
  actorId?: string;
  env: AppBindings;
}): Promise<boolean> => {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(input.fileUrl);
  } catch {
    return false;
  }

  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    return false;
  }

  const expectedOrigin = resolvePublicObjectBaseOrigin(input.env);
  if (!expectedOrigin || parsedUrl.origin !== expectedOrigin) {
    return false;
  }

  const mediaPrefix = "/api/public/media/";
  if (!parsedUrl.pathname.startsWith(mediaPrefix)) {
    return false;
  }

  let objectKey: string;
  try {
    objectKey = parsedUrl.pathname
      .slice(mediaPrefix.length)
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/");
  } catch {
    return false;
  }

  const parsedKey = parseManagedObjectKey(objectKey);
  if (!parsedKey) {
    return false;
  }

  if (
    parsedKey.slot !== "file" ||
    parsedKey.resourcePath !== uploadPathByScope[input.scope] ||
    (input.actorId !== undefined && parsedKey.actorId !== input.actorId)
  ) {
    return false;
  }

  const signingSecrets = resolvePublicObjectSigningSecrets(input.env);
  if (signingSecrets.length === 0) {
    return false;
  }

  return verifySignedPublicObjectSignature({
    objectKey,
    signature: parsedUrl.searchParams.get("sig"),
    signingSecrets,
  });
};

const listAttachmentsRoute = createRoute({
  method: "get",
  path: "/api/attachments",
  tags: ["Attachments"],
  operationId: "listAttachments",
  security: [{ cookieAuth: [] }],
  request: {
    query: ApiAttachmentListQuerySchema,
  },
  responses: {
    200: dataResponse(ApiAttachmentSchema.array(), "첨부파일 목록 조회 성공"),
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
  },
});

const createAttachmentRoute = createRoute({
  method: "post",
  path: "/api/attachments",
  tags: ["Attachments"],
  operationId: "createAttachment",
  security: [{ cookieAuth: [] }],
  request: {
    body: jsonBody(ApiCreateAttachmentSchema, "첨부파일 등록 요청"),
  },
  responses: {
    201: createdResponse(ApiAttachmentSchema, "첨부파일 등록 성공"),
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
  },
});

const updateAttachmentRoute = createRoute({
  method: "patch",
  path: "/api/attachments/{id}",
  tags: ["Attachments"],
  operationId: "updateAttachment",
  security: [{ cookieAuth: [] }],
  request: {
    params: ApiIdParamSchema,
    body: jsonBody(ApiUpdateAttachmentSchema, "첨부파일 수정 요청"),
  },
  responses: {
    200: dataResponse(ApiAttachmentSchema, "첨부파일 수정 성공"),
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
  },
});

const deleteAttachmentRoute = createRoute({
  method: "delete",
  path: "/api/attachments/{id}",
  tags: ["Attachments"],
  operationId: "deleteAttachment",
  security: [{ cookieAuth: [] }],
  request: {
    params: ApiIdParamSchema,
  },
  responses: {
    204: noContentResponse,
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
  },
});

const listPublicAttachmentsRoute = createRoute({
  method: "get",
  path: "/api/public/attachments",
  tags: ["Public"],
  operationId: "listPublicAttachments",
  request: {
    query: ApiAttachmentListQuerySchema,
  },
  responses: {
    200: dataResponse(ApiAttachmentSchema.array(), "공개 첨부파일 목록 조회 성공"),
    400: errorResponses[400],
  },
});

export const registerAttachmentRoutes = (
  app: App,
  dependencies: AppDependencies,
) => {
  app.openapi(listAttachmentsRoute, async (c): Promise<any> => {
    const actorResult = await requireActor(c, dependencies);
    if ("response" in actorResult) {
      return actorResult.response;
    }

    const query = ApiAttachmentListQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return badRequest(c, query.error.issues[0]?.message ?? "잘못된 요청입니다.");
    }

    const denied = requirePermission(
      c,
      actorResult.actor,
      policyResourceByScope[query.data.scope],
      "read",
    );
    if (denied) {
      return denied;
    }

    const data = await dependencies
      .getDataService(c)
      .listAttachments(query.data.scope, query.data.resourceId ?? null);

    return ok(c, data);
  });

  app.openapi(createAttachmentRoute, async (c): Promise<any> => {
    const actorResult = await requireActor(c, dependencies);
    if ("response" in actorResult) {
      return actorResult.response;
    }

    const body = await parseBody(c, ApiCreateAttachmentSchema);
    if (!body.success) {
      return badRequest(c, body.message);
    }

    if (!canManageScope(actorResult.actor.role, body.data.scope)) {
      return forbidden(c);
    }

    if (body.data.scope === "activity" && !body.data.resourceId) {
      return badRequest(c, "scope=activity에는 resourceId(활동 UUID)가 필요합니다.");
    }

    const isLinkAttachment = body.data.linkUrl !== undefined;
    if (
      !isLinkAttachment &&
      !(await isValidManagedFileUrl({
        fileUrl: body.data.fileUrl ?? "",
        scope: body.data.scope,
        actorId: actorResult.actor.id,
        env: c.env,
      }))
    ) {
      return badRequest(
        c,
        "fileUrl이 올바르지 않습니다. 업로드 완료 후 발급된 공개 미디어 URL을 전달해 주세요.",
      );
    }

    const createInput: CreateAttachmentInput = {
      scope: body.data.scope,
      resourceId: body.data.resourceId ?? null,
      title: body.data.title,
      fileUrl: body.data.fileUrl ?? null,
      fileName: body.data.fileName ?? null,
      fileSize: body.data.fileSize ?? null,
      mimeType: body.data.mimeType ?? null,
      linkUrl: body.data.linkUrl ?? null,
      sortOrder: body.data.sortOrder,
    };

    const dataService = dependencies.getDataService(c);
    const data = await dataService.addAttachment(createInput);
    if (!data) {
      return notFound(c, "첨부할 활동을 찾을 수 없습니다.");
    }

    await recordAuditLog({
      dataService,
      actor: actorResult.actor,
      resourceType: "attachment",
      resourceId: data.id,
      action: "create",
      changedFields: isLinkAttachment
        ? ["title", "linkUrl"]
        : ["title", "fileUrl", "fileName", "fileSize", "mimeType"],
    });

    return ok(c, data, 201);
  });

  app.openapi(updateAttachmentRoute, async (c): Promise<any> => {
    const actorResult = await requireActor(c, dependencies);
    if ("response" in actorResult) {
      return actorResult.response;
    }

    const params = ApiIdParamSchema.safeParse(c.req.param());
    if (!params.success) {
      return badRequest(c, params.error.issues[0]?.message ?? "잘못된 요청입니다.");
    }

    const body = await parseBody(c, ApiUpdateAttachmentSchema);
    if (!body.success) {
      return badRequest(c, body.message);
    }

    const dataService = dependencies.getDataService(c);
    const existing = await dataService.getAttachmentById(params.data.id);
    if (!existing) {
      return notFound(c, "첨부파일을 찾을 수 없습니다.");
    }

    if (!canManageScope(actorResult.actor.role, existing.scope)) {
      return forbidden(c);
    }

    const data = await dataService.updateAttachment(params.data.id, body.data);
    if (!data) {
      return notFound(c, "첨부파일을 찾을 수 없습니다.");
    }

    await recordAuditLog({
      dataService,
      actor: actorResult.actor,
      resourceType: "attachment",
      resourceId: data.id,
      action: "update",
      changedFields: Object.keys(body.data).sort(),
    });

    return ok(c, data);
  });

  app.openapi(deleteAttachmentRoute, async (c): Promise<any> => {
    const actorResult = await requireActor(c, dependencies);
    if ("response" in actorResult) {
      return actorResult.response;
    }

    const params = ApiIdParamSchema.safeParse(c.req.param());
    if (!params.success) {
      return badRequest(c, params.error.issues[0]?.message ?? "잘못된 요청입니다.");
    }

    const dataService = dependencies.getDataService(c);
    const existing = await dataService.getAttachmentById(params.data.id);
    if (!existing) {
      return notFound(c, "첨부파일을 찾을 수 없습니다.");
    }

    if (!canManageScope(actorResult.actor.role, existing.scope)) {
      return forbidden(c);
    }

    const deleted = await dataService.deleteAttachment(params.data.id);
    if (!deleted) {
      return notFound(c, "첨부파일을 찾을 수 없습니다.");
    }

    await recordAuditLog({
      dataService,
      actor: actorResult.actor,
      resourceType: "attachment",
      resourceId: params.data.id,
      action: "delete",
      changedFields: ["deleted"],
    });

    return noContent(c);
  });

  app.openapi(listPublicAttachmentsRoute, async (c): Promise<any> =>
    respondWithPublicCache(c, async () => {
      const query = ApiAttachmentListQuerySchema.safeParse(c.req.query());
      if (!query.success) {
        return badRequest(c, query.error.issues[0]?.message ?? "잘못된 요청입니다.");
      }

      const dataService = dependencies.getDataService(c);
      if (query.data.scope === "activity") {
        if (!query.data.resourceId) {
          return ok(c, []);
        }

        const activity = await dataService.getActivityById(query.data.resourceId);
        if (!activity) {
          return ok(c, []);
        }
      }

      const data = await dataService.listAttachments(
        query.data.scope,
        query.data.resourceId ?? null,
      );

      const publicVisibility = await Promise.all(
        data.map(async (attachment) => {
          if (attachment.linkUrl !== null) {
            return isHttpUrl(attachment.linkUrl);
          }

          if (attachment.fileUrl === null) {
            return false;
          }

          return isValidManagedFileUrl({
            fileUrl: attachment.fileUrl,
            scope: attachment.scope,
            env: c.env,
          });
        }),
      );

      return ok(c, data.filter((_, index) => publicVisibility[index]));
    }),
  );
};
