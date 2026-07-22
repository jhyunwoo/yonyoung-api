import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  ApiActivitySchema,
  ApiExhibitionSchema,
  ApiGenerationSchema,
  ApiIdParamSchema,
  ApiLinktreeSchema,
  ApiPublicGenerationWithMembersSchema,
  ApiRecruitingPlanSchema,
  ApiRecordViewBodySchema,
  ApiSiteSettingsSchema,
  ApiViewCountsQuerySchema,
  ApiViewCountsResponseSchema,
} from "../lib/openapi/schemas";
import {
  dataResponse,
  errorResponses,
  noContentResponse,
  jsonBody,
} from "../lib/openapi/responses";
import { badRequest, internalError, noContent, notFound, ok } from "../lib/http/response";
import { respondWithPublicCache } from "../lib/http/public-cache";
import { AppDependencies } from "../lib/services/dependencies";
import HonoAppType from "../types/honoAppType";
import { sanitizeRichTextHtml } from "../lib/content/rich-text";
import { sanitizeExhibitionRichText } from "../lib/content/exhibition-rich-text";
import { createR2Client, resolveR2Bucket } from "../infra/r2/client";
import {
  ALLOWED_ATTACHMENT_CONTENT_TYPES,
  ALLOWED_IMAGE_CONTENT_TYPES,
  parseManagedObjectKey,
  resolvePublicObjectSigningSecrets,
  verifySignedPublicObjectSignature,
} from "../lib/storage/presign";
import {
  isEntityPageViewType,
  normalizePageViewResourceId,
} from "../lib/views/page-view-target";
import { isHttpUrl } from "../lib/validation/url";
import { DEFAULT_SITE_SETTINGS } from "../shared/api-contracts";

type App = OpenAPIHono<HonoAppType>;
const PUBLIC_MEDIA_CACHE_CONTROL =
  "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";
const VIEW_COUNTS_CACHE_CONTROL = "no-store, no-cache, must-revalidate";
const ViewResourceIdSchema = z.string().uuid();
const sanitizeExhibitionDescriptionField = <T extends { description: string }>(
  exhibition: T,
): T => ({
  ...exhibition,
  description: sanitizeExhibitionRichText(exhibition.description),
});

const sanitizeActivityDescriptionField = <T extends { description: string }>(
  activity: T,
): T => ({
  ...activity,
  description: sanitizeRichTextHtml(activity.description),
});

type PublicMediaEntity = {
  coverImageUrl: string;
  detailImages: Array<{ imageUrl: string }>;
};

const sanitizePublicMediaUrls = <T extends PublicMediaEntity>(
  entity: T,
): T | null => {
  if (!isHttpUrl(entity.coverImageUrl)) {
    return null;
  }

  return {
    ...entity,
    detailImages: entity.detailImages.filter((image) =>
      isHttpUrl(image.imageUrl),
    ),
  };
};

const sanitizePublicActivity = <
  T extends PublicMediaEntity & { description: string },
>(
  activity: T,
): T | null => {
  const sanitized = sanitizePublicMediaUrls(activity);
  return sanitized ? sanitizeActivityDescriptionField(sanitized) : null;
};

const sanitizePublicExhibition = <
  T extends PublicMediaEntity & { description: string },
>(
  exhibition: T,
): T | null => {
  const sanitized = sanitizePublicMediaUrls(exhibition);
  return sanitized ? sanitizeExhibitionDescriptionField(sanitized) : null;
};

const sanitizePublicLinktree = <
  T extends { items: Array<{ link: string }> },
>(
  linktree: T,
): T => ({
  ...linktree,
  // 기존 데이터에 남아 있을 수 있는 실행 가능 URL 스킴을 공개 링크로 재노출하지 않는다.
  items: linktree.items.filter((item) => isHttpUrl(item.link)),
});

const sanitizePublicSiteSettings = <T extends { footerOpenChatUrl: string }>(
  settings: T,
): T => ({
  ...settings,
  footerOpenChatUrl: isHttpUrl(settings.footerOpenChatUrl)
    ? settings.footerOpenChatUrl
    : DEFAULT_SITE_SETTINGS.footerOpenChatUrl,
});

const sanitizePublicRecruitingPlan = <
  T extends { content: string; promotionImageUrls: string[] },
>(
  plan: T,
): T => ({
  ...plan,
  content: sanitizeRichTextHtml(plan.content),
  promotionImageUrls: plan.promotionImageUrls.filter(isHttpUrl),
});

const CONTENT_TYPE_BY_EXTENSION = {
  avif: "image/avif",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
} satisfies Record<
  string,
  (typeof ALLOWED_IMAGE_CONTENT_TYPES)[number]
>;

const ATTACHMENT_CONTENT_TYPE_BY_EXTENSION = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  hwp: "application/x-hwp",
  hwpx: "application/vnd.hancom.hwpx",
  zip: "application/zip",
} satisfies Record<
  string,
  (typeof ALLOWED_ATTACHMENT_CONTENT_TYPES)[number]
>;

type ResolvedPublicMediaContentType = {
  contentType: string;
  // 문서류 첨부는 인라인 렌더링 대신 다운로드(Content-Disposition: attachment)로 응답한다
  isAttachment: boolean;
};

const resolvePublicMediaContentType = (
  objectKey: string,
  metadataContentType: string | null | undefined,
): ResolvedPublicMediaContentType | null => {
  const normalizedContentType = metadataContentType?.trim().toLowerCase();
  if (normalizedContentType) {
    if (
      ALLOWED_IMAGE_CONTENT_TYPES.includes(
        normalizedContentType as (typeof ALLOWED_IMAGE_CONTENT_TYPES)[number],
      )
    ) {
      return { contentType: normalizedContentType, isAttachment: false };
    }

    if (
      ALLOWED_ATTACHMENT_CONTENT_TYPES.includes(
        normalizedContentType as (typeof ALLOWED_ATTACHMENT_CONTENT_TYPES)[number],
      )
    ) {
      return { contentType: normalizedContentType, isAttachment: true };
    }
  }

  const fileName = objectKey.split("/").at(-1)?.toLowerCase() ?? "";
  const extension = fileName.split(".").at(-1);
  if (!extension) {
    return null;
  }

  if (extension in CONTENT_TYPE_BY_EXTENSION) {
    return {
      contentType:
        CONTENT_TYPE_BY_EXTENSION[extension as keyof typeof CONTENT_TYPE_BY_EXTENSION],
      isAttachment: false,
    };
  }

  if (extension in ATTACHMENT_CONTENT_TYPE_BY_EXTENSION) {
    return {
      contentType:
        ATTACHMENT_CONTENT_TYPE_BY_EXTENSION[
          extension as keyof typeof ATTACHMENT_CONTENT_TYPE_BY_EXTENSION
        ],
      isAttachment: true,
    };
  }

  return null;
};

// objectKey의 fileToken(`{uuid}-{safeFileName}`)에서 uuid 접두어를 제거해 다운로드 파일명을 만든다
const buildAttachmentDownloadName = (fileToken: string): string => {
  const stripped = fileToken.replace(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i,
    "",
  );
  return stripped.length > 0 ? stripped : fileToken;
};

const listPublicActivitiesRoute = createRoute({
  method: "get",
  path: "/api/public/activities",
  tags: ["Public"],
  operationId: "listPublicActivities",
  responses: {
    200: dataResponse(ApiActivitySchema.array(), "공개 활동 목록 조회 성공"),
  },
});

const listPublicExhibitionsRoute = createRoute({
  method: "get",
  path: "/api/public/exhibitions",
  tags: ["Public"],
  operationId: "listPublicExhibitions",
  responses: {
    200: dataResponse(ApiExhibitionSchema.array(), "공개 전시 목록 조회 성공"),
  },
});

const getPublicActivityByIdRoute = createRoute({
  method: "get",
  path: "/api/public/activities/{id}",
  tags: ["Public"],
  operationId: "getPublicActivityById",
  request: {
    params: ApiIdParamSchema,
  },
  responses: {
    200: dataResponse(ApiActivitySchema, "공개 활동 상세 조회 성공"),
    400: errorResponses[400],
    404: errorResponses[404],
  },
});

const getPublicExhibitionByIdRoute = createRoute({
  method: "get",
  path: "/api/public/exhibitions/{id}",
  tags: ["Public"],
  operationId: "getPublicExhibitionById",
  request: {
    params: ApiIdParamSchema,
  },
  responses: {
    200: dataResponse(ApiExhibitionSchema, "공개 전시 상세 조회 성공"),
    400: errorResponses[400],
    404: errorResponses[404],
  },
});

const listPublicLinktreeRoute = createRoute({
  method: "get",
  path: "/api/public/linktree",
  tags: ["Public"],
  operationId: "listPublicLinktree",
  responses: {
    200: dataResponse(ApiLinktreeSchema.array(), "공개 링크트리 목록 조회 성공"),
  },
});

const getPublicSiteSettingsRoute = createRoute({
  method: "get",
  path: "/api/public/site-settings",
  tags: ["Public"],
  operationId: "getPublicSiteSettings",
  responses: {
    200: dataResponse(ApiSiteSettingsSchema, "공개 사이트 기본 설정 조회 성공"),
  },
});

const getPublicCurrentRecruitingPlanRoute = createRoute({
  method: "get",
  path: "/api/public/recruiting-plan/current",
  tags: ["Public"],
  operationId: "getPublicCurrentRecruitingPlan",
  responses: {
    200: dataResponse(
      ApiRecruitingPlanSchema.nullable(),
      "공개 현재 연도 모집 계획 조회 성공",
    ),
  },
});

const listPublicGenerationsRoute = createRoute({
  method: "get",
  path: "/api/public/generations",
  tags: ["Public"],
  operationId: "listPublicGenerations",
  responses: {
    200: dataResponse(ApiGenerationSchema.array(), "공개 기수 목록 조회 성공"),
  },
});

const listPublicPhotographersRoute = createRoute({
  method: "get",
  path: "/api/public/photographers",
  tags: ["Public"],
  operationId: "listPublicPhotographers",
  responses: {
    200: dataResponse(
      ApiPublicGenerationWithMembersSchema.array(),
      "공개 기수별 사진가 목록 조회 성공",
    ),
  },
});

const recordViewRoute = createRoute({
  method: "post",
  path: "/api/public/views",
  tags: ["Public"],
  operationId: "recordView",
  request: {
    body: jsonBody(ApiRecordViewBodySchema, "조회수 기록 요청 본문"),
  },
  responses: {
    204: noContentResponse,
    400: errorResponses[400],
  },
});

const getViewCountsRoute = createRoute({
  method: "get",
  path: "/api/public/views",
  tags: ["Public"],
  operationId: "getViewCounts",
  request: {
    query: ApiViewCountsQuerySchema,
  },
  responses: {
    200: dataResponse(ApiViewCountsResponseSchema, "조회수 일괄 조회 성공"),
    400: errorResponses[400],
  },
});

/**
 * registerPublicRoutes 생성/등록 절차를 수행해 시스템 상태를 갱신합니다.
 * @param app 함수 로직에서 사용하는 입력값입니다.
 * @param dependencies 함수 로직에서 사용하는 입력값입니다.
 * @returns 처리 결과 값을 반환합니다.
 * @remarks 호출부와의 계약(입력 검증, null 처리, 에러 전파 규칙)을 일관되게 유지해야 합니다.
 */
export const registerPublicRoutes = (
  app: App,
  dependencies: AppDependencies,
) => {
  app.get("/api/public/media/:objectKey{.+}", async (c) => {
    const objectKey = c.req.param("objectKey");
    if (typeof objectKey !== "string" || objectKey.length === 0) {
      return notFound(c);
    }

    const parsedObjectKey = parseManagedObjectKey(objectKey);
    if (!parsedObjectKey) {
      return notFound(c);
    }

    const signingSecrets = resolvePublicObjectSigningSecrets(c.env);
    if (signingSecrets.length === 0) {
      return internalError(
        c,
        "스토리지 공개 URL 검증용 서명 설정이 누락되었습니다.",
      );
    }

    const signature = c.req.query("sig");
    const isValidSignature = await verifySignedPublicObjectSignature({
      objectKey,
      signature,
      signingSecrets,
    });
    if (!isValidSignature) {
      return notFound(c);
    }

    const bucket = resolveR2Bucket(c.env);
    const object = await createR2Client(bucket).getObject(objectKey);
    if (!object) {
      return notFound(c);
    }

    const resolvedContentType = resolvePublicMediaContentType(
      objectKey,
      object.httpMetadata?.contentType,
    );
    if (!resolvedContentType) {
      return notFound(c);
    }

    const headers = new Headers();
    headers.set("Cache-Control", PUBLIC_MEDIA_CACHE_CONTROL);
    headers.set("Content-Type", resolvedContentType.contentType);
    headers.set("X-Content-Type-Options", "nosniff");

    if (resolvedContentType.isAttachment) {
      const downloadName = buildAttachmentDownloadName(parsedObjectKey.fileToken);
      headers.set(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
      );
    }

    if (object.httpEtag) {
      headers.set("ETag", object.httpEtag);
    }

    if (typeof object.size === "number" && Number.isFinite(object.size)) {
      headers.set("Content-Length", String(object.size));
    }

    return new Response(object.body, {
      status: 200,
      headers,
    });
  });

  app.openapi(listPublicActivitiesRoute, async (c): Promise<any> =>
    respondWithPublicCache(c, async () => {
      const data = await dependencies.getDataService(c).listPublicActivities();
      const sanitized = data
        .map(sanitizePublicActivity)
        .filter((activity): activity is NonNullable<typeof activity> =>
          Boolean(activity),
        );
      return ok(c, sanitized);
    }),
  );

  app.openapi(getPublicActivityByIdRoute, async (c): Promise<any> =>
    respondWithPublicCache(c, async () => {
      const params = ApiIdParamSchema.safeParse(c.req.param());
      if (!params.success) {
        return badRequest(c, params.error.issues[0]?.message ?? "잘못된 요청입니다.");
      }

      const data = await dependencies
        .getDataService(c)
        .getActivityById(params.data.id);
      if (!data) {
        return notFound(c);
      }
      const sanitized = sanitizePublicActivity(data);
      return sanitized ? ok(c, sanitized) : notFound(c);
    }),
  );

  app.openapi(listPublicExhibitionsRoute, async (c): Promise<any> =>
    respondWithPublicCache(c, async () => {
      const data = await dependencies.getDataService(c).listPublicExhibitions();
      const sanitized = data
        .map(sanitizePublicExhibition)
        .filter((exhibition): exhibition is NonNullable<typeof exhibition> =>
          Boolean(exhibition),
        );
      return ok(c, sanitized);
    }),
  );

  app.openapi(getPublicExhibitionByIdRoute, async (c): Promise<any> =>
    respondWithPublicCache(c, async () => {
      const params = ApiIdParamSchema.safeParse(c.req.param());
      if (!params.success) {
        return badRequest(c, params.error.issues[0]?.message ?? "잘못된 요청입니다.");
      }

      const data = await dependencies
        .getDataService(c)
        .getExhibitionById(params.data.id);
      if (!data) {
        return notFound(c);
      }
      const sanitized = sanitizePublicExhibition(data);
      return sanitized ? ok(c, sanitized) : notFound(c);
    }),
  );

  app.openapi(listPublicLinktreeRoute, async (c): Promise<any> =>
    respondWithPublicCache(c, async () => {
      const data = await dependencies.getDataService(c).listLinktrees();
      return ok(c, data.map(sanitizePublicLinktree));
    }),
  );

  app.openapi(getPublicSiteSettingsRoute, async (c): Promise<any> =>
    respondWithPublicCache(c, async () => {
      const data = await dependencies.getDataService(c).getSiteSettings();
      return ok(c, sanitizePublicSiteSettings(data));
    }),
  );

  app.openapi(getPublicCurrentRecruitingPlanRoute, async (c): Promise<any> =>
    respondWithPublicCache(c, async () => {
      const data = await dependencies.getDataService(c).getCurrentRecruitingPlan();
      return ok(c, data ? sanitizePublicRecruitingPlan(data) : null);
    }),
  );

  app.openapi(listPublicGenerationsRoute, async (c): Promise<any> =>
    respondWithPublicCache(c, async () => {
      const data = await dependencies
        .getDataService(c)
        .listGenerations()
        .then((rows) => [...rows].sort((a, b) => a.sortOrder - b.sortOrder));
      return ok(c, data);
    }),
  );

  app.openapi(listPublicPhotographersRoute, async (c): Promise<any> =>
    respondWithPublicCache(c, async () => {
      const dataService = dependencies.getDataService(c);
      const [generations, users] = await Promise.all([
        dataService
          .listGenerations()
          .then((rows) => [...rows].sort((a, b) => a.sortOrder - b.sortOrder)),
        dataService.listUsers(),
      ]);

      const readMemberSortName = (member: {
        familyName: string | null;
        givenName: string | null;
        name: string;
      }): string => {
        const familyName = member.familyName?.trim() ?? "";
        const givenName = member.givenName?.trim() ?? "";
        if (familyName.length > 0 && givenName.length > 0) {
          return `${familyName}${givenName}`;
        }
        return member.name.trim();
      };

      const data = generations.map((generation) => {
        const members = users
          .filter((user) =>
            ((user.generationIds?.length ?? 0) > 0
              ? user.generationIds ?? []
              : user.generationId
                ? [user.generationId]
                : []
            ).includes(generation.id),
          )
          .map((user) => ({
            id: user.id,
            name: user.name,
            image: user.image && isHttpUrl(user.image) ? user.image : null,
            showcaseImageUrls: user.showcaseImageUrls.filter(isHttpUrl),
            familyName: user.familyName,
            givenName: user.givenName,
            collaborationAvailable: user.collaborationAvailable,
            personalLink:
              user.personalLink && isHttpUrl(user.personalLink)
                ? user.personalLink
                : null,
            role: user.role,
            generationId: generation.id,
          }))
          .sort((a, b) =>
            readMemberSortName(a).localeCompare(readMemberSortName(b), "ko"),
          );

        return {
          id: generation.id,
          name: generation.name,
          sortOrder: generation.sortOrder,
          startDate: generation.startDate,
          endDate: generation.endDate,
          members,
        };
      });

      return ok(c, data);
    }),
  );

  app.openapi(recordViewRoute, async (c): Promise<any> => {
    const parsed = ApiRecordViewBodySchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return badRequest(
        c,
        parsed.error.issues[0]?.message ?? "잘못된 요청입니다.",
      );
    }

    const { resourceType } = parsed.data;
    const resourceId = normalizePageViewResourceId(
      resourceType,
      parsed.data.resourceId,
    );

    if (!(await dependencies.allowPageViewWrite(c))) {
      return noContent(c);
    }

    const store = dependencies.getViewCountStore(c);
    const dataService = dependencies.getDataService(c);

    let isActiveTarget = false;
    try {
      isActiveTarget = await dataService.isActiveViewResource(
        resourceType,
        resourceId,
      );
    } catch {
      // Fail closed on validation lookup errors without changing the 204 contract.
    }
    if (!isActiveTarget) {
      return noContent(c);
    }

    // 1. aggregated count 업데이트 (public display용)
    await store.recordView(resourceType, resourceId);
    
    // 2. detailed log 기록 (admin stats용)
    try {
      await dataService.recordPageView(resourceType, resourceId);
    } catch {
      // fire-and-forget: log 기록 실패는 무시
    }

    return noContent(c);
  });

  app.openapi(getViewCountsRoute, async (c): Promise<any> => {
    const query = ApiViewCountsQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return badRequest(
        c,
        query.error.issues[0]?.message ?? "잘못된 요청입니다.",
      );
    }

    const { resourceType, resourceIds: rawIds } = query.data;
    const resourceIds = Array.from(
      new Set(
        rawIds
          .split(",")
          .map((id) => id.trim())
          .filter((id) => id.length > 0),
      ),
    );

    if (resourceIds.length === 0) {
      return badRequest(c, "resourceIds에 유효한 ID가 포함되어야 합니다.");
    }

    if (resourceIds.length > 100) {
      return badRequest(c, "한 번에 최대 100개의 리소스만 조회할 수 있습니다.");
    }

    if (isEntityPageViewType(resourceType)) {
      const invalidResourceId = resourceIds.find(
        (id) => !ViewResourceIdSchema.safeParse(id).success,
      );
      if (invalidResourceId) {
        return badRequest(c, "resourceIds에는 UUID만 포함할 수 있습니다.");
      }
    }

    const store = dependencies.getViewCountStore(c);
    const normalizedResourceIds = Array.from(
      new Set(
        resourceIds.map((resourceId) =>
          normalizePageViewResourceId(resourceType, resourceId),
        ),
      ),
    );
    const counts = await store.getViewCounts(resourceType, normalizedResourceIds);

    // 요청된 모든 리소스 ID에 대해 결과를 보장 (없으면 0)
    const result: Record<string, number> = {};
    for (const id of resourceIds) {
      const normalizedId = normalizePageViewResourceId(resourceType, id);
      result[id] = counts[normalizedId] ?? 0;
    }

    const response = ok(c, result);
    response.headers.set("Cache-Control", VIEW_COUNTS_CACHE_CONTROL);
    return response;
  });
};
