import { StatusPage, statusPageMetadata } from "@/core/status/status-page";

// The status page reads the database on every render (and reruns probes in auto mode), so it can't
// be prerendered at build time: `next build` doesn't connect to the database (see the notes in
// src/core/db/index.ts).
export const dynamic = "force-dynamic";

type Props = PageProps<"/[locale]/status">;

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  return statusPageMetadata(locale);
}

/**
 * One-time notice after being redirected back from confirm / unsubscribe. An unsubscribe link shows
 * success even with a bad signature: that person shouldn't get more emails either way.
 */
function parseNotice(query: Record<string, string | string[] | undefined>) {
  if (query.subscribed === "1") return "subscribed" as const;
  if (query.subscribed === "0") return "expired" as const;
  if (typeof query.unsubscribed === "string") return "unsubscribed" as const;
  return undefined;
}

export default async function Page({ params, searchParams }: Props) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  return <StatusPage locale={locale} notice={parseNotice(query)} />;
}
