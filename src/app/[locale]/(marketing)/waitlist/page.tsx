import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { LeadCapture } from "@/core/acquisition/leads/capture";
import { buildMetadata } from "@/core/seo/metadata";
import siteConfig from "../../../../../site.config";
export async function generateMetadata({
  params,
}: PageProps<"/[locale]/waitlist">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Leads" });
  return buildMetadata({
    locale,
    path: "/waitlist",
    title: t("title"),
    description: t("description"),
  });
}
export default async function WaitlistPage({
  searchParams,
}: PageProps<"/[locale]/waitlist">) {
  if (process.env.ACQUISITION_LEADS !== "true") notFound();
  const query = await searchParams;
  const listId = query.list ?? siteConfig.acquisition.leads.lists[0]!.id;
  if (typeof listId !== "string") notFound();
  const t = await getTranslations("Leads");
  return (
    <div className="mx-auto max-w-xl px-4 py-14 sm:py-20">
      <h1 className="heading-display mb-8 text-3xl sm:text-4xl">
        {t("title")}
      </h1>
      <LeadCapture listId={listId} />
    </div>
  );
}
