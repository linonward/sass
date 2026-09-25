import type { DashboardNavItem, SiteConfig } from "@/core/config/schema";

/** 套件自带的菜单项。业务项写在 site.config.ts 的 dashboard.nav，排在这些之后。 */
export const suiteNav: readonly DashboardNavItem[] = [
  { key: "home", href: "/dashboard", icon: "home" },
  { key: "billing", href: "/billing", icon: "creditCard" },
  { key: "settings", href: "/settings", icon: "settings" },
];

export type DashboardNav = {
  suite: readonly DashboardNavItem[];
  business: readonly DashboardNavItem[];
};

// 只在对应模块开启时显示的套件项，排在 Dashboard 之后。
const playgroundNav: DashboardNavItem = {
  key: "playground",
  href: "/playground",
  icon: "sparkles",
};

/** 侧边栏的两组菜单：套件项和业务项。`features.ai` 开启时套件项里多一个 Playground。 */
export function dashboardNav(
  config: Pick<SiteConfig, "dashboard" | "features">,
): DashboardNav {
  const suite = config.features.ai
    ? [suiteNav[0]!, playgroundNav, ...suiteNav.slice(1)]
    : suiteNav;
  return { suite, business: config.dashboard.nav };
}

/** 当前路径是否属于该菜单项：本身或其子页面。 */
export function isActiveNav(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}
