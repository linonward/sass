import Link from "next/link";

import siteConfig from "../../../site.config";
import { SiteLogo } from "./site-logo";

export function SiteFooter() {
  const groups = siteConfig.nav.footer;

  return (
    <footer className="border-t">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-[2fr_repeat(3,1fr)]">
        <div className="space-y-3">
          <SiteLogo />
          <p className="text-muted-foreground max-w-xs text-sm">
            {siteConfig.description}
          </p>
        </div>
        {groups.map((group) => (
          <nav key={group.title} aria-label={group.title}>
            <h2 className="text-sm font-medium">{group.title}</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {group.links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-muted-foreground hover:text-primary transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="text-muted-foreground mx-auto max-w-6xl px-4 pb-8 text-xs">
        © {new Date().getFullYear()} {siteConfig.name}
      </div>
    </footer>
  );
}
