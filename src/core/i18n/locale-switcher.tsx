"use client";

import { LanguagesIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import {
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
} from "@/core/i18n/locale-cookie";
import { usePathname } from "@/core/i18n/navigation";
import { Button } from "@/core/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/core/ui/dropdown-menu";

/** A locale's name for itself, e.g. zh → 中文, de → Deutsch. */
export function nativeName(locale: string) {
  return (
    new Intl.DisplayNames([locale], { type: "language" }).of(locale) ?? locale
  );
}

/**
 * Switches to the current page in another locale.
 * Does a full-page navigation to the prefixed URL (even for the default locale, e.g. /en/pricing),
 * and the default locale then 307s to the unprefixed URL. Client-side routing wouldn't update the
 * address bar when following that redirect.
 *
 * The locale preference is also recorded here: the cookie means "the user explicitly chose this
 * locale", so **this is the only place in the repo that writes it** (visiting a /zh link doesn't
 * count; the proxy deletes the copy the middleware writes, see src/proxy.ts). Without it, a
 * Chinese-language browser switching to English would only change this one URL, and the next visit
 * to / would send it back to Chinese based on the browser language.
 */
export function useSwitchLocale() {
  const pathname = usePathname();
  return (next: string) => {
    const path = pathname === "/" ? "" : pathname;
    // The next step is a full-page navigation, so writing document.cookie is enough; no need to wait
    // for a server response (same as core/ui/sidebar.tsx).
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- needs a full-page navigation, see above
    window.location.assign(`/${next}${path}${window.location.search}`);
  };
}

export function LocaleSwitcher({ locales }: { locales: readonly string[] }) {
  const t = useTranslations("Locale");
  const locale = useLocale();
  const switchTo = useSwitchLocale();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" aria-label={t("switch")} />}
      >
        <LanguagesIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        <DropdownMenuRadioGroup
          value={locale}
          onValueChange={(next: string) => switchTo(next)}
        >
          {locales.map((l) => (
            <DropdownMenuRadioItem key={l} value={l} lang={l}>
              {nativeName(l)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
