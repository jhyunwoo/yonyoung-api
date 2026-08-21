 
import {
  type OperationDocSpec,
  getAuthOperationDocSpec,
  getInternalOperationDocSpec,
  renderOperationDescription,
} from "./descriptions";
import { type OpenAPIDocument } from "./merge";

const HTTP_METHODS = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "options",
  "head",
  "trace",
] as const;

const responseDescriptionByStatus: Record<string, string> = {
  "200":
    "요청이 정상적으로 처리되었습니다. 응답 본문의 `data` 필드(또는 endpoint별 성공 payload)를 확인하세요.",
  "201":
    "리소스가 성공적으로 생성되었습니다. 생성 결과는 응답 본문의 `data`에 포함됩니다.",
  "204":
    "요청이 정상 처리되었으며 반환 본문은 없습니다. 클라이언트에서는 성공 상태 코드만 확인하면 됩니다.",
  "400":
    "입력값 검증에 실패했습니다. 서버는 처리 전에 요청 형식을 검사하며, 클라이언트는 UUID/필수 필드/타입을 점검해야 합니다.",
  "401":
    "유효한 로그인 세션이 없어 요청이 거부되었습니다. 클라이언트는 재로그인 후 동일 요청을 재시도해야 합니다.",
  "403":
    "인증은 되었지만 역할 기반 권한 정책에 의해 작업이 거부되었습니다. 클라이언트는 권한 범위 내 기능만 노출해야 합니다.",
  "404":
    "요청한 리소스를 찾을 수 없습니다. 잘못된 식별자이거나 이미 삭제된 상태일 수 있으니 목록 재조회 후 재시도해야 합니다.",
  "409":
    "리소스 제약 조건 충돌이 발생했습니다(예: UNIQUE). 클라이언트는 중복 값을 변경한 뒤 재요청해야 합니다.",
  "500":
    "서버 내부 오류로 처리에 실패했습니다. 요청 파라미터가 정상이어도 외부 의존성 또는 서버 예외로 실패할 수 있습니다.",
};

type MutableRecord = Record<string, any>;

const isRecord = (value: unknown): value is MutableRecord => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const inferParameterDescription = (name: string): string => {
  if (name === "id") {
    return "리소스 고유 식별자(UUID)입니다.";
  }
  if (name === "imageId") {
    return "세부 이미지 리소스 식별자(UUID)입니다.";
  }
  if (name === "itemId") {
    return "하위 아이템 리소스 식별자(UUID)입니다.";
  }
  return `${name} 파라미터 값입니다.`;
};

const extractPathParameterNames = (path: string): string[] => {
  const matches = path.matchAll(/\{([^}]+)}/g);
  return [...matches].map((entry) => entry[1]);
};

const ensureParameterDescriptions = (
  operation: MutableRecord,
  path: string,
) => {
  const existingParameters = Array.isArray(operation.parameters)
    ? [...operation.parameters]
    : [];
  const existingNames = new Set<string>();

  for (const parameter of existingParameters) {
    if (!isRecord(parameter)) {
      continue;
    }
    if (typeof parameter.name === "string") {
      existingNames.add(parameter.name);
      if (!parameter.description) {
        parameter.description = inferParameterDescription(parameter.name);
      }
    }
  }

  const pathNames = extractPathParameterNames(path);
  for (const name of pathNames) {
    if (existingNames.has(name)) {
      continue;
    }
    existingParameters.push({
      name,
      in: "path",
      required: true,
      schema: { type: "string" },
      description: inferParameterDescription(name),
    });
  }

  if (existingParameters.length > 0) {
    operation.parameters = existingParameters;
  }
};

const ensureRequestBodyDescription = (operation: MutableRecord) => {
  if (!isRecord(operation.requestBody)) {
    return;
  }
  if (!operation.requestBody.description) {
    operation.requestBody.description =
      "요청 본문 스키마는 OpenAPI의 requestBody.content를 따릅니다. 필수 여부와 제약조건을 확인하세요.";
  }
};

const mergeDescription = (current: unknown, generated: string): string => {
  if (typeof current !== "string" || current.trim().length === 0) {
    return generated;
  }
  if (current.includes(generated)) {
    return current;
  }
  return `${current} ${generated}`;
};

const ensureResponseDescriptions = (operation: MutableRecord) => {
  if (!isRecord(operation.responses)) {
    return;
  }

  for (const [status, response] of Object.entries(operation.responses)) {
    if (!isRecord(response)) {
      continue;
    }
    const detail = responseDescriptionByStatus[status];
    if (!detail) {
      if (!response.description) {
        response.description = "요청 처리 결과에 대한 응답입니다.";
      }
      continue;
    }
    response.description = mergeDescription(response.description, detail);
  }
};

const toFallbackSummary = (
  method: string,
  path: string,
  operation: MutableRecord,
): string => {
  if (
    typeof operation.summary === "string" &&
    operation.summary.trim().length > 0
  ) {
    return operation.summary;
  }
  if (
    typeof operation.operationId === "string" &&
    operation.operationId.trim().length > 0
  ) {
    return `${operation.operationId} 작업`;
  }
  return `${method.toUpperCase()} ${path} 처리`;
};

const fallbackParameterGuide = (
  path: string,
  operation: MutableRecord,
): string[] => {
  const result: string[] = [];
  const pathParameterNames = extractPathParameterNames(path);
  if (pathParameterNames.length > 0) {
    for (const name of pathParameterNames) {
      result.push(`\`${name}\` (path): ${inferParameterDescription(name)}`);
    }
  } else {
    result.push("경로 파라미터를 사용하지 않습니다.");
  }

  if (Array.isArray(operation.parameters)) {
    for (const parameter of operation.parameters) {
      if (!isRecord(parameter)) {
        continue;
      }
      if (parameter.in === "query" && typeof parameter.name === "string") {
        result.push(`\`${parameter.name}\` (query): 쿼리 파라미터입니다.`);
      }
    }
  }

  return result;
};

const fallbackRequestBodyGuide = (operation: MutableRecord): string[] => {
  if (!isRecord(operation.requestBody)) {
    return ["요청 본문은 사용하지 않습니다."];
  }

  const required =
    operation.requestBody.required === true
      ? "필수 요청 본문입니다."
      : "선택 요청 본문입니다.";
  const contentTypes = isRecord(operation.requestBody.content)
    ? Object.keys(operation.requestBody.content)
    : [];

  if (contentTypes.length === 0) {
    return [`${required} 본문 상세 스키마는 operation 정의를 참고하세요.`];
  }

  return [
    required,
    `지원 Content-Type: ${contentTypes.join(", ")}`,
    "필드 제약은 requestBody 스키마 정의를 따릅니다.",
  ];
};

const fallbackResponseGuide = (operation: MutableRecord): string[] => {
  if (!isRecord(operation.responses)) {
    return ["응답 코드는 endpoint 구현에 따라 달라질 수 있습니다."];
  }

  const statuses = Object.keys(operation.responses);
  if (statuses.length === 0) {
    return ["응답 코드 정의가 없습니다."];
  }

  return statuses
    .map((status) => {
      const message = responseDescriptionByStatus[status];
      if (message) {
        return `\`${status}\`: ${message}`;
      }
      return `\`${status}\`: endpoint별 응답 규격을 따릅니다.`;
    })
    .sort();
};

const fallbackErrorGuide = (operation: MutableRecord): string[] => {
  if (!isRecord(operation.responses)) {
    return [
      "오류 응답은 구현체에서 정의된 HTTP 상태 코드와 에러 envelope를 따릅니다.",
    ];
  }

  const errorStatuses = Object.keys(operation.responses).filter(
    (status) => Number.isFinite(Number(status)) && Number(status) >= 400,
  );

  if (errorStatuses.length === 0) {
    return ["이 endpoint는 문서상 별도 오류 응답이 정의되어 있지 않습니다."];
  }

  return errorStatuses.map((status) => {
    const message = responseDescriptionByStatus[status];
    if (message) {
      return `\`${status}\`: ${message}`;
    }
    return `\`${status}\`: 구현 정의를 따르는 오류 응답입니다.`;
  });
};

const fallbackPermissionGuide = (operation: MutableRecord): string[] => {
  if (Array.isArray(operation.security) && operation.security.length > 0) {
    return [
      "OpenAPI security 정의에 따라 인증이 필요한 보호 endpoint입니다.",
      "역할 기반 세부 권한은 서버 정책(requirePermission/can)에 의해 추가로 제한될 수 있습니다.",
    ];
  }
  return ["공개 endpoint이며 별도 인증이 요구되지 않습니다."];
};

const buildFallbackSpec = (
  path: string,
  method: string,
  operation: MutableRecord,
): OperationDocSpec => {
  return {
    summary: toFallbackSummary(method, path, operation),
    overview: `자동 보강 문서입니다. \`${method.toUpperCase()} ${path}\` 요청의 목적과 계약을 요약합니다.`,
    parameters: fallbackParameterGuide(path, operation),
    requestBody: fallbackRequestBodyGuide(operation),
    internalFlow: [
      "요청 수신 후 입력값을 검증합니다.",
      "인증/권한 정책이 설정된 경우 접근 가능 여부를 점검합니다.",
      "서비스 계층 처리 결과를 표준 응답 형식으로 반환합니다.",
    ],
    responseGuide: fallbackResponseGuide(operation),
    errorGuide: fallbackErrorGuide(operation),
    permission: fallbackPermissionGuide(operation),
  };
};

export const enrichOpenApiDocument = (
  sourceDoc: OpenAPIDocument,
): OpenAPIDocument => {
  const nextDoc: OpenAPIDocument = {
    ...sourceDoc,
    paths: {},
  };

  const sourcePaths = sourceDoc.paths ?? {};
  const nextPaths: Record<string, Record<string, any>> = {};

  for (const [path, pathItem] of Object.entries(sourcePaths)) {
    if (!isRecord(pathItem)) {
      continue;
    }

    const nextPathItem: Record<string, any> = { ...pathItem };

    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!isRecord(operation)) {
        continue;
      }

      const mutableOperation: Record<string, any> = { ...operation };

      ensureParameterDescriptions(mutableOperation, path);
      ensureRequestBodyDescription(mutableOperation);
      ensureResponseDescriptions(mutableOperation);

      const internalSpec = getInternalOperationDocSpec(
        typeof mutableOperation.operationId === "string"
          ? mutableOperation.operationId
          : undefined,
      );
      const authSpec = getAuthOperationDocSpec(path, method);
      const selectedSpec =
        internalSpec ??
        authSpec ??
        buildFallbackSpec(path, method, mutableOperation);

      mutableOperation.summary = selectedSpec.summary;
      mutableOperation.description = renderOperationDescription(selectedSpec);

      nextPathItem[method] = mutableOperation;
    }

    nextPaths[path] = nextPathItem;
  }

  nextDoc.paths = nextPaths;
  return nextDoc;
};
