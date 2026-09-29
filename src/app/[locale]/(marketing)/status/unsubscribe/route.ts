import { redirect } from "next/navigation";

import { getDb } from "@/core/db";
import { localizedPath } from "@/core/seo/urls";
import { statusPageEnabled } from "@/core/status";
import { withdrawSubscription } from "@/core/status/subscribers";

// Unsubscribing writes to the database, so this can't be prerendered.
export const dynamic = "force-dynamic";

/**
 * Unsubscribe: the permanent link at the bottom of notification emails lands here. With a bad
 * signature nothing is deleted, but the response still says "unsubscribed" — all this person wants
 * is to stop getting emails.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/[locale]/status/unsubscribe">,
) {
  const { locale } = await params;
  const query = new URL(request.url).searchParams;
  if (statusPageEnabled) {
    await withdrawSubscription(getDb(), {
      email: query.get("email") ?? "",
      signature: query.get("signature") ?? "",
    });
  }

  redirect(`${localizedPath(locale, "/status")}?unsubscribed=1`);
}
