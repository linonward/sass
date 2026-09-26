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
  SidebarGroupLabel,
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
      {/* 可见的分组标题。aria-hidden 是有意的：分组的可访问名由下面 SidebarMenu 的
          aria-label 提供（nav.test.tsx 和 e2e 都按它取 list），这里再暴露一次会让
          读屏把同一个名字念两遍。也因此不要改成 aria-labelledby —— 可访问名会被
          uppercase 的 text-transform 搅进来，浏览器算、jsdom 不算。

          `group-data-[collapsible=icon]:hidden` 覆盖 primitive 自带的
          `-mt-8 opacity-0`：那个写法保留了一个 32px 高的透明盒子，折叠态下会变成
          压在前一组最后一项上的隐形点击层。display:none 移出流，纵向占位一样。 */}
      <SidebarGroupLabel
        aria-hidden
        className="text-muted-foreground text-[0.7rem] tracking-wider uppercase group-data-[collapsible=icon]:hidden"
      >
        {label}
      </SidebarGroupLabel>
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
