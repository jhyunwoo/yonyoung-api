// D1은 쿼리당 바인딩 파라미터를 최대 100개까지만 허용한다 (활성 유저 50명 시점에
// resourceType(1) + resourceId(50) + createdAt(50) = 101개로 초과해 500이 발생했음).
// inArray 목록은 고정 파라미터 여유분을 남기고 45개 단위로 쪼개 실행한다.
export const IN_ARRAY_CHUNK_SIZE = 45;

export const chunkArray = <T>(
  items: readonly T[],
  chunkSize: number = IN_ARRAY_CHUNK_SIZE,
): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
};

export const selectInChunks = async <TItem, TRow>(
  items: readonly TItem[],
  queryChunk: (chunk: TItem[]) => Promise<TRow[]>,
): Promise<TRow[]> => {
  // 읽기 전용 청크 조회를 순차 실행하면 청크 수만큼 D1 왕복 지연이 누적되므로
  // 병렬로 실행한다. Promise.all은 입력 순서를 보존하므로 결과 순서는 동일하다.
  const chunkRows = await Promise.all(chunkArray(items).map(queryChunk));
  return chunkRows.flat();
};
