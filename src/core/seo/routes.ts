import { legalPages } from "@/core/legal/pages";

/**
 * 需要进入 sitemap 的营销页路径（不含语言前缀）。
 * 新增营销页时在这里登记。
 */
export const marketingRoutes: readonly string[] = [
  "/",
  "/pricing",
  ...Object.values(legalPages),
];
