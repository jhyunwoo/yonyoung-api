/** 브라우저가 안전한 네트워크 탐색으로 처리할 수 있는 HTTP(S) URL인지 판별한다. */
export const isHttpUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
};
