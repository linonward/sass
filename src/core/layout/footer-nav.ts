import { changelogPath } from "@/core/changelog/paths";
import type { NavLink, SiteConfig } from "@/core/config/schema";

type FooterGroup = { key: string; links: NavLink[] };

/**
 * Links shown in the footer.
 *
 * For pages behind a feature flag, the entry follows the flag: when `changelog.enabled` is off,
 * `/changelog` returns 404, so the footer shouldn't keep a dead link. All other links are emitted
 * exactly as configured (`nav.footer` is a literal the buyer edits directly).
 *
 * It's a pure function that takes the whole config so a test can feed it a config with the flag
 * off and cover the "entry disappears" branch; pages just call `footerNav(siteConfig)`.
 * `suiteNav(config)` in `src/core/dashboard/nav.ts` has the same shape.
 */
export function footerNav(config: SiteConfig): FooterGroup[] {
  return config.nav.footer.map((group) => ({
    ...group,
    links: group.links.filter(
      (link) => link.href !== changelogPath || config.changelog.enabled,
    ),
  }));
}
