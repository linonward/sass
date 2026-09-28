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

const adminReferralsNav: DashboardNavItem = {
  key: "adminReferrals",
  href: "/admin/referrals",
  icon: "users",
};

const leadsNav: DashboardNavItem = {
  key: "adminLeads",
  href: "/admin/leads",
  icon: "fileText",
};

// 只在状态页开启时出现的后台项，和归因 / 留资报表一样排在 Metrics 之后。
const adminStatusNav: DashboardNavItem = {
  key: "adminStatus",
  href: "/admin/status",
  icon: "layers",
};

// 只在 apiKeys 模块开启时出现的后台项，排在 Users 之后：和用户是同一类信息。
const adminApiKeysNav: DashboardNavItem = {
  key: "adminApiKeys",
  href: "/admin/api-keys",
  icon: "key",
};

// 只在用户面 flag 模块开启时出现的后台项，排在 Metrics 之后。
const flagsNav: DashboardNavItem = {
  key: "adminFlags",
  href: "/admin/flags",
  icon: "flag",
};

/**
 * /admin 里的菜单。获客报表、线索管理、邀请管理、状态页、feature flags 和 API Key 报表只在对应模块开启时出现 ——
 * 关闭时那些页面 404，菜单里留一个点进去就 404 的入口只会让人以为坏了。
 * 顺序：Metrics →（flags / 归因 / 留资报表）→（邀请管理 / 状态页）→ Users →（API Key 报表）→ Orders → Subscriptions。
 */
export function adminNav(
  config: Pick<
    SiteConfig,
    "acquisition" | "apiKeys" | "statusPage" | "userFlags"
  >,
): readonly DashboardNavItem[] {
  const [metrics, users, ...rest] = adminNavBase;
  return [
    metrics!,
    ...(config.userFlags.enabled ? [flagsNav] : []),
    ...(config.acquisition.attribution.enabled ? [acquisitionNav] : []),
    ...(config.acquisition.leads.enabled ? [leadsNav] : []),
    ...(config.acquisition.referrals.enabled ? [adminReferralsNav] : []),
    ...(config.statusPage.enabled ? [adminStatusNav] : []),
    users!,
    ...(config.apiKeys.enabled ? [adminApiKeysNav] : []),
    ...rest,
  ];
}

// 只在对应模块开启时显示的套件项，排在 Dashboard 之后。
const playgroundNav: DashboardNavItem = {
  key: "playground",
  href: "/playground",
  icon: "sparkles",
};
// 示例业务模块（发票 CRUD）的入口。开关在 site.config.ts 的 features.examples。
const invoicesNav: DashboardNavItem = {
  key: "invoices",
  href: "/invoices",
  icon: "receipt",
};
const referralsNav: DashboardNavItem = {
  key: "referrals",
  href: "/referrals",
  icon: "users",
};
const apiKeysNav: DashboardNavItem = {
  key: "apiKeys",
  href: "/api-keys",
  icon: "key",
};

/** 侧边栏的两组菜单：套件项和业务项。开启的模块会在套件项里多出对应入口。 */
export function dashboardNav(
  config: Pick<
    SiteConfig,
    "dashboard" | "features" | "acquisition" | "apiKeys"
  >,
): DashboardNav {
  const optional = [
    ...(config.features.ai ? [playgroundNav] : []),
    ...(config.features.examples.invoices ? [invoicesNav] : []),
    ...(config.acquisition.referrals.enabled ? [referralsNav] : []),
    ...(config.apiKeys.enabled ? [apiKeysNav] : []),
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
