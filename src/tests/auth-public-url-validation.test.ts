import { beforeEach, describe, expect, it, vi } from "vitest";

const betterAuthMock = vi.hoisted(() =>
  vi.fn((options: unknown) => ({ handler: vi.fn(), options })),
);

vi.mock("better-auth", () => ({ betterAuth: betterAuthMock }));
vi.mock("better-auth/adapters/drizzle", () => ({
  drizzleAdapter: vi.fn(() => ({ adapter: "mock" })),
}));
vi.mock("better-auth/plugins", () => ({
  openAPI: vi.fn(() => ({ id: "open-api-mock" })),
}));
vi.mock("../lib/db", () => ({ default: vi.fn(() => ({ db: "mock" })) }));

import { createAuth } from "../lib/auth";

type UserBeforeHook = (user: unknown) => Promise<unknown>;

const createHooks = () => {
  createAuth({} as D1Database, {
    BETTER_AUTH_URL: "https://api.example.com",
    BETTER_AUTH_TRUSTED_ORIGINS: "https://www.example.com",
    BETTER_AUTH_SECRET: "test-better-auth-secret-at-least-32-characters",
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
  });

  const options = betterAuthMock.mock.calls[0]?.[0] as {
    databaseHooks: {
      user: {
        create: { before: UserBeforeHook };
        update: { before: UserBeforeHook };
      };
    };
  };
  return options.databaseHooks.user;
};

describe("Better Auth public URL validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("가입 및 auth 사용자 수정에서 실행 가능한 URL 스킴을 거부한다", async () => {
    const hooks = createHooks();

    await expect(
      hooks.create.before({ personalLink: "javascript:alert(1)" }),
    ).rejects.toThrow("personalLink은 http(s) URL만 사용할 수 있습니다.");
    await expect(
      hooks.update.before({ image: "data:image/svg+xml,<svg></svg>" }),
    ).rejects.toThrow("image은 http(s) URL만 사용할 수 있습니다.");
  });

  it("가입 및 auth 사용자 수정에서 정상 HTTP(S) URL을 허용한다", async () => {
    const hooks = createHooks();

    await expect(
      hooks.create.before({ personalLink: "https://example.com/portfolio" }),
    ).resolves.toBeUndefined();
    await expect(
      hooks.update.before({ image: "http://images.example.com/profile.png" }),
    ).resolves.toBeUndefined();
  });
});
