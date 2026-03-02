import { describe, expect, it } from "vitest";
import { resolveCrossSubDomainCookieDomain } from "../lib/auth";

describe("resolveCrossSubDomainCookieDomain", () => {
  it("workers.dev 서브도메인에서 루트 도메인을 반환한다", () => {
    expect(
      resolveCrossSubDomainCookieDomain("https://api.moveto.workers.dev"),
    ).toBe("moveto.workers.dev");
  });

  it("커스텀 도메인 서브도메인에서 루트 도메인을 반환한다", () => {
    expect(
      resolveCrossSubDomainCookieDomain("https://api.yonyoung.moveto.kr"),
    ).toBe("yonyoung.moveto.kr");
  });

  it("서브도메인이 없으면 undefined를 반환한다", () => {
    expect(
      resolveCrossSubDomainCookieDomain("https://moveto.kr"),
    ).toBeUndefined();
  });

  it("localhost/IP 호스트는 undefined를 반환한다", () => {
    expect(
      resolveCrossSubDomainCookieDomain("http://localhost:8787"),
    ).toBeUndefined();
    expect(
      resolveCrossSubDomainCookieDomain("http://127.0.0.1:8787"),
    ).toBeUndefined();
  });

  it("유효하지 않은 URL은 undefined를 반환한다", () => {
    expect(resolveCrossSubDomainCookieDomain("not-a-url")).toBeUndefined();
  });
});
