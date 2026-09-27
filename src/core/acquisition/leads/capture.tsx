import { leadListCopy } from "./copy";
import { getMessages } from "next-intl/server";
import { notFound } from "next/navigation";
import siteConfig from "../../../../site.config";

/** Embed in any marketing page; copy lives under Leads.lists.<id>. */
export async function LeadCapture({ listId }: { listId: string }) {
  if (
    process.env.ACQUISITION_LEADS !== "true" ||
    !siteConfig.acquisition.leads.lists.some((list) => list.id === listId)
  )
    notFound();
  const messages = await getMessages();
  const copy = leadListCopy(messages, listId);
  const { LeadForm } = await import("./form");
  return (
    <section
      aria-label={copy.title}
      className="sticker bg-card rounded-xl p-6 sm:p-8"
    >
      <h2 className="heading-display text-2xl">{copy.title}</h2>
      <p className="text-muted-foreground mt-3 mb-6">{copy.description}</p>
      <LeadForm listId={listId} consentText={copy.consent} />
    </section>
  );
}
