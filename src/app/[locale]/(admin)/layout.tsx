import { requireAdmin } from "@/core/admin/session";
import { adminNav, suiteNav } from "@/core/dashboard/nav";
import { DashboardShell } from "@/core/dashboard/shell";
import { getDb } from "@/core/db";
import { countOpenExceptions } from "@/core/exceptions/queries";

import siteConfig from "../../../../site.config";

// Admin area (features.admin). Anyone who isn't an admin (including signed-out visitors) gets a 404 —
// no redirect to sign-in, nothing that reveals the admin exists. Layout and page render in parallel,
// so every page also calls requireAdmin() itself.
export default async function AdminLayout({
  children,
  params,
}: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  const session = await requireAdmin();
  // Show the pending exception count on the sidebar's Exceptions item so nothing sits unnoticed.
  const openExceptions = await countOpenExceptions(getDb());
  const admin = adminNav(siteConfig).map((item) =>
    item.key === "adminExceptions" ? { ...item, badge: openExceptions } : item,
  );

  return (
    <DashboardShell
      locale={locale}
      session={session}
      nav={{ suite: [suiteNav[0]!], business: [], admin }}
      width="wide"
    >
      {children}
    </DashboardShell>
  );
}
