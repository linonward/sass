import { describe, expect, test } from "vitest";

import { adminEmailsSchema } from "./env";
import {
  adminAccess,
  isAdmin,
  shouldPromoteToAdmin,
  withAdminRole,
} from "./roles";

describe("ADMIN_EMAILS", () => {
  test("splits on commas, trims, and lowercases", () => {
    expect(
      adminEmailsSchema.parse(" Me@Example.com, ops@example.com ,"),
    ).toEqual(["me@example.com", "ops@example.com"]);
  });

  test("rejects non-email values and empty lists", () => {
    expect(adminEmailsSchema.safeParse("me@example.com,nope").success).toBe(
      false,
    );
    expect(adminEmailsSchema.safeParse(" , ").success).toBe(false);
  });
});

describe("roles", () => {
  test("isAdmin recognizes comma-separated multiple roles", () => {
    expect(isAdmin({ role: "admin" })).toBe(true);
    expect(isAdmin({ role: "editor, admin" })).toBe(true);
    expect(isAdmin({ role: "user" })).toBe(false);
    expect(isAdmin({ role: null })).toBe(false);
    expect(isAdmin(null)).toBe(false);
  });

  test("promotes only verified, listed, not-yet-admin users (case-insensitive)", () => {
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

  test("promotion replaces user and keeps other roles", () => {
    expect(withAdminRole(null)).toBe("admin");
    expect(withAdminRole("user")).toBe("admin");
    expect(withAdminRole("editor")).toBe("admin,editor");
  });

  test("the admin role can't impersonate; other admin permissions remain", () => {
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
