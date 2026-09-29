import { requireAdmin } from "@/core/admin/session";
import { adminNav, suiteNav } from "@/core/dashboard/nav";
import { DashboardShell } from "@/core/dashboard/shell";
import { getDb } from "@/core/db";
import { countOpenExceptions } from "@/core/exceptions/queries";

import siteConfig from "../../../../site.config";

// 后台（features.admin）。不是管理员（含未登录）一律 404，不跳转登录页，不暴露后台的存在。
// layout 和 page 并行渲染，每个页面还会各自调用 requireAdmin()。
export default async function AdminLayout({
  children,
  params,
}: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  const session = await requireAdmin();
  // 待处理的异常单数挂在侧边栏的 Exceptions 上，免得异常放着没人发现。
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
