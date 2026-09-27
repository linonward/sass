import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { buildMetadata } from "@/core/seo/metadata";
export async function generateMetadata({
  params,
}: PageProps<"/[locale]/waitlist/withdraw">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Leads" });
  return {
    ...buildMetadata({
      locale,
      path: "/waitlist/withdraw",
      title: t("withdraw.title"),
      noIndex: true,
    }),
    referrer: "no-referrer" as const,
  };
}
export default async function Page() {
  if (process.env.ACQUISITION_LEADS !== "true") notFound();
  const t = await getTranslations("Leads");
  const { LeadActionForm } =
    await import("@/core/acquisition/leads/action-form");
  return (
    <div className="mx-auto max-w-xl px-4 py-14 sm:py-20">
      <h1 className="heading-display mb-6 text-3xl sm:text-4xl">
        {t("withdraw.title")}
      </h1>
      <LeadActionForm mode="withdraw" />
    </div>
  );
}
