import siteConfig from "../../../site.config";
import { changelogPath } from "@/core/changelog/paths";
import { legalPages } from "@/core/legal/pages";

/**
 * 需要进入 sitemap 的营销页路径（不含语言前缀）。
 * 新增营销页时在这里登记。带开关的页面在关闭时不登记 —— 那条路径会 404。
 *
 * /changelog 是单页（条目都在同一页上，没有各自的路径），所以在这里登记一次就够，
 * 不需要像博客那样单独一个 sitemap 函数。
 */
export const marketingRoutes: readonly string[] = [
  "/",
  "/pricing",
  ...(siteConfig.acquisition.leads.enabled ? ["/waitlist"] : []),
  ...(siteConfig.statusPage.enabled ? ["/status"] : []),
  ...(siteConfig.changelog.enabled ? [changelogPath] : []),
  ...Object.values(legalPages),
];
