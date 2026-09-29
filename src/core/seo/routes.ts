import siteConfig from "../../../site.config";
import { changelogPath } from "@/core/changelog/paths";
import { legalPages } from "@/core/legal/pages";

/**
 * Marketing page paths that belong in the sitemap (without the locale prefix).
 * Register new marketing pages here. Flag-gated pages aren't registered while off — that path
 * would 404.
 *
 * /changelog is a single page (all entries are on one page with no paths of their own), so
 * registering it once here is enough; it doesn't need its own sitemap function like the blog.
 */
export const marketingRoutes: readonly string[] = [
  "/",
  "/pricing",
  ...(siteConfig.acquisition.leads.enabled ? ["/waitlist"] : []),
  ...(siteConfig.statusPage.enabled ? ["/status"] : []),
  ...(siteConfig.changelog.enabled ? [changelogPath] : []),
  ...Object.values(legalPages),
];
