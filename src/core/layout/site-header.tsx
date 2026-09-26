import { useTranslations } from "next-intl";

import { SIGN_IN_PATH } from "@/core/auth/routes";
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
    // 实底，不做 backdrop-blur：玻璃感会击碎贴纸那套硬边的分层逻辑。
    // 底边那条 2px 硬阴影和正文里卡片的唇边是同一套语言。
    <header className="bg-background sticky top-0 z-40 border-b shadow-[0_2px_0_0_var(--border)]">
      <div className="container-marketing flex h-(--header-height) items-center gap-8">
        <SiteLogo />
        <nav
          className="hidden items-center gap-1 text-sm md:flex"
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
          {/* 顶栏 CTA 去登录页。刻意不叫 "Get started"：那个名字是 hero 主 CTA 的，
              e2e 用 getByRole 精确定位它，出现第二个同名链接会让严格模式报错。

              窄屏藏起来：375px 下 logo + 主题 + CTA + 汉堡挤成一行太憋，
              而首屏正文里本来就有两个差不多大的按钮。 */}
          <Link
            href={SIGN_IN_PATH}
            className={cn(
              buttonVariants({ variant: "default", tone: "primary" }),
              "hidden px-4 sm:inline-flex",
            )}
          >
            {t("Header.cta")}
          </Link>
          {links.length > 0 && (
            <MobileNav title={siteConfig.name} links={links} />
          )}
        </div>
      </div>
    </header>
  );
}
