import Link from "next/link";

import { ThemeToggle } from "@/core/theme/theme-toggle";

import siteConfig from "../../../site.config";
import { MobileNav } from "./mobile-nav";
import { SiteLogo } from "./site-logo";

export function SiteHeader() {
  const links = siteConfig.nav.header;

  return (
    <header className="bg-background/80 sticky top-0 z-40 border-b backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
        <SiteLogo />
        <nav
          className="hidden items-center gap-6 text-sm md:flex"
          aria-label="Main"
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
          <ThemeToggle />
          {links.length > 0 && (
            <MobileNav title={siteConfig.name} links={links} />
          )}
        </div>
      </div>
    </header>
  );
}
