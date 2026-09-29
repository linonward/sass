"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";

import { getAdminSession } from "@/core/admin/session";
import { getDb } from "@/core/db";
import {
  statusEventStatuses,
  type StatusEventStatus,
} from "@/core/db/schema/status";
import { sendEmail } from "@/core/email";
import { siteLink } from "@/core/email/links";
import { routing } from "@/core/i18n/routing";
import { runAfterResponse } from "@/core/lib/after-response";
import { logger } from "@/core/observability/logger";
import { checkRateLimit, getClientIp } from "@/core/ratelimit";

import siteConfig from "../../../site.config";
import { statusPageEnabled } from "./index";
import { notifySubscribers } from "./notify";
import { createIncident, resolveIncident, updateIncident } from "./store";
import { prepareSubscription, subscriberEmail } from "./subscribers";

/**
 * Max length of an incident message. The status page is meant to be taken in at a glance; long
 * write-ups belong on the blog.
 */
const MAX_MESSAGE = 500;

export type StatusErrorCode =
  | "forbidden"
  | "unknownComponent"
  | "invalidStatus"
  | "messageRequired"
  | "notFound"
  | "generic";

export type StatusActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; error: StatusErrorCode };

// Server Actions can be called directly without going through the page, so every action re-checks
// that the caller is an admin.
const forbidden: StatusActionState = { status: "error", error: "forbidden" };

/**
 * The component must be a key registered in `site.config.ts`; values sent by the client are never
 * trusted.
 */
function parseComponent(value: FormDataEntryValue | null): string | null {
  const component = String(value ?? "");
  return component in siteConfig.statusPage.components ? component : null;
}

function parseStatus(
  value: FormDataEntryValue | null,
): StatusEventStatus | null {
  const status = String(value ?? "");
  return (statusEventStatuses as readonly string[]).includes(status)
    ? (status as StatusEventStatus)
    : null;
}

function parseMessage(value: FormDataEntryValue | null): string | null {
  const message = String(value ?? "")
    .trim()
    .slice(0, MAX_MESSAGE);
  return message.length > 0 ? message : null;
}

/**
 * Notifies subscribers. Runs inside `runAfterResponse`: sending mail is a side effect of this
 * action, so the admin shouldn't wait for an SMTP round trip, and failures are only logged (the
 * incident is already in the database).
 */
async function announce(event: Parameters<typeof notifySubscribers>[1]) {
  await runAfterResponse(async () => {
    try {
      await notifySubscribers(getDb(), event);
    } catch (error) {
      logger.error("status.notify_failed", { error, incidentId: event.id });
    }
  });
}

/** Opens an incident (`operational` is for announcements with no impact). */
export async function createIncidentAction(
  _prev: StatusActionState,
  form: FormData,
): Promise<StatusActionState> {
  const session = await getAdminSession();
  if (!session || !statusPageEnabled) return forbidden;

  const component = parseComponent(form.get("component"));
  if (!component) return { status: "error", error: "unknownComponent" };
  const status = parseStatus(form.get("status"));
  if (!status) return { status: "error", error: "invalidStatus" };
  const message = parseMessage(form.get("message"));
  if (!message) return { status: "error", error: "messageRequired" };

  const event = await createIncident(getDb(), { component, status, message });
  await announce(event);
  refresh();
  return { status: "success" };
}

/**
 * Updates an ongoing incident: changes the impact level or the message (creation and resolution
 * of the same row still form one timeline).
 */
export async function updateIncidentAction(
  _prev: StatusActionState,
  form: FormData,
): Promise<StatusActionState> {
  const session = await getAdminSession();
  if (!session || !statusPageEnabled) return forbidden;

  const id = String(form.get("id") ?? "");
  const status = parseStatus(form.get("status"));
  if (!status) return { status: "error", error: "invalidStatus" };
  const message = parseMessage(form.get("message"));
  if (!message) return { status: "error", error: "messageRequired" };

  const event = await updateIncident(getDb(), id, { status, message });
  if (!event) return { status: "error", error: "notFound" };

  await announce(event);
  refresh();
  return { status: "success" };
}

/**
 * Resolves an incident: `status` keeps the impact level it had, so the timeline still shows "this
 * was an outage".
 */
export async function resolveIncidentAction(
  _prev: StatusActionState,
  form: FormData,
): Promise<StatusActionState> {
  const session = await getAdminSession();
  if (!session || !statusPageEnabled) return forbidden;

  const event = await resolveIncident(getDb(), String(form.get("id") ?? ""));
  if (!event) return { status: "error", error: "notFound" };

  await announce(event);
  refresh();
  return { status: "success" };
}

export type SubscribeErrorCode =
  "invalidEmail" | "rateLimited" | "unavailable" | "generic";

export type SubscribeState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; error: SubscribeErrorCode };

/**
 * Subscribes to status notifications: stores the address as pending and sends a confirmation
 * email.
 *
 * Already-confirmed addresses and repeat submissions within 60 seconds get no email, but the
 * success message returned is identical — the form must not become a probe for "is this address
 * already subscribed".
 */
export async function subscribeAction(
  _prev: SubscribeState,
  form: FormData,
): Promise<SubscribeState> {
  if (!statusPageEnabled) return { status: "error", error: "unavailable" };
  const parsed = subscriberEmail.safeParse(String(form.get("email") ?? ""));
  if (!parsed.success) return { status: "error", error: "invalidEmail" };

  // Honeypot: humans can't see this field, so anything that fills it in is a script. Still report
  // success.
  if (String(form.get("website") ?? "")) return { status: "success" };

  const requestHeaders = await headers();
  const limit = await checkRateLimit("statusSubscribe", {
    ip: getClientIp(requestHeaders),
  });
  if (!limit.ok) return { status: "error", error: "rateLimited" };

  const requested = String(form.get("locale") ?? "");
  const locale = (routing.locales as readonly string[]).includes(requested)
    ? requested
    : routing.defaultLocale;

  try {
    const pending = await prepareSubscription(getDb(), {
      email: parsed.data,
      locale,
    });
    if (pending) {
      await sendEmail({
        to: pending.email,
        template: "status-subscription",
        props: {
          confirmUrl: siteLink(
            locale,
            `/status/confirm?token=${pending.confirmToken}`,
          ),
        },
        locale,
      });
    }
  } catch (error) {
    logger.error("status.subscribe_failed", { error });
    return { status: "error", error: "generic" };
  }
  return { status: "success" };
}
