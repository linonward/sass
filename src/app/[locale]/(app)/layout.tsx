import { SIGN_IN_PATH } from "@/core/auth/routes";
import { getSession } from "@/core/auth/session";
import { redirect } from "@/core/i18n/navigation";
import { SiteLogo } from "@/core/layout/site-logo";
import { ThemeToggle } from "@/core/theme/theme-toggle";

// 登录后的页面。proxy 只看 cookie 是否存在，这里再校验 session 是否有效。
export default async function AppLayout({
  children,
  params,
}: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!(await getSession())) redirect({ href: SIGN_IN_PATH, locale });

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <SiteLogo />
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
        {children}
      </main>
    </div>
  );
}
