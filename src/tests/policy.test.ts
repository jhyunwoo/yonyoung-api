import { describe, expect, it } from "vitest";
import {
  can,
  isManagerLikeRole,
  normalizeRole,
} from "../lib/authorization/policy";

describe("authorization policy",() => {
  it("제거된 user role 문자열은 unverified로 정규화한다",() => {
    expect(normalizeRole("user")).toBe("unverified");
  });

  it("제거된 member role 문자열은 regular_member로 정규화한다",() => {
    expect(normalizeRole("member")).toBe("regular_member");
  });

  it("알 수 없는 role은 unverified로 정규화한다",() => {
    expect(normalizeRole("something-else")).toBe("unverified");
    expect(normalizeRole(null)).toBe("unverified");
  });

  it("회장은 모든 권한을 가진다",() => {
    expect(can("president", "generation", "delete")).toBe(true);
    expect(can("president", "user", "update")).toBe(true);
  });

  it("부회장은 활동/전시/링크트리 생성·수정이 가능하고 일부 delete만 제한된다",() => {
    expect(can("vice_president", "generation", "delete")).toBe(false);
    expect(can("vice_president", "exhibition", "delete")).toBe(false);
    expect(can("vice_president", "activity", "create")).toBe(true);
    expect(can("vice_president", "activity", "update")).toBe(true);
    expect(can("vice_president", "exhibition", "create")).toBe(true);
    expect(can("vice_president", "exhibition", "update")).toBe(true);
    expect(can("vice_president", "linktree", "create")).toBe(true);
    expect(can("vice_president", "linktree", "update")).toBe(true);
    expect(can("vice_president", "generation", "update")).toBe(true);
  });

  it("부장은 exhibition delete는 불가하고 activity delete는 가능하다",() => {
    expect(can("manager", "exhibition", "delete")).toBe(false);
    expect(can("manager", "activity", "delete")).toBe(true);
    expect(can("manager", "linktree", "create")).toBe(true);
    expect(can("manager", "site_setting", "update")).toBe(false);
  });

  it("정회원은 user 일반 조회 권한이 있다",() => {
    expect(can("regular_member", "user", "read")).toBe(true);
  });

  it("manager 이상 역할만 manager 계열로 판별한다", () => {
    expect(isManagerLikeRole("manager")).toBe(true);
    expect(isManagerLikeRole("vice_president")).toBe(true);
    expect(isManagerLikeRole("president")).toBe(true);
    expect(isManagerLikeRole("regular_member")).toBe(false);
    expect(isManagerLikeRole("unverified")).toBe(false);
  });

  it("member 계열 role은 동일 권한을 가진다",() => {
    expect(can("new_member", "activity", "read")).toBe(true);
    expect(can("new_member", "activity", "create")).toBe(false);
    expect(can("new_member", "activity", "update")).toBe(false);
    expect(can("new_member", "user", "read")).toBe(true);
    expect(can("associate_member", "activity", "create")).toBe(false);
    expect(can("associate_member", "linktree", "create")).toBe(false);
    expect(can("associate_member", "user", "read")).toBe(true);
    expect(can("regular_member", "site_setting", "read")).toBe(true);
    expect(can("regular_member", "activity", "update")).toBe(false);
    expect(can("regular_member", "user", "read")).toBe(true);
  });

  it("unverified는 어떤 리소스 권한도 없다",() => {
    expect(can("unverified", "generation", "read")).toBe(false);
    expect(can("unverified", "user", "update")).toBe(false);
    expect(can("unverified", "site_setting", "read")).toBe(false);
  });
});
