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
      <div className="container-marketing flex flex-col gap-10 py-10 sm:flex-row sm:items-start sm:justify-between">
        <SiteLogo />
        <div className="grid grid-cols-2 gap-x-8 gap-y-8 sm:flex sm:flex-wrap sm:gap-x-16 lg:gap-x-24">
          {footerNav(siteConfig).map((group) => (
            <nav
              key={group.key}
              aria-label={nav(group.key)}
              className="min-w-0"
            >
              <h2 className="mb-3 text-sm font-semibold">{nav(group.key)}</h2>
              <ul className="flex flex-col text-sm">
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
