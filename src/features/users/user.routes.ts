import { type OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { z } from "../../shared/openapi/zod";
import type HonoAppType from "../../types/honoAppType";
import { noContent, ok } from "../../lib/http/response";
import { type AppDependencies } from "../../lib/services/dependencies";
import { requireAuthenticatedActor } from "../../shared/http/route-guards";
import { readValidated } from "../../shared/http/validated-input";
import { parseBody } from "../../lib/validation/request";
import {
  recordAuditLog,
  readChangedFields,
  withUpdatedByActor,
} from "../../lib/audit";
import {
  can,
  canAssignRole,
  isMemberLikeRole,
  normalizeRole,
} from "../../lib/authorization/policy";
import {
  dataResponse,
  errorResponses,
  jsonBody,
  noContentResponse,
} from "../../lib/openapi/responses";
import {
  ApiAdminUpdateUserSchema,
  ApiBulkUpdateUserRoleSchema,
  ApiMemberProfileUpdateSchema,
  ApiUserResourceHistoryQuerySchema,
  ApiUserResourceHistorySchema,
  ApiUserSchema,
} from "./user.contract";
import { ApiUserIdParamSchema } from "../../shared/openapi/common.contract";
import type { Role } from "../../lib/authorization/types";
import { isHttpUrl } from "../../lib/validation/url";
import { AppError } from "../../shared/errors/AppError";

type App = OpenAPIHono<HonoAppType>;

/**
 * 이 feature 가 실제로 쓰는 것만 선언한다.
 * 애플리케이션 전체 dependency bag 을 받으면 무엇에 의존하는지 파일을 다 읽어야 알 수 있다.
 */
export type UserRouteDependencies = Pick<
  AppDependencies,
  "resolveActor" | "getDataService"
>;

const updateUserRequestSchema = z
  .union([ApiAdminUpdateUserSchema, ApiMemberProfileUpdateSchema])
  .openapi("ApiUpdateUserRequest");

const canReadAllUsers = (role: string): boolean =>
  role === "president" || role === "vice_president";

type UserUrlFields = {
  image: string | null;
  showcaseImageUrls: string[];
  personalLink: string | null;
};

const sanitizeUserUrlFields = <T extends UserUrlFields>(user: T): T => {
  const image = user.image?.trim() ?? null;
  const personalLink = user.personalLink?.trim() ?? null;
  return {
    ...user,
    image: image && isHttpUrl(image) ? image : null,
    showcaseImageUrls: user.showcaseImageUrls
      .map((url) => url.trim())
      .filter(isHttpUrl),
    personalLink: personalLink && isHttpUrl(personalLink) ? personalLink : null,
  };
};

const canManageTargetUser = (
  actor: {
    id: string;
    role: Role;
  },
  targetUser: {
    id: string;
    role: string | null;
  },
): boolean => {
  if (actor.id === targetUser.id) {
    return true;
  }

  return (
    canAssignRole(actor.role, targetUser.role) &&
    normalizeRole(actor.role) !== normalizeRole(targetUser.role)
  );
};

const listUsersRoute = createRoute({
  method: "get",
  path: "/api/users",
  tags: ["Users"],
  operationId: "listUsers",
  security: [{ cookieAuth: [] }],
  responses: {
    200: dataResponse(ApiUserSchema.array(), "사용자 목록/본인 조회 성공"),
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
  },
});

const getCurrentUserRoute = createRoute({
  method: "get",
  path: "/api/users/me",
  tags: ["Users"],
  operationId: "getCurrentUser",
  security: [{ cookieAuth: [] }],
  responses: {
    200: dataResponse(ApiUserSchema, "현재 로그인 사용자 조회 성공"),
    401: errorResponses[401],
    404: errorResponses[404],
  },
});

const getUserByIdRoute = createRoute({
  method: "get",
  path: "/api/users/{id}",
  tags: ["Users"],
  operationId: "getUserById",
  security: [{ cookieAuth: [] }],
  request: {
    params: ApiUserIdParamSchema,
  },
  responses: {
    200: dataResponse(ApiUserSchema, "사용자 상세 조회 성공"),
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
  },
});

const getUserResourceHistoryRoute = createRoute({
  method: "get",
  path: "/api/users/{id}/resource-history",
  tags: ["Users"],
  operationId: "getUserResourceHistory",
  security: [{ cookieAuth: [] }],
  request: {
    params: ApiUserIdParamSchema,
    query: ApiUserResourceHistoryQuerySchema,
  },
  responses: {
    200: dataResponse(
      ApiUserResourceHistorySchema,
      "사용자 리소스 이력 조회 성공",
    ),
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
  },
});

const updateUserRoute = createRoute({
  method: "patch",
  path: "/api/users/{id}",
  tags: ["Users"],
  operationId: "updateUser",
  security: [{ cookieAuth: [] }],
  request: {
    params: ApiUserIdParamSchema,
    body: jsonBody(updateUserRequestSchema, "사용자 수정 요청"),
  },
  responses: {
    200: dataResponse(ApiUserSchema, "사용자 수정 성공"),
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
  },
});

const deleteUserRoute = createRoute({
  method: "delete",
  path: "/api/users/{id}",
  tags: ["Users"],
  operationId: "deleteUser",
  security: [{ cookieAuth: [] }],
  request: {
    params: ApiUserIdParamSchema,
  },
  responses: {
    204: noContentResponse,
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
  },
});

const bulkUpdateUserRoleRoute = createRoute({
  method: "patch",
  path: "/api/users/bulk-role",
  tags: ["Users"],
  operationId: "bulkUpdateUserRole",
  security: [{ cookieAuth: [] }],
  request: {
    body: jsonBody(ApiBulkUpdateUserRoleSchema, "사용자 권한 일괄 변경 요청"),
  },
  responses: {
    200: dataResponse(ApiUserSchema.array(), "사용자 권한 일괄 변경 성공"),
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
  },
});

export const registerUserRoutes = (app: App, dependencies: AppDependencies) => {
  app.openapi(listUsersRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);

    if (canReadAllUsers(actor.role)) {
      const data = await dependencies.getDataService(c).listUsers();
      return ok(c, data.map(sanitizeUserUrlFields));
    }

    if (actor.role === "manager") {
      const actorGenerationIdSet = new Set(actor.generationIds ?? []);
      if (actor.generationId) {
        actorGenerationIdSet.add(actor.generationId);
      }

      if (actorGenerationIdSet.size === 0) {
        return ok(c, []);
      }

      const data = await dependencies
        .getDataService(c)
        .listUsersByGenerationIds(Array.from(actorGenerationIdSet));
      return ok(c, data.map(sanitizeUserUrlFields));
    }

    if (isMemberLikeRole(actor.role)) {
      const me = await dependencies.getDataService(c).getUserById(actor.id);
      if (!me) {
        throw AppError.notFound();
      }
      return ok(c, [sanitizeUserUrlFields(me)]);
    }

    throw AppError.forbidden();
  });

  app.openapi(getCurrentUserRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);

    const data = await dependencies.getDataService(c).getUserById(actor.id);
    if (!data) {
      throw AppError.notFound();
    }

    return ok(c, sanitizeUserUrlFields(data));
  });

  app.openapi(getUserByIdRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);

    const params = readValidated(c, "param", ApiUserIdParamSchema);

    const isSelf = actor.id === params.id;
    if (!canReadAllUsers(actor.role) && actor.role !== "manager" && !isSelf) {
      throw AppError.forbidden();
    }

    const data = await dependencies.getDataService(c).getUserById(params.id);
    if (!data) {
      throw AppError.notFound();
    }

    if (
      actor.role === "manager" &&
      !isSelf &&
      (() => {
        const actorGenerationIdSet = new Set(actor.generationIds ?? []);
        if (actor.generationId) {
          actorGenerationIdSet.add(actor.generationId);
        }
        if (actorGenerationIdSet.size === 0) {
          return true;
        }
        const targetGenerationIds =
          (data.generationIds?.length ?? 0) > 0
            ? (data.generationIds ?? [])
            : data.generationId
              ? [data.generationId]
              : [];
        return !targetGenerationIds.some((id) => actorGenerationIdSet.has(id));
      })()
    ) {
      throw AppError.forbidden();
    }

    return ok(c, sanitizeUserUrlFields(data));
  });

  app.openapi(getUserResourceHistoryRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);

    if (!canReadAllUsers(actor.role)) {
      throw AppError.forbidden();
    }

    const params = readValidated(c, "param", ApiUserIdParamSchema);

    const query = readValidated(c, "query", ApiUserResourceHistoryQuerySchema);

    const dataService = dependencies.getDataService(c);
    const targetUser = await dataService.getUserById(params.id);
    if (!targetUser) {
      throw AppError.notFound();
    }

    const history = await dataService.listUserResourceHistory({
      userId: params.id,
      page: query.page,
      pageSize: query.pageSize,
      action: query.action,
    });
    return ok(c, history);
  });

  app.openapi(bulkUpdateUserRoleRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);

    if (!can(actor.role, "user", "update")) {
      throw AppError.forbidden();
    }

    const body = readValidated(c, "json", ApiBulkUpdateUserRoleSchema);

    if (!canAssignRole(actor.role, body.role)) {
      throw AppError.forbidden(
        "본인보다 높은 등급으로 권한을 변경할 수 없습니다.",
      );
    }

    const dataService = dependencies.getDataService(c);
    const targetUserIds = Array.from(new Set(body.userIds));
    const users = await dataService.listUsersByIds(targetUserIds);
    const userById = new Map(
      users.map((candidate) => [candidate.id, candidate]),
    );
    const targetUsers = body.userIds.map(
      (userId) => userById.get(userId) ?? null,
    );
    if (targetUsers.some((user) => user === null)) {
      throw AppError.badRequest("일부 대상 사용자를 찾을 수 없습니다.");
    }

    const unauthorizedTargetExists = targetUsers.some(
      (candidate) =>
        candidate !== null &&
        !canManageTargetUser(actor, {
          id: candidate.id,
          role: candidate.role,
        }),
    );
    if (unauthorizedTargetExists) {
      throw AppError.forbidden(
        "본인보다 높거나 같은 등급의 사용자는 변경할 수 없습니다.",
      );
    }

    const normalizedNextRole = normalizeRole(body.role);
    const presidentCount = await dataService.countUsersByRole("president");
    const demotedPresidentCount = targetUsers.filter(
      (candidate) =>
        candidate !== null &&
        normalizeRole(candidate.role) === "president" &&
        normalizedNextRole !== "president",
    ).length;
    if (presidentCount - demotedPresidentCount <= 0) {
      throw AppError.badRequest("회장 권한은 최소 1명 이상 유지되어야 합니다.");
    }

    const updatedUsers = await dataService.bulkUpdateUsersRole({
      userIds: body.userIds,
      role: normalizedNextRole,
    });
    await Promise.all(
      updatedUsers.map((updatedUser) =>
        recordAuditLog({
          dataService,
          actor: actor,
          resourceType: "user",
          resourceId: updatedUser.id,
          action: "update",
          changedFields: ["role", "updatedAt"],
        }),
      ),
    );
    return ok(
      c,
      updatedUsers.map((updatedUser) =>
        sanitizeUserUrlFields(withUpdatedByActor(updatedUser, actor)),
      ),
    );
  });

  app.openapi(updateUserRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);

    const params = readValidated(c, "param", ApiUserIdParamSchema);

    const isSelf = actor.id === params.id;
    const isAdminLike = can(actor.role, "user", "update");
    const dataService = dependencies.getDataService(c);

    if (isAdminLike) {
      // 라우트 계약은 admin/member 스키마의 union이라 여기서 역할에 맞는 쪽으로 한 번 더 좁힌다.
      const body = await parseBody(c, ApiAdminUpdateUserSchema);
      if (!body.success) {
        throw AppError.badRequest(body.message);
      }
      if (Object.keys(body.data).length === 0) {
        throw AppError.badRequest("수정할 필드를 하나 이상 전달해야 합니다.");
      }

      const currentUser = await dataService.getUserById(params.id);
      if (!currentUser) {
        throw AppError.notFound();
      }

      if (
        !canManageTargetUser(actor, {
          id: currentUser.id,
          role: currentUser.role,
        })
      ) {
        throw AppError.forbidden(
          "본인보다 높거나 같은 등급의 사용자는 변경할 수 없습니다.",
        );
      }

      const updateInput = { ...body.data };
      if (updateInput.role !== undefined) {
        if (!canAssignRole(actor.role, updateInput.role)) {
          throw AppError.forbidden(
            "본인보다 높은 등급으로 권한을 변경할 수 없습니다.",
          );
        }

        const currentNormalizedRole = normalizeRole(currentUser.role);
        const nextNormalizedRole = normalizeRole(updateInput.role);
        if (
          currentNormalizedRole === "president" &&
          nextNormalizedRole !== "president"
        ) {
          const presidentCount =
            await dataService.countUsersByRole("president");
          if (presidentCount <= 1) {
            throw AppError.badRequest(
              "회장 권한은 최소 1명 이상 유지되어야 합니다.",
            );
          }
        }

        updateInput.role = nextNormalizedRole;
      }

      const data = await dataService.updateUser(params.id, updateInput);
      if (!data) {
        throw AppError.notFound();
      }
      await recordAuditLog({
        dataService,
        actor: actor,
        resourceType: "user",
        resourceId: data.id,
        action: "update",
        changedFields: readChangedFields(updateInput, ["updatedAt"]),
      });
      return ok(c, sanitizeUserUrlFields(withUpdatedByActor(data, actor)));
    }

    // member 계열 role 및 unverified는 본인 프로필 필드만 수정 가능하다.
    if (
      (isMemberLikeRole(actor.role) || actor.role === "unverified") &&
      isSelf
    ) {
      const body = await parseBody(c, ApiMemberProfileUpdateSchema);
      if (!body.success) {
        throw AppError.badRequest(body.message);
      }
      if (Object.keys(body.data).length === 0) {
        throw AppError.badRequest("수정할 필드를 하나 이상 전달해야 합니다.");
      }
      const data = await dataService.updateUser(params.id, body.data);
      if (!data) {
        throw AppError.notFound();
      }
      await recordAuditLog({
        dataService,
        actor: actor,
        resourceType: "user",
        resourceId: data.id,
        action: "update",
        changedFields: readChangedFields(body.data, ["updatedAt"]),
      });
      return ok(c, sanitizeUserUrlFields(withUpdatedByActor(data, actor)));
    }

    throw AppError.forbidden();
  });

  app.openapi(deleteUserRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);

    const params = readValidated(c, "param", ApiUserIdParamSchema);

    const isSelf = actor.id === params.id;
    if (!can(actor.role, "user", "delete")) {
      if (!(isMemberLikeRole(actor.role) && isSelf)) {
        throw AppError.forbidden();
      }
    }

    const dataService = dependencies.getDataService(c);
    const targetUser = await dataService.getUserById(params.id);
    if (!targetUser) {
      throw AppError.notFound();
    }

    if (
      can(actor.role, "user", "delete") &&
      !canManageTargetUser(actor, {
        id: targetUser.id,
        role: targetUser.role,
      })
    ) {
      throw AppError.forbidden(
        "본인보다 높거나 같은 등급의 사용자는 삭제할 수 없습니다.",
      );
    }

    if (normalizeRole(targetUser.role) === "president") {
      const presidentCount = await dataService.countUsersByRole("president");
      if (presidentCount <= 1) {
        throw AppError.badRequest(
          "회장 권한은 최소 1명 이상 유지되어야 합니다.",
        );
      }
    }

    const deleted = await dataService.deleteUser(params.id);
    if (!deleted) {
      throw AppError.notFound();
    }
    await recordAuditLog({
      dataService,
      actor: actor,
      resourceType: "user",
      resourceId: params.id,
      action: "delete",
      changedFields: ["deletedAt"],
    });
    return noContent(c);
  });
};
