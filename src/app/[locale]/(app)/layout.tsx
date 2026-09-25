import { adminEnabled, isAdmin } from "@/core/admin";
import { SIGN_IN_PATH } from "@/core/auth/routes";
import { getSession } from "@/core/auth/session";
import { adminEntryNav, dashboardNav } from "@/core/dashboard/nav";
import { DashboardShell } from "@/core/dashboard/shell";
import { redirect } from "@/core/i18n/navigation";

import siteConfig from "../../../../site.config";

// 登录后的页面。proxy 只看 cookie 是否存在，这里再校验 session 是否有效。
export default async function AppLayout({
  children,
  params,
}: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  const session = await getSession();
  if (!session) return redirect({ href: SIGN_IN_PATH, locale });

  const nav = dashboardNav(siteConfig);
  // 管理员多一个进入后台的入口。
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
