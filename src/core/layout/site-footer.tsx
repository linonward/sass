import { useTranslations } from "next-intl";

import { Link } from "@/core/i18n/navigation";

import siteConfig from "../../../site.config";
import { SiteLogo } from "./site-logo";

export function SiteFooter() {
  const t = useTranslations();
  // 导航 key 来自配置，运行时由 messages 测试保证存在。
  const nav = (key: string) => t(`Nav.${key}` as "Nav.features");

  return (
    <footer className="border-t">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-[2fr_repeat(3,1fr)]">
        <div className="space-y-3">
          <SiteLogo />
          <p className="text-muted-foreground max-w-xs text-sm">
            {t("Footer.tagline")}
          </p>
        </div>
        {siteConfig.nav.footer.map((group) => (
          <nav key={group.key} aria-label={nav(group.key)}>
            <h2 className="text-sm font-medium">{nav(group.key)}</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {group.links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-muted-foreground hover:text-primary transition-colors"
                  >
                    {nav(link.key)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="text-muted-foreground mx-auto max-w-6xl px-4 pb-8 text-xs">
        {t("Footer.copyright", {
          year: new Date().getFullYear(),
          name: siteConfig.name,
        })}
      </div>
    </footer>
  );
}
