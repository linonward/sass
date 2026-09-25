import { getTranslations } from "next-intl/server";
import { cookies } from "next/headers";

import { signOut } from "@/core/auth/actions";
import { SIGN_IN_PATH } from "@/core/auth/routes";
import { getSession } from "@/core/auth/session";
import { AppSidebar } from "@/core/dashboard/app-sidebar";
import { dashboardNav } from "@/core/dashboard/nav";
import { SidebarBrand } from "@/core/dashboard/sidebar-brand";
import { UserMenu } from "@/core/dashboard/user-menu";
import { redirect } from "@/core/i18n/navigation";
import { routing } from "@/core/i18n/routing";
import { ThemeToggle } from "@/core/theme/theme-toggle";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/core/ui/sidebar";
import { TooltipProvider } from "@/core/ui/tooltip";

import siteConfig from "../../../../site.config";

// 登录后的页面。proxy 只看 cookie 是否存在，这里再校验 session 是否有效。
export default async function AppLayout({
  children,
  params,
}: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  const session = await getSession();
  if (!session) return redirect({ href: SIGN_IN_PATH, locale });

  const t = await getTranslations({ locale, namespace: "Dashboard" });
  // 侧边栏的展开状态由 SidebarProvider 写进 cookie，服务端据此渲染，刷新时不闪。
  const sidebarOpen = (await cookies()).get("sidebar_state")?.value !== "false";
  const { name, email, image } = session.user;

  return (
    <TooltipProvider>
      <SidebarProvider defaultOpen={sidebarOpen}>
        <AppSidebar
          nav={dashboardNav(siteConfig)}
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
