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
  /** 后台菜单：管理员在 dashboard 里看到一个入口，在 /admin 里看到完整菜单。 */
  admin?: readonly DashboardNavItem[];
};

/** 管理员在 dashboard 侧边栏里看到的后台入口。 */
export const adminEntryNav: DashboardNavItem = {
  key: "admin",
  href: "/admin",
  icon: "users",
};

const adminNavBase: readonly DashboardNavItem[] = [
  { key: "adminMetrics", href: "/admin/metrics", icon: "chart" },
  { key: "adminUsers", href: "/admin/users", icon: "users" },
  { key: "adminOrders", href: "/admin/orders", icon: "creditCard" },
  { key: "adminSubscriptions", href: "/admin/subscriptions", icon: "layers" },
];

// 只在归因模块开启时出现的后台项，排在 Metrics 之后。
const acquisitionNav: DashboardNavItem = {
  key: "adminAcquisition",
  href: "/admin/acquisition",
  icon: "sparkles",
};

const leadsNav: DashboardNavItem = {
  key: "adminLeads",
  href: "/admin/leads",
  icon: "fileText",
};

// 只在状态页开启时出现的后台项。
const statusNav: DashboardNavItem = {
  key: "adminStatus",
  href: "/admin/status",
  icon: "layers",
};

/**
 * /admin 里的菜单。可选模块的后台页只在它开启时出现 —— 关闭时那个页面 404，
 * 菜单里留一个点进去就 404 的入口只会让人以为坏了。
 */
export function adminNav(
  config: Pick<SiteConfig, "acquisition" | "statusPage">,
): readonly DashboardNavItem[] {
  const extras: DashboardNavItem[] = [];
  if (config.acquisition.attribution.enabled) extras.push(acquisitionNav);
  if (config.acquisition.leads.enabled) extras.push(leadsNav);
  if (config.statusPage.enabled) extras.push(statusNav);
  return extras.length
    ? [adminNavBase[0]!, ...extras, ...adminNavBase.slice(1)]
    : adminNavBase;
}

// 只在对应模块开启时显示的套件项，排在 Dashboard 之后。
const playgroundNav: DashboardNavItem = {
  key: "playground",
  href: "/playground",
  icon: "sparkles",
};
const referralsNav: DashboardNavItem = {
  key: "referrals",
  href: "/referrals",
  icon: "users",
};

/** 侧边栏的两组菜单：套件项和业务项。开启的模块会在套件项里多出对应入口。 */
export function dashboardNav(
  config: Pick<SiteConfig, "dashboard" | "features" | "acquisition">,
): DashboardNav {
  const optional = [
    ...(config.features.ai ? [playgroundNav] : []),
    ...(config.acquisition.referrals.enabled ? [referralsNav] : []),
  ];
  const suite = optional.length
    ? [suiteNav[0]!, ...optional, ...suiteNav.slice(1)]
    : suiteNav;
  return { suite, business: config.dashboard.nav };
}

/** 当前路径是否属于该菜单项：本身或其子页面。 */
export function isActiveNav(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}
