import { getTranslations } from "next-intl/server";
import { cookies } from "next/headers";

import { isAdmin } from "@/core/admin/roles";
import { signOut } from "@/core/auth/actions";
import type { Session } from "@/core/auth/server";
import { FlagsProvider } from "@/core/flags/components";
import { resolveFlags } from "@/core/flags/evaluate";
import { routing } from "@/core/i18n/routing";
import { cn } from "@/core/lib/utils";
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

/** Signed-in frame: sidebar + top bar. Shared by the (app) and (admin) layouts with different menus. */
export async function DashboardShell({
  locale,
  session,
  nav,
  width = "default",
  children,
}: {
  locale: string;
  session: Session;
  nav: DashboardNav;
  /** Content width. Admin's wide tables use `wide`; product-page forms read better in a narrow column. */
  width?: "default" | "wide";
  children: React.ReactNode;
}) {
  const t = await getTranslations({ locale, namespace: "Dashboard" });
  // SidebarProvider writes the sidebar's open state to a cookie; the server renders from it, so there
  // is no flash on reload.
  const sidebarOpen = (await cookies()).get("sidebar_state")?.value !== "false";
  const { name, email, image } = session.user;
  // This request's feature flag snapshot, handed to the client components below (see src/core/flags/).
  const flags = resolveFlags({
    userId: session.user.id,
    isAdmin: isAdmin(session.user),
  });

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
            <SidebarTrigger label={t("toggleSidebar")} className="-ml-1" />
            <div className="ml-auto flex items-center gap-1">
              <ThemeToggle />
            </div>
          </header>
          {/* SidebarInset is already a <main>, so another main can't be nested here. */}
          <div
            className={cn(
              "mx-auto w-full flex-1 px-4 py-6 md:px-8 md:py-8",
              width === "wide" ? "max-w-6xl" : "max-w-5xl",
            )}
          >
            {/* Only signed-in pages have a flag snapshot: public pages have no identity, so they can't be bucketed. */}
            <FlagsProvider values={flags}>{children}</FlagsProvider>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
