import { type OpenAPIHono, createRoute } from "@hono/zod-openapi";
import type HonoAppType from "../../types/honoAppType";
import { noContent, ok } from "../../lib/http/response";
import { type AppDependencies } from "../../lib/services/dependencies";
import {
  assertPermission,
  requireAuthenticatedActor,
} from "../../shared/http/route-guards";
import { readValidated } from "../../shared/http/validated-input";
import {
  recordAuditLog,
  readChangedFields,
  withUpdatedByActor,
} from "../../lib/audit";
import {
  createdResponse,
  dataResponse,
  errorResponses,
  jsonBody,
  noContentResponse,
} from "../../lib/openapi/responses";
import {
  ApiCreateGenerationSchema,
  ApiGenerationSchema,
  ApiUpdateGenerationSchema,
} from "./generation.contract";
import { ApiGenerationMemberSummarySchema } from "../users/user.contract";
import { ApiIdParamSchema } from "../../shared/openapi/common.contract";
import { AppError, isAppError } from "../../shared/errors/AppError";

type App = OpenAPIHono<HonoAppType>;

/**
 * 이 feature 가 실제로 쓰는 것만 선언한다.
 * 애플리케이션 전체 dependency bag 을 받으면 무엇에 의존하는지 파일을 다 읽어야 알 수 있다.
 */
export type GenerationRouteDependencies = Pick<
  AppDependencies,
  "resolveActor" | "getDataService"
>;

const listGenerationsRoute = createRoute({
  method: "get",
  path: "/api/generations",
  tags: ["Generations"],
  operationId: "listGenerations",
  security: [{ cookieAuth: [] }],
  responses: {
    200: dataResponse(ApiGenerationSchema.array(), "기수 목록 조회 성공"),
    401: errorResponses[401],
    403: errorResponses[403],
  },
});

const createGenerationRoute = createRoute({
  method: "post",
  path: "/api/generations",
  tags: ["Generations"],
  operationId: "createGeneration",
  security: [{ cookieAuth: [] }],
  request: {
    body: jsonBody(ApiCreateGenerationSchema, "기수 생성 요청"),
  },
  responses: {
    201: createdResponse(ApiGenerationSchema, "기수 생성 성공"),
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    409: errorResponses[409],
    500: errorResponses[500],
  },
});

const getGenerationByIdRoute = createRoute({
  method: "get",
  path: "/api/generations/{id}",
  tags: ["Generations"],
  operationId: "getGenerationById",
  security: [{ cookieAuth: [] }],
  request: {
    params: ApiIdParamSchema,
  },
  responses: {
    200: dataResponse(ApiGenerationSchema, "기수 상세 조회 성공"),
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
  },
});

const listGenerationMembersRoute = createRoute({
  method: "get",
  path: "/api/generations/{id}/members",
  tags: ["Generations"],
  operationId: "listGenerationMembers",
  security: [{ cookieAuth: [] }],
  request: {
    params: ApiIdParamSchema,
  },
  responses: {
    200: dataResponse(
      ApiGenerationMemberSummarySchema.array(),
      "기수 멤버 목록 조회 성공",
    ),
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
  },
});

const updateGenerationRoute = createRoute({
  method: "patch",
  path: "/api/generations/{id}",
  tags: ["Generations"],
  operationId: "updateGeneration",
  security: [{ cookieAuth: [] }],
  request: {
    params: ApiIdParamSchema,
    body: jsonBody(ApiUpdateGenerationSchema, "기수 수정 요청"),
  },
  responses: {
    200: dataResponse(ApiGenerationSchema, "기수 수정 성공"),
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
    500: errorResponses[500],
  },
});

const deleteGenerationRoute = createRoute({
  method: "delete",
  path: "/api/generations/{id}",
  tags: ["Generations"],
  operationId: "deleteGeneration",
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

const isUniqueError = (error: unknown): boolean => {
  return (
    error instanceof Error &&
    (error.message.includes("UNIQUE") || error.message.includes("unique"))
  );
};

const readUniqueConflictMessage = (error: unknown): string => {
  if (!(error instanceof Error)) {
    return "중복된 값이 이미 존재합니다.";
  }

  if (error.message.includes("generations.name")) {
    return "name 값이 이미 존재합니다.";
  }

  if (error.message.includes("generations.sort_order")) {
    return "sortOrder 값이 이미 존재합니다.";
  }

  return "중복된 값이 이미 존재합니다.";
};

const isGlobalGenerationMemberReader = (role: string): boolean =>
  role === "president" || role === "vice_president";

const readGenerationIdSet = (input: {
  generationId: string | null;
  generationIds?: string[];
}): Set<string> => {
  const ids = new Set<string>();
  for (const generationId of input.generationIds ?? []) {
    if (typeof generationId === "string" && generationId.length > 0) {
      ids.add(generationId);
    }
  }

  if (typeof input.generationId === "string" && input.generationId.length > 0) {
    ids.add(input.generationId);
  }

  return ids;
};

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

export const registerGenerationRoutes = (
  app: App,
  dependencies: GenerationRouteDependencies,
) => {
  app.openapi(listGenerationsRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);

    assertPermission(actor, "generation", "read");

    const data = await dependencies.getDataService(c).listGenerations();
    return ok(c, data);
  });

  app.openapi(createGenerationRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);

    assertPermission(actor, "generation", "create");

    const body = readValidated(c, "json", ApiCreateGenerationSchema);

    try {
      const dataService = dependencies.getDataService(c);
      const data = await dataService.createGeneration(body);
      await recordAuditLog({
        dataService,
        actor: actor,
        resourceType: "generation",
        resourceId: data.id,
        action: "create",
        changedFields: readChangedFields(body, [
          "name",
          "sortOrder",
          "startDate",
          "endDate",
        ]),
      });
      return ok(c, withUpdatedByActor(data, actor), 201);
    } catch (error) {
      // 핸들러가 의도적으로 던진 도메인 에러(404 등)를 500으로 덮지 않는다.
      if (isAppError(error)) {
        throw error;
      }
      if (isUniqueError(error)) {
        throw AppError.conflict(readUniqueConflictMessage(error));
      }
      throw AppError.internal(undefined, undefined, error);
    }
  });

  app.openapi(getGenerationByIdRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);

    assertPermission(actor, "generation", "read");

    const params = readValidated(c, "param", ApiIdParamSchema);

    const data = await dependencies
      .getDataService(c)
      .getGenerationById(params.id);
    if (!data) {
      throw AppError.notFound();
    }
    return ok(c, data);
  });

  app.openapi(listGenerationMembersRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);

    assertPermission(actor, "generation", "read");

    const params = readValidated(c, "param", ApiIdParamSchema);

    const dataService = dependencies.getDataService(c);
    const generation = await dataService.getGenerationById(params.id);
    if (!generation) {
      throw AppError.notFound();
    }

    if (!isGlobalGenerationMemberReader(actor.role)) {
      const actorGenerationIdSet = readGenerationIdSet(actor);
      if (!actorGenerationIdSet.has(generation.id)) {
        throw AppError.forbidden();
      }
    }

    const members = (
      await dataService.listUsersByGenerationIds([generation.id])
    )
      .map((candidate) => ({
        id: candidate.id,
        generationId: generation.id,
        name: candidate.name,
        image: candidate.image,
        familyName: candidate.familyName,
        givenName: candidate.givenName,
        department: candidate.department,
        collaborationAvailable: candidate.collaborationAvailable,
        personalLink: candidate.personalLink,
        role: candidate.role,
      }))
      .sort((left, right) =>
        readMemberSortName(left).localeCompare(readMemberSortName(right), "ko"),
      );

    return ok(c, members);
  });

  app.openapi(updateGenerationRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);

    assertPermission(actor, "generation", "update");

    const params = readValidated(c, "param", ApiIdParamSchema);

    const body = readValidated(c, "json", ApiUpdateGenerationSchema);

    if (Object.keys(body).length === 0) {
      throw AppError.badRequest("수정할 필드를 하나 이상 전달해야 합니다.");
    }

    try {
      const dataService = dependencies.getDataService(c);
      const data = await dataService.updateGeneration(params.id, body);
      if (!data) {
        throw AppError.notFound();
      }
      await recordAuditLog({
        dataService,
        actor: actor,
        resourceType: "generation",
        resourceId: data.id,
        action: "update",
        changedFields: readChangedFields(body, ["updatedAt"]),
      });
      return ok(c, withUpdatedByActor(data, actor));
    } catch (error) {
      // 핸들러가 의도적으로 던진 도메인 에러(404 등)를 500으로 덮지 않는다.
      if (isAppError(error)) {
        throw error;
      }
      if (isUniqueError(error)) {
        throw AppError.conflict(readUniqueConflictMessage(error));
      }
      throw AppError.internal(undefined, undefined, error);
    }
  });

  app.openapi(deleteGenerationRoute, async (c) => {
    const actor = await requireAuthenticatedActor(c, dependencies);

    assertPermission(actor, "generation", "delete");

    const params = readValidated(c, "param", ApiIdParamSchema);

    const dataService = dependencies.getDataService(c);
    const deleted = await dataService.deleteGeneration(params.id);
    if (!deleted) {
      throw AppError.notFound();
    }
    await recordAuditLog({
      dataService,
      actor: actor,
      resourceType: "generation",
      resourceId: params.id,
      action: "delete",
      changedFields: ["deletedAt"],
    });
    return noContent(c);
  });
};
