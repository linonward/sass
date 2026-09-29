import { adminEnabled, isAdmin } from "@/core/admin";
import { SIGN_IN_PATH } from "@/core/auth/routes";
import { getSession } from "@/core/auth/session";
import { adminEntryNav, dashboardNav } from "@/core/dashboard/nav";
import { DashboardShell } from "@/core/dashboard/shell";
import { redirect } from "@/core/i18n/navigation";

import siteConfig from "../../../../site.config";

// Signed-in pages. The proxy only checks that the cookie exists; this layout verifies the session.
export default async function AppLayout({
  children,
  params,
}: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  const session = await getSession();
  if (!session) return redirect({ href: SIGN_IN_PATH, locale });

  const nav = dashboardNav(siteConfig);
  // Admins get an extra link into the admin area.
  const showAdmin = adminEnabled && isAdmin(session.user);

  return (
    <DashboardShell
      locale={locale}
      session={session}
      nav={showAdmin ? { ...nav, admin: [adminEntryNav] } : nav}
    >
      {children}
    </DashboardShell>
  );
}
