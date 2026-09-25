import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc,
  defaultStatements,
  userAc,
} from "better-auth/plugins/admin/access";

export const ADMIN_ROLE = "admin";

/**
 * Better Auth admin 插件的权限：admin 角色保留默认权限，但去掉模拟登录（impersonate），
 * v1 不提供这个功能，也不让它能通过 /api/auth/admin/impersonate-user 调用。
 */
const ac = createAccessControl(defaultStatements);

export const adminAccess = {
  ac,
  roles: {
    admin: ac.newRole({
      ...adminAc.statements,
      user: adminAc.statements.user.filter(
        (permission) => !permission.startsWith("impersonate"),
      ),
    }),
    user: ac.newRole(userAc.statements),
  },
};

type RoleHolder = { role?: string | null };

/** 用户是否有 admin 角色。插件把多个角色存成逗号分隔的字符串。 */
export function isAdmin(user: RoleHolder | null | undefined): boolean {
  return Boolean(
    user?.role
      ?.split(",")
      .map((role) => role.trim())
      .includes(ADMIN_ROLE),
  );
}

/**
 * 登录时是否要把这个用户提升为 admin：邮箱在 ADMIN_EMAILS 里、已验证，且还不是 admin。
 * 只提升不降级：从 ADMIN_EMAILS 删掉邮箱不会收回已有的 admin 角色。
 */
export function shouldPromoteToAdmin(
  user: RoleHolder & { email: string; emailVerified: boolean },
  adminEmails: readonly string[],
): boolean {
  return (
    user.emailVerified &&
    adminEmails.includes(user.email.toLowerCase()) &&
    !isAdmin(user)
  );
}

/** 提升后的角色：保留已有的其他角色。 */
export function withAdminRole(role: string | null | undefined): string {
  const roles = (role ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter((r) => r && r !== "user");
  return [ADMIN_ROLE, ...roles.filter((r) => r !== ADMIN_ROLE)].join(",");
}
