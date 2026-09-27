import { leadListCopy } from "@/core/acquisition/leads/copy";
import { getMessages } from "next-intl/server";
import { createLeadHandler } from "@/core/acquisition/leads/http";
import {
  checkLeadLimit,
  checkLeadActionLimit,
} from "@/core/acquisition/leads/rate-limit";
import { createLeadService } from "@/core/acquisition/leads/service";
import { sourceFromHeaders } from "@/core/acquisition/tokens";
import { db } from "@/core/db";
import { sendEmail } from "@/core/email";
import { env } from "@/core/env";
import { logger } from "@/core/observability/logger";
import { localizedPath } from "@/core/seo/urls";
import siteConfig from "../../../../../site.config";

// Link origin comes from configuration, never from an untrusted request Host.
export const POST = createLeadHandler({
  enabled: siteConfig.acquisition.leads.enabled,
  lists: siteConfig.acquisition.leads.lists,
  locales: siteConfig.locales,
  service: createLeadService(db),
  limit: checkLeadLimit,
  actionLimit: checkLeadActionLimit,
  source: (headers) =>
    siteConfig.acquisition.attribution.enabled
      ? sourceFromHeaders(headers, env.BETTER_AUTH_SECRET)
      : null,
  consentText: async (listId, locale) => {
    const messages = await getMessages({ locale });
    return leadListCopy(messages, listId).consent;
  },
  send: async ({ email, listId, locale, confirmToken, withdrawToken }) => {
    const messages = await getMessages({ locale });
    const origin = `https://${siteConfig.domain}`;
    return sendEmail({
      to: email,
      template: "lead-confirmation",
      locale,
      props: {
        listTitle: leadListCopy(messages, listId).title,
        confirmUrl: `${origin}${localizedPath(locale, "/waitlist/confirm")}#token=${confirmToken}`,
        withdrawUrl: `${origin}${localizedPath(locale, "/waitlist/withdraw")}#token=${withdrawToken}`,
      },
    });
  },
  warn: (event) => logger.warn(event),
});

export function GET() {
  return Response.json(
    {
      error: siteConfig.acquisition.leads.enabled
        ? "method_not_allowed"
        : "not_found",
    },
    {
      status: siteConfig.acquisition.leads.enabled ? 405 : 404,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
