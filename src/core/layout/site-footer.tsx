import { useTranslations } from "next-intl";
import { Link } from "@/core/i18n/navigation";
import siteConfig from "../../../site.config";
import { footerNav } from "./footer-nav";
import { SiteLogo } from "./site-logo";

export function SiteFooter() {
  const t = useTranslations();
  const nav = (key: string) => t(`Nav.${key}` as "Nav.features");
  return (
    <footer className="bg-background border-t">
      <div className="container-marketing flex flex-col gap-8 py-8 sm:flex-row sm:items-start sm:justify-between">
        <SiteLogo />
        <div className="flex flex-col gap-4 sm:items-end">
          {footerNav(siteConfig).map((group) => (
            <nav key={group.key} aria-label={nav(group.key)}>
              <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-muted-foreground hover:text-primary-text inline-flex min-h-10 items-center"
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
      <div className="container-marketing text-muted-foreground pb-6 text-xs">
        {t("Footer.copyright", {
          year: new Date().getFullYear(),
          name: siteConfig.name,
        })}
      </div>
    </footer>
  );
}
