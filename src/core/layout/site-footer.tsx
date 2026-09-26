import { useTranslations } from "next-intl";

import { Link } from "@/core/i18n/navigation";

import siteConfig from "../../../site.config";
import { SiteLogo } from "./site-logo";

export function SiteFooter() {
  const t = useTranslations();
  // 导航 key 来自配置，运行时由 messages 测试保证存在。
  const nav = (key: string) => t(`Nav.${key}` as "Nav.features");

  return (
    // 深色锚点带，两套主题下都保持深色。不用 bg-foreground 反相：
    // 暗色主题下 foreground 是浅色，会把页脚翻成一片白。
    <footer className="bg-footer text-footer-foreground">
      {/* 用 flex + 换行而不是固定列数：footer 分组数量来自配置，写死列数会留空或挤行。 */}
      <div className="container-marketing flex flex-col gap-10 py-14 sm:flex-row sm:justify-between sm:gap-16">
        <div className="max-w-xs space-y-3">
          <SiteLogo />
          <p className="text-sm opacity-70">{t("Footer.tagline")}</p>
        </div>
        <div className="flex flex-wrap gap-12 sm:gap-16">
          {siteConfig.nav.footer.map((group) => (
            <nav key={group.key} aria-label={nav(group.key)}>
              <h2 className="text-sm font-medium">{nav(group.key)}</h2>
              <ul className="mt-4 space-y-2.5 text-sm">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="inline-block opacity-70 transition-opacity hover:opacity-100"
                    >
                      {nav(link.key)}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
      </div>
      <div className="container-marketing border-t border-current/15 py-6 text-xs opacity-60">
        {t("Footer.copyright", {
          year: new Date().getFullYear(),
          name: siteConfig.name,
        })}
      </div>
    </footer>
  );
}
