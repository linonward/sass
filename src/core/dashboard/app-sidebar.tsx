"use client";

import { useTranslations } from "next-intl";

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
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/core/ui/sidebar";

import { dashboardIconComponents } from "./icons";
import { isActiveNav, type DashboardNav, type NavEntry } from "./nav";

function NavGroup({
  items,
  label,
}: {
  items: readonly NavEntry[];
  label: string;
}) {
  const t = useTranslations("Dashboard.nav");
  const tb = useTranslations("Dashboard");
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  if (items.length === 0) return null;

  return (
    <SidebarGroup>
      {/* Visible group heading. aria-hidden is intentional: the group's accessible name comes
          from the aria-label on the SidebarMenu below (nav.test.tsx and e2e both find the list
          by it), and exposing it here too would make screen readers announce the same name
          twice. For the same reason, don't switch to aria-labelledby — the uppercase
          text-transform would leak into the accessible name, which browsers apply and jsdom
          doesn't.

          `group-data-[collapsible=icon]:hidden` overrides the primitive's built-in
          `-mt-8 opacity-0`: that approach leaves a 32px-tall transparent box which, when
          collapsed, becomes an invisible click layer over the last item of the previous group.
          display:none takes it out of the flow with the same vertical footprint. */}
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
            // App item keys come from config; the messages test guarantees they exist.
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
                {/* The count sits outside the link so the link's accessible name stays the menu item itself (e2e finds it by that). */}
                {item.badge ? (
                  <SidebarMenuBadge
                    aria-label={tb("navBadge", { count: item.badge })}
                    data-testid={`nav-badge-${item.key}`}
                  >
                    {item.badge}
                  </SidebarMenuBadge>
                ) : null}
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
    <Sidebar
      collapsible="icon"
      aria-label={t("sidebar")}
      labels={{
        title: t("sidebar"),
        description: t("sidebarDescription"),
      }}
    >
      <SidebarHeader>{header}</SidebarHeader>
      <SidebarContent>
        <NavGroup items={nav.suite} label={t("suiteNav")} />
        <NavGroup items={nav.business} label={t("businessNav")} />
        <NavGroup items={nav.admin ?? []} label={t("adminNav")} />
      </SidebarContent>
      <SidebarFooter>{footer}</SidebarFooter>
      <SidebarRail label={t("toggleSidebar")} />
    </Sidebar>
  );
}
