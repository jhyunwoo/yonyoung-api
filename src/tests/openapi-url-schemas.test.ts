import { describe, expect, it } from "vitest";
import {
  ApiCreateAttachmentSchema,
} from "../features/attachments/attachment.contract";
import {
  ApiCreateLinktreeItemSchema,
} from "../features/linktree/linktree.contract";
import {
  ApiUpdateSiteSettingsSchema,
} from "../features/site-settings/site-settings.contract";
import {
  ApiAdminUpdateUserSchema,
  ApiMemberProfileUpdateSchema,
} from "../features/users/user.contract";

const unsafePublicUrls = [
  "javascript:alert(document.domain)",
  "data:text/html,<script>alert(1)</script>",
] as const;

describe("public hyperlink input schemas", () => {
  it.each(unsafePublicUrls)("member personalLink에서 %s 스킴을 거부한다", (url) => {
    expect(
      ApiMemberProfileUpdateSchema.safeParse({ personalLink: url }).success,
    ).toBe(false);
  });

  it.each(unsafePublicUrls)("admin personalLink에서 %s 스킴을 거부한다", (url) => {
    expect(ApiAdminUpdateUserSchema.safeParse({ personalLink: url }).success).toBe(
      false,
    );
  });

  it.each(unsafePublicUrls)("linktree 링크에서 %s 스킴을 거부한다", (url) => {
    expect(
      ApiCreateLinktreeItemSchema.safeParse({ name: "공식 링크", link: url })
        .success,
    ).toBe(false);
  });

  it.each(unsafePublicUrls)("attachment 링크에서 %s 스킴을 거부한다", (url) => {
    expect(
      ApiCreateAttachmentSchema.safeParse({
        scope: "site_donate",
        title: "외부 자료",
        linkUrl: url,
      }).success,
    ).toBe(false);
  });

  it.each(unsafePublicUrls)("site settings 링크에서 %s 스킴을 거부한다", (url) => {
    expect(
      ApiUpdateSiteSettingsSchema.safeParse({ footerOpenChatUrl: url }).success,
    ).toBe(false);
  });

  it("http와 https 링크는 허용한다", () => {
    expect(
      ApiMemberProfileUpdateSchema.safeParse({
        personalLink: "https://example.com/profile",
      }).success,
    ).toBe(true);
    expect(
      ApiCreateLinktreeItemSchema.safeParse({
        name: "공식 링크",
        link: "http://example.com/link",
      }).success,
    ).toBe(true);
  });
});
