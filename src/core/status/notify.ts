import type { Database } from "@/core/db/client";
import { sendEmail } from "@/core/email";
import { siteLink } from "@/core/email/links";
import { routing } from "@/core/i18n/routing";
import { logger } from "@/core/observability/logger";

import siteConfig from "../../../site.config";
import { componentLabel, shouldNotify, type StatusEvent } from "./status";
import { markNotified } from "./store";
import { listConfirmedSubscribers, withdrawSignature } from "./subscribers";

/**
 * Props for the notification email: the status page URL, and the component's display name from
 * config (falling back to the key if the component has been removed).
 */
function incidentProps(event: StatusEvent, locale: string, email: string) {
  return {
    component: componentLabel(
      siteConfig.statusPage.components,
      event.component,
    ),
    status: event.status,
    message: event.message,
    resolvedAt: event.resolvedAt?.toISOString() ?? null,
    url: siteLink(locale, "/status"),
    withdrawUrl: siteLink(
      locale,
      `/status/unsubscribe?email=${encodeURIComponent(email)}&signature=${withdrawSignature(email)}`,
    ),
  };
}

/**
 * Broadcasts an incident change to confirmed subscribers and returns how many emails were actually
 * sent.
 *
 * The merge window lives in the incident row's `notifiedAt` (see `shouldNotify` in `status.ts`):
 * creates / updates / resolutions within 5 minutes send only one email; otherwise subscribers
 * would be chased by a dozen emails during a single outage.
 *
 * v1 sends one email at a time and doesn't use Resend audiences / broadcasts — subscriber counts
 * are "however many there are", and switching to broadcasts would first require syncing addresses
 * to Resend, which is another module's job. Send failures are only logged: one undeliverable
 * address must not hold up the rest, and the admin's action has already succeeded.
 */
export async function notifySubscribers(
  db: Database,
  event: StatusEvent,
  now: Date = new Date(),
): Promise<number> {
  if (!shouldNotify(event, now)) return 0;

  const subscribers = await listConfirmedSubscribers(db);
  // Record it even with no subscribers: the window means "this incident was broadcast at this
  // moment".
  await markNotified(db, event.id, now);

  let sent = 0;
  for (const subscriber of subscribers) {
    const locale = subscriber.locale ?? routing.defaultLocale;
    try {
      await sendEmail({
        to: subscriber.email,
        template: "status-incident",
        props: incidentProps(event, locale, subscriber.email),
        locale,
      });
      sent += 1;
    } catch (error) {
      logger.error("status.notify_failed", {
        error,
        template: "status-incident",
      });
    }
  }
  return sent;
}
