import { describe, expect, test } from "vitest";

import { adminEmailsSchema } from "./env";
import {
  adminAccess,
  isAdmin,
  shouldPromoteToAdmin,
  withAdminRole,
} from "./roles";

describe("ADMIN_EMAILS", () => {
  test("逗号分隔，去空格，转小写", () => {
    expect(
      adminEmailsSchema.parse(" Me@Example.com, ops@example.com ,"),
    ).toEqual(["me@example.com", "ops@example.com"]);
  });

  test("拒绝不是邮箱的值和空列表", () => {
    expect(adminEmailsSchema.safeParse("me@example.com,nope").success).toBe(
      false,
    );
    expect(adminEmailsSchema.safeParse(" , ").success).toBe(false);
  });
});

describe("角色", () => {
  test("isAdmin 识别逗号分隔的多角色", () => {
    expect(isAdmin({ role: "admin" })).toBe(true);
    expect(isAdmin({ role: "editor, admin" })).toBe(true);
    expect(isAdmin({ role: "user" })).toBe(false);
    expect(isAdmin({ role: null })).toBe(false);
    expect(isAdmin(null)).toBe(false);
  });

  test("只提升邮箱已验证、在名单里、还不是 admin 的用户（大小写不敏感）", () => {
    const list = ["boss@example.com"];
    const user = {
      email: "Boss@Example.com",
      emailVerified: true,
      role: "user",
    };
    expect(shouldPromoteToAdmin(user, list)).toBe(true);
    expect(shouldPromoteToAdmin({ ...user, emailVerified: false }, list)).toBe(
      false,
    );
    expect(shouldPromoteToAdmin({ ...user, role: "admin" }, list)).toBe(false);
    expect(
      shouldPromoteToAdmin({ ...user, email: "other@example.com" }, list),
    ).toBe(false);
  });

  test("提升时替换 user、保留其他角色", () => {
    expect(withAdminRole(null)).toBe("admin");
    expect(withAdminRole("user")).toBe("admin");
    expect(withAdminRole("editor")).toBe("admin,editor");
  });

  test("admin 角色不能模拟登录，其他管理权限保留", () => {
    const { admin, user } = adminAccess.roles;
    expect(admin.authorize({ user: ["impersonate"] }).success).toBe(false);
    expect(admin.authorize({ user: ["impersonate-admins"] }).success).toBe(
      false,
    );
    expect(admin.authorize({ user: ["ban", "list", "get"] }).success).toBe(
      true,
    );
    expect(user.authorize({ user: ["ban"] }).success).toBe(false);
  });
});
