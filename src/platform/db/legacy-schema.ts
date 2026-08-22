/**
 * user_generations(다대다) 테이블은 뒤늦게 도입됐다. 아직 마이그레이션이 적용되지 않은
 * 환경에서도 읽기가 죽지 않도록, 호출부가 user.generation_id 단일 컬럼으로 폴백할 수 있게
 * 이 오류만 구분해서 알려준다.
 */
export const isMissingUserGenerationsTableError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes("no such table: user_generations");
};
