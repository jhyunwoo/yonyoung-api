 
export type OpenAPIDocument = {
  openapi?: string;
  info?: any;
  paths?: Record<string, Record<string, any>>;
  components?: {
    schemas?: Record<string, any>;
    securitySchemes?: Record<string, any>;
    [key: string]: any;
  };
  tags?: Array<{ name: string; [key: string]: any }>;
  [key: string]: any;
};

const isRecord = (value: unknown): value is Record<string, any> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const HTTP_METHODS = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "options",
  "head",
  "trace",
]);

const ensureAuthPathPrefix = (path: string): string => {
  if (path.startsWith("/api/auth")) {
    return path;
  }
  return `/api/auth${path.startsWith("/") ? path : `/${path}`}`;
};

const mergeTags = (
  internalTags: OpenAPIDocument["tags"],
  authTags: OpenAPIDocument["tags"],
) => {
  const merged = [...(internalTags ?? [])];
  const tagByName = new Map<string, { name: string; [key: string]: any }>();

  for (const tag of merged) {
    if (!tag || typeof tag.name !== "string") {
      continue;
    }
    tagByName.set(tag.name, tag);
  }

  for (const tag of authTags ?? []) {
    if (!tag || typeof tag.name !== "string") {
      continue;
    }

    const existing = tagByName.get(tag.name);
    if (!existing) {
      merged.push(tag);
      tagByName.set(tag.name, tag);
      continue;
    }

    if (
      (!existing.description || String(existing.description).trim() === "") &&
      tag.description
    ) {
      existing.description = tag.description;
    }
  }

  return merged;
};

const mergePaths = (
  internalPaths: OpenAPIDocument["paths"] | undefined,
  authPaths: OpenAPIDocument["paths"] | undefined,
) => {
  const mergedPaths = { ...(internalPaths ?? {}) };
  const existingOperationIds = new Set<string>();

  for (const path of Object.values(mergedPaths)) {
    if (!isRecord(path)) {
      continue;
    }
    for (const [method, operation] of Object.entries(path)) {
      if (!HTTP_METHODS.has(method)) {
        continue;
      }
      if (
        isRecord(operation) &&
        "operationId" in operation &&
        typeof operation.operationId === "string"
      ) {
        existingOperationIds.add(operation.operationId);
      }
    }
  }

  for (const [rawPath, pathItem] of Object.entries(authPaths ?? {})) {
    if (!isRecord(pathItem)) {
      continue;
    }

    const normalizedPath = ensureAuthPathPrefix(rawPath);
    const normalizedPathItem = { ...pathItem };

    for (const [method, operation] of Object.entries(normalizedPathItem)) {
      if (!HTTP_METHODS.has(method)) {
        continue;
      }
      if (
        !isRecord(operation) ||
        !("operationId" in operation) ||
        typeof operation.operationId !== "string"
      ) {
        continue;
      }

      if (existingOperationIds.has(operation.operationId)) {
        normalizedPathItem[method] = {
          ...operation,
          operationId: `auth_${operation.operationId}`,
        };
      } else {
        existingOperationIds.add(operation.operationId);
      }
    }

    if (!mergedPaths[normalizedPath]) {
      mergedPaths[normalizedPath] = normalizedPathItem;
      continue;
    }

    mergedPaths[normalizedPath] = {
      ...mergedPaths[normalizedPath],
      ...normalizedPathItem,
    };
  }

  return mergedPaths;
};

export const mergeOpenApiDocuments = (
  internalDoc: OpenAPIDocument,
  authDoc: OpenAPIDocument,
): OpenAPIDocument => {
  const internalComponents = isRecord(internalDoc.components)
    ? internalDoc.components
    : {};
  const authComponents = isRecord(authDoc.components) ? authDoc.components : {};

  return {
    ...internalDoc,
    openapi: "3.1.1",
    paths: mergePaths(internalDoc.paths, authDoc.paths),
    components: {
      ...internalComponents,
      ...authComponents,
      schemas: {
        ...(isRecord(internalComponents.schemas) ? internalComponents.schemas : {}),
        ...(isRecord(authComponents.schemas) ? authComponents.schemas : {}),
      },
      securitySchemes: {
        ...(isRecord(internalComponents.securitySchemes)
          ? internalComponents.securitySchemes
          : {}),
        ...(isRecord(authComponents.securitySchemes)
          ? authComponents.securitySchemes
          : {}),
      },
    },
    tags: mergeTags(internalDoc.tags, authDoc.tags),
  };
};
