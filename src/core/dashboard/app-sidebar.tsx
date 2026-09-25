"use client";

import { useTranslations } from "next-intl";

import type { DashboardNavItem } from "@/core/config/schema";
import { Link, usePathname } from "@/core/i18n/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/core/ui/sidebar";

import { dashboardIconComponents } from "./icons";
import { isActiveNav, type DashboardNav } from "./nav";

function NavGroup({
  items,
  label,
}: {
  items: readonly DashboardNavItem[];
  label: string;
}) {
  const t = useTranslations("Dashboard.nav");
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  if (items.length === 0) return null;

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu aria-label={label}>
          {items.map((item) => {
            const Icon = dashboardIconComponents[item.icon];
            // 业务项的 key 来自配置，由 messages 测试保证存在。
            const title = t(item.key as "home");
            const active = isActiveNav(pathname, item.href);
            return (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  isActive={active}
                  tooltip={title}
                  render={
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      onClick={() => isMobile && setOpenMobile(false)}
                    />
                  }
                >
                  <Icon />
                  <span>{title}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

export function AppSidebar({
  nav,
  header,
  footer,
}: {
  nav: DashboardNav;
  header: React.ReactNode;
  footer: React.ReactNode;
}) {
  const t = useTranslations("Dashboard");

  return (
    <Sidebar collapsible="icon" aria-label={t("sidebar")}>
      <SidebarHeader>{header}</SidebarHeader>
      <SidebarContent>
        <NavGroup items={nav.suite} label={t("suiteNav")} />
        <NavGroup items={nav.business} label={t("businessNav")} />
        <NavGroup items={nav.admin ?? []} label={t("adminNav")} />
      </SidebarContent>
      <SidebarFooter>{footer}</SidebarFooter>
      <SidebarRail aria-label={t("toggleSidebar")} title={t("toggleSidebar")} />
    </Sidebar>
  );
}
