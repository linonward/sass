import { SiteLogo } from "@/core/layout/site-logo";
import { ThemeToggle } from "@/core/theme/theme-toggle";

export default function AuthLayout({ children }: LayoutProps<"/[locale]">) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4">
        <SiteLogo />
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-10 pb-16 sm:items-center sm:pt-0">
        {children}
      </main>
    </div>
  );
}
