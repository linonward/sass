import { useTranslations } from "next-intl";

import { ArrowUpRightIcon } from "lucide-react";
import { LocaleSwitcher } from "@/core/i18n/locale-switcher";
import { Link } from "@/core/i18n/navigation";
import { routing } from "@/core/i18n/routing";
import { cn } from "@/core/lib/utils";
import { ThemeToggle } from "@/core/theme/theme-toggle";
import { buttonVariants } from "@/core/ui/button";

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
    // Solid background, no backdrop-blur: a glass effect would break the hard-edge layering of
    // the sticker system. The 2px hard shadow along the bottom speaks the same language as the
    // lips on cards in the page body.
    <header className="bg-background sticky top-0 z-40 border-b shadow-[0_2px_0_0_var(--border)]">
      <div className="container-marketing flex h-(--header-height) items-center gap-5">
        <SiteLogo />
        <nav
          className="ml-auto hidden items-center gap-1 text-sm md:flex"
          aria-label={t("Header.main")}
        >
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-muted-foreground hover:bg-muted hover:text-foreground rounded-lg px-3 py-2 transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {routing.locales.length > 1 && (
            <LocaleSwitcher locales={routing.locales} />
          )}
          <ThemeToggle />
          {/* On narrow screens keep theme, language and menu; the demo entry is in the hero copy. */}
          <Link
            href="/demo"
            className={cn(
              buttonVariants({ variant: "outline", tone: "primary" }),
              "hidden px-4 sm:inline-flex",
            )}
          >
            {t("Header.cta")}
            <ArrowUpRightIcon aria-hidden className="size-4" />
          </Link>
          {links.length > 0 && (
            <MobileNav title={siteConfig.name} links={links} />
          )}
        </div>
      </div>
    </header>
  );
}
