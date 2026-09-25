import { useTranslations } from "next-intl";

import { LocaleSwitcher } from "@/core/i18n/locale-switcher";
import { Link } from "@/core/i18n/navigation";
import { routing } from "@/core/i18n/routing";
import { ThemeToggle } from "@/core/theme/theme-toggle";

import siteConfig from "../../../site.config";
import { MobileNav } from "./mobile-nav";
import { SiteLogo } from "./site-logo";

export function SiteHeader() {
  const t = useTranslations();
  const links = siteConfig.nav.header.map((link) => ({
    href: link.href,
    label: t(`Nav.${link.key}` as "Nav.features"),
  }));

  return (
    <header className="bg-background/80 sticky top-0 z-40 border-b backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
        <SiteLogo />
        <nav
          className="hidden items-center gap-6 text-sm md:flex"
          aria-label={t("Header.main")}
        >
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-muted-foreground hover:text-primary transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          {routing.locales.length > 1 && (
            <LocaleSwitcher locales={routing.locales} />
          )}
          <ThemeToggle />
          {links.length > 0 && (
            <MobileNav title={siteConfig.name} links={links} />
          )}
        </div>
      </div>
    </header>
  );
}
