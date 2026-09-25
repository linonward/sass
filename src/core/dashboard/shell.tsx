import { getTranslations } from "next-intl/server";
import { cookies } from "next/headers";

import { signOut } from "@/core/auth/actions";
import type { Session } from "@/core/auth/server";
import { routing } from "@/core/i18n/routing";
import { IdentifyUser } from "@/core/observability/identify-user";
import { ThemeToggle } from "@/core/theme/theme-toggle";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/core/ui/sidebar";
import { TooltipProvider } from "@/core/ui/tooltip";

import { AppSidebar } from "./app-sidebar";
import type { DashboardNav } from "./nav";
import { SidebarBrand } from "./sidebar-brand";
import { UserMenu } from "./user-menu";

/** 登录后的外框：侧边栏 + 顶栏。(app) 和 (admin) 两个 layout 共用，菜单不同。 */
export async function DashboardShell({
  locale,
  session,
  nav,
  children,
}: {
  locale: string;
  session: Session;
  nav: DashboardNav;
  children: React.ReactNode;
}) {
  const t = await getTranslations({ locale, namespace: "Dashboard" });
  // 侧边栏的展开状态由 SidebarProvider 写进 cookie，服务端据此渲染，刷新时不闪。
  const sidebarOpen = (await cookies()).get("sidebar_state")?.value !== "false";
  const { name, email, image } = session.user;

  return (
    <TooltipProvider>
      <IdentifyUser userId={session.user.id} />
      <SidebarProvider defaultOpen={sidebarOpen}>
        <AppSidebar
          nav={nav}
          header={<SidebarBrand />}
          footer={
            <UserMenu
              user={{ name, email, image }}
              locales={routing.locales}
              signOut={signOut.bind(null, locale)}
            />
          }
        />
        <SidebarInset>
          <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger aria-label={t("toggleSidebar")} className="-ml-1" />
            <div className="ml-auto flex items-center gap-1">
              <ThemeToggle />
            </div>
          </header>
          {/* SidebarInset 本身就是 <main>，这里不能再嵌套一个 main。 */}
          <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 md:px-8">
            {children}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
