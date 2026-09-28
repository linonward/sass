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

/** 语言的自称，例如 zh → 中文、de → Deutsch。 */
export function nativeName(locale: string) {
  return (
    new Intl.DisplayNames([locale], { type: "language" }).of(locale) ?? locale
  );
}

/**
 * 切换到另一门语言的当前页面。
 * 整页跳到带前缀的地址（默认语言也带，如 /en/pricing），默认语言再 307 到无前缀地址。
 * 客户端路由跟随这次重定向时不会更新地址栏。
 *
 * 语言偏好也在这一步记下来：cookie 的语义是「用户明确选过这门语言」，所以整个仓库里
 * **只有这里写它**（访问 /zh 链接不算，中间件写的那份被 proxy 删掉了，见 src/proxy.ts）。
 * 不写的话，中文浏览器切到英文只是这一次的地址变了，下次再访问 / 又被按浏览器语言送回中文。
 */
export function useSwitchLocale() {
  const pathname = usePathname();
  return (next: string) => {
    const path = pathname === "/" ? "" : pathname;
    // 下一次是整页跳转，写 document.cookie 就够，不用等服务端回包（同 core/ui/sidebar.tsx）。
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- 需要整页跳转，原因见上
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
