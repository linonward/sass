import { changelogPath } from "@/core/changelog/paths";
import type { NavLink, SiteConfig } from "@/core/config/schema";

type FooterGroup = { key: string; links: NavLink[] };

/**
 * 页脚要显示的链接。
 *
 * 带开关的页面，入口跟着开关走：`changelog.enabled` 关掉时 `/changelog` 返回 404，
 * 页脚就不该还留着一个死链。其余的链接照配置原样输出（`nav.footer` 是买家直接改的字面量）。
 *
 * 这是纯函数、参数收整份配置，为的是能直接喂一份关掉开关的配置测「入口消失」那一支；
 * 页面里用 `footerNav(siteConfig)` 即可。`src/core/dashboard/nav.ts` 的 `suiteNav(config)`
 * 是同一个形状。
 */
export function footerNav(config: SiteConfig): FooterGroup[] {
  return config.nav.footer.map((group) => ({
    ...group,
    links: group.links.filter(
      (link) => link.href !== changelogPath || config.changelog.enabled,
    ),
  }));
}
