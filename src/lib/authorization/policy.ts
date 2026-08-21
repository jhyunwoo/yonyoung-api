import {
  isMemberLikeRoleValue,
  normalizeLegacyRole,
} from "../../shared/auth/roles";
import { type Action, type Resource, type Role } from "./types";

type PermissionMatrix = Record<Role, Record<Resource, Record<Action, boolean>>>;

const allTrue = {
  create: true,
  read: true,
  update: true,
  delete: true,
} as const;

const readOnly = {
  create: false,
  read: true,
  update: false,
  delete: false,
} as const;

const noAccess = {
  create: false,
  read: false,
  update: false,
  delete: false,
} as const;

const roleLevel: Record<Role, number> = {
  unverified: 0,
  new_member: 1,
  associate_member: 1,
  regular_member: 1,
  manager: 2,
  vice_president: 3,
  president: 4,
};

/**
 * 역할 문자열을 내부 권한 역할로 정규화한다.
 * 알 수 없는 값은 보수적으로 "unverified"로 처리한다.
 */
export const normalizeRole = (rawRole: string | null | undefined): Role => {
  return normalizeLegacyRole(rawRole);
};

export const canAssignRole = (
  actorRole: Role,
  targetRoleRaw: string | null | undefined,
): boolean => {
  const targetRole = normalizeRole(targetRoleRaw);
  return roleLevel[targetRole] <= roleLevel[actorRole];
};

export const isMemberLikeRole = (role: Role): boolean => {
  return isMemberLikeRoleValue(role);
};

/** 관리자, 부회장, 회장 역할인지 확인한다. */
export const isManagerLikeRole = (role: Role): boolean => {
  return roleLevel[role] >= roleLevel.manager;
};

const permissionMatrix: PermissionMatrix = {
  president: {
    generation: { ...allTrue },
    activity: { ...allTrue },
    exhibition: { ...allTrue },
    linktree: { ...allTrue },
    user: { ...allTrue },
    site_setting: { ...allTrue },
  },
  vice_president: {
    generation: { ...allTrue, delete: false },
    activity: { ...allTrue },
    exhibition: { ...allTrue, delete: false },
    linktree: { ...allTrue },
    user: { ...allTrue },
    site_setting: { ...allTrue },
  },
  manager: {
    generation: { ...readOnly },
    activity: { create: true, read: true, update: true, delete: true },
    exhibition: { create: true, read: true, update: true, delete: false },
    linktree: { create: true, read: true, update: true, delete: true },
    user: { ...readOnly },
    site_setting: { ...readOnly },
  },
  new_member: {
    generation: { ...readOnly },
    activity: { ...readOnly },
    exhibition: { ...readOnly },
    linktree: { ...readOnly },
    user: { ...readOnly },
    site_setting: { ...readOnly },
  },
  associate_member: {
    generation: { ...readOnly },
    activity: { ...readOnly },
    exhibition: { ...readOnly },
    linktree: { ...readOnly },
    user: { ...readOnly },
    site_setting: { ...readOnly },
  },
  regular_member: {
    generation: { ...readOnly },
    activity: { ...readOnly },
    exhibition: { ...readOnly },
    linktree: { ...readOnly },
    user: { ...readOnly },
    site_setting: { ...readOnly },
  },
  unverified: {
    generation: { ...noAccess },
    activity: { ...noAccess },
    exhibition: { ...noAccess },
    linktree: { ...noAccess },
    user: { ...noAccess },
    site_setting: { ...noAccess },
  },
};

export const can = (role: Role, resource: Resource, action: Action): boolean => {
  return permissionMatrix[role][resource][action];
};
