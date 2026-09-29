import type { DashboardNavItem, SiteConfig } from "@/core/config/schema";

/** The kit's built-in menu items. App items go in dashboard.nav in site.config.ts and come after these. */
export const suiteNav: readonly DashboardNavItem[] = [
  { key: "home", href: "/dashboard", icon: "home" },
  { key: "billing", href: "/billing", icon: "creditCard" },
  { key: "settings", href: "/settings", icon: "settings" },
];

/**
 * A sidebar item: the configured menu item plus a count only known at runtime (such as open
 * exceptions). `badge` shows on the right when greater than 0; 0 or omitted hides it — the count
 * disappears once it reaches zero.
 */
export type NavEntry = DashboardNavItem & { badge?: number };

export type DashboardNav = {
  suite: readonly NavEntry[];
  business: readonly NavEntry[];
  /** Admin menu: admins see a single entry in the dashboard and the full menu under /admin. */
  admin?: readonly NavEntry[];
};

/** The admin entry admins see in the dashboard sidebar. */
export const adminEntryNav: DashboardNavItem = {
  key: "admin",
  href: "/admin",
  icon: "users",
};

const adminNavBase: readonly DashboardNavItem[] = [
  { key: "adminMetrics", href: "/admin/metrics", icon: "chart" },
  { key: "adminUsers", href: "/admin/users", icon: "users" },
  { key: "adminOrders", href: "/admin/orders", icon: "creditCard" },
  // Billing exceptions page: where money or outcomes need a human to look, right next to Orders.
  // Shows the open count in the sidebar (see (admin)/layout.tsx).
  { key: "adminExceptions", href: "/admin/exceptions", icon: "receipt" },
  { key: "adminSubscriptions", href: "/admin/subscriptions", icon: "layers" },
];

// Admin items that appear only when the attribution module is on, after Metrics.
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

// Admin item that appears only when the status page is on; after Metrics like the attribution /
// lead reports.
const adminStatusNav: DashboardNavItem = {
  key: "adminStatus",
  href: "/admin/status",
  icon: "layers",
};

// Admin item that appears only when the apiKeys module is on, after Users: it's the same kind of
// information.
const adminApiKeysNav: DashboardNavItem = {
  key: "adminApiKeys",
  href: "/admin/api-keys",
  icon: "key",
};

// Admin item that appears only when the user-facing flags module is on, after Metrics.
const flagsNav: DashboardNavItem = {
  key: "adminFlags",
  href: "/admin/flags",
  icon: "flag",
};

/**
 * The /admin menu. Acquisition reports, lead management, referral management, the status page,
 * feature flags, and the API key report appear only when their module is on — when off those pages
 * 404, and a menu link that leads to a 404 only looks broken.
 * Order: Metrics → (flags / attribution / lead reports) → (referral management / status page) →
 * Users → (API key report) → Orders → Exceptions → Subscriptions.
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

// Kit items shown only when their module is on, after Dashboard.
const playgroundNav: DashboardNavItem = {
  key: "playground",
  href: "/playground",
  icon: "sparkles",
};
// Entry for the example app module (invoice CRUD). Toggled by features.examples in site.config.ts.
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

/** The sidebar's two menu groups: kit items and app items. Enabled modules add their entries to the kit items. */
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

/** Whether the current path belongs to the menu item: the item itself or one of its subpages. */
export function isActiveNav(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}
