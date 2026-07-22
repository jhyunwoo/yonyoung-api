import { describe, expect, it } from "vitest";
import { parseEnv } from "../bindings/env";

describe("runtime binding env", () => {
  it("이전 공개 URL 서명 시크릿 binding을 보존한다", () => {
    const parsed = parseEnv({
      R2_PUBLIC_URL_SIGNING_SECRET:
        "current-public-url-signing-secret-at-least-32-chars",
      R2_PUBLIC_URL_SIGNING_SECRET_PREVIOUS:
        "previous-public-url-signing-secret-at-least-32-chars",
    } as never);

    expect(parsed.R2_PUBLIC_URL_SIGNING_SECRET).toContain("current-public");
    expect(parsed.R2_PUBLIC_URL_SIGNING_SECRET_PREVIOUS).toContain(
      "previous-public",
    );
  });

  it("32자 미만 공개 URL 서명 시크릿을 거부한다", () => {
    expect(() =>
      parseEnv({ R2_PUBLIC_URL_SIGNING_SECRET: "too-short" } as never),
    ).toThrow();
  });
});
