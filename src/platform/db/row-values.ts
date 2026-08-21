/**
 * D1 컬럼은 마이그레이션 시점에 따라 Date/number/문자열이 섞여 들어온다.
 * 어떤 표현이 오더라도 Date로 정규화하고, 해석 불가한 값은 epoch로 떨어뜨린다.
 */
export const toTimestampDate = (value: unknown): Date => {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "number") {
    return new Date(value);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return new Date(0);
    }

    const numericValue = Number(trimmed);
    if (Number.isFinite(numericValue)) {
      return new Date(
        trimmed.length <= 10 ? numericValue * 1000 : numericValue,
      );
    }

    const parsed = Date.parse(trimmed);
    if (Number.isFinite(parsed)) {
      return new Date(parsed);
    }
  }

  return new Date(0);
};

export const parseJsonStringArray = (
  value: string | null | undefined,
): string[] => {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
};

// 세부 이미지 쓰기 입력의 원본 픽셀 크기를 부분 업데이트 객체로 변환한다.
// 전달되지 않은 값은 기존 컬럼을 덮어쓰지 않도록 키 자체를 생략한다.
export const toImageDimensionsPatch = (input: {
  width?: number;
  height?: number;
}) => ({
  ...(input.width !== undefined ? { width: input.width } : {}),
  ...(input.height !== undefined ? { height: input.height } : {}),
});
