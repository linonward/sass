import { redirect } from "next/navigation";

import { getDb } from "@/core/db";
import { localizedPath } from "@/core/seo/urls";
import { statusPageEnabled } from "@/core/status";
import {
  confirmSubscription,
  subscriberToken,
} from "@/core/status/subscribers";

// Confirming writes to the database, so this can't be prerendered.
export const dynamic = "force-dynamic";

/**
 * Confirm a subscription: the link in the email lands here, and success or failure both redirect
 * back to the status page with a one-time notice. Invalid or expired tokens count as failure — an
 * already-used token returns true from confirmSubscription.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/[locale]/status/confirm">,
) {
  const { locale } = await params;
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const confirmed =
    statusPageEnabled && subscriberToken.safeParse(token).success
      ? await confirmSubscription(getDb(), token)
      : false;

  redirect(
    `${localizedPath(locale, "/status")}?subscribed=${confirmed ? "1" : "0"}`,
  );
}
