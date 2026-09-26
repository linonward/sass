import { requireAdmin } from "@/core/admin/session";
import { adminNav, suiteNav } from "@/core/dashboard/nav";
import { DashboardShell } from "@/core/dashboard/shell";

// 后台（features.admin）。不是管理员（含未登录）一律 404，不跳转登录页，不暴露后台的存在。
// layout 和 page 并行渲染，每个页面还会各自调用 requireAdmin()。
export default async function AdminLayout({
  children,
  params,
}: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  const session = await requireAdmin();

  return (
    <DashboardShell
      locale={locale}
      session={session}
      nav={{ suite: [suiteNav[0]!], business: [], admin: adminNav }}
      width="wide"
    >
      {children}
    </DashboardShell>
  );
}
