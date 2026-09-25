"use client";

import { LanguagesIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { usePathname } from "@/core/i18n/navigation";
import { Button } from "@/core/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/core/ui/dropdown-menu";

/** 语言的自称，例如 zh → 中文、de → Deutsch。 */
function nativeName(locale: string) {
  return (
    new Intl.DisplayNames([locale], { type: "language" }).of(locale) ?? locale
  );
}

export function LocaleSwitcher({ locales }: { locales: readonly string[] }) {
  const t = useTranslations("Locale");
  const locale = useLocale();
  const pathname = usePathname();

  // 整页跳到带前缀的地址（默认语言也带，如 /en/pricing），由 proxy 更新语言 cookie，
  // 默认语言再 307 到无前缀地址。客户端路由跟随这次重定向时不会更新地址栏。
  function switchTo(next: string) {
    const path = pathname === "/" ? "" : pathname;
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- 需要整页跳转，原因见上
    window.location.assign(`/${next}${path}${window.location.search}`);
  }

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
