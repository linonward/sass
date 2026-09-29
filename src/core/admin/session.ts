import { notFound } from "next/navigation";
import { cache } from "react";

import { getSession } from "@/core/auth/session";

import { adminEnabled } from "./index";
import { isAdmin } from "./roles";

/**
 * The admin session for the current request; null when signed out, not an admin, or
 * features.admin is off.
 */
export const getAdminSession = cache(async () => {
  if (!adminEnabled) return null;
  const session = await getSession();
  return session && isAdmin(session.user) ? session : null;
});

/**
 * Call at the top of admin pages: returns 404 for non-admins (doesn't reveal that the admin panel
 * exists, and doesn't redirect to sign-in). Layout and page render in parallel, so a check in the
 * layout can't guard the page — every page must call this.
 */
export async function requireAdmin() {
  return (await getAdminSession()) ?? notFound();
}
