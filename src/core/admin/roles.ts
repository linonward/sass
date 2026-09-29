import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc,
  defaultStatements,
  userAc,
} from "better-auth/plugins/admin/access";

export const ADMIN_ROLE = "admin";

/**
 * Permissions for the Better Auth admin plugin: the admin role keeps the default permissions minus
 * impersonation. v1 doesn't offer that feature, and it must not be callable through
 * /api/auth/admin/impersonate-user either.
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

/** Whether the user has the admin role. The plugin stores multiple roles as a comma-separated string. */
export function isAdmin(user: RoleHolder | null | undefined): boolean {
  return Boolean(
    user?.role
      ?.split(",")
      .map((role) => role.trim())
      .includes(ADMIN_ROLE),
  );
}

/**
 * Whether to promote this user to admin on sign-in: the email is in ADMIN_EMAILS, verified, and
 * the user isn't admin yet. Promote only, never demote: removing an email from ADMIN_EMAILS doesn't
 * revoke an existing admin role.
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

/** Roles after promotion: keeps any other existing roles. */
export function withAdminRole(role: string | null | undefined): string {
  const roles = (role ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter((r) => r && r !== "user");
  return [ADMIN_ROLE, ...roles.filter((r) => r !== ADMIN_ROLE)].join(",");
}
