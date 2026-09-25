import { SiteFooter } from "@/core/layout/site-footer";
import { SiteHeader } from "@/core/layout/site-header";

export default function MarketingLayout({
  children,
}: LayoutProps<"/[locale]">) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
