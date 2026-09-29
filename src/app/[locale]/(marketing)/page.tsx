import { getTranslations } from "next-intl/server";

import { Landing } from "@/core/marketing/landing";
import { buildMetadata } from "@/core/seo/metadata";

import siteConfig from "../../../../site.config";

// The home page can't use the bare site name as its title: search results would show just "Acme"
// with no hint of what the page is about.
export async function generateMetadata({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return buildMetadata({
    locale,
    path: "/",
    title: t("homeTitle"),
    description: t("description"),
  });
}

export default function Home() {
  return <Landing config={siteConfig} />;
}
