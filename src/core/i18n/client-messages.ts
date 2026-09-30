import type { AbstractIntlMessages } from "next-intl";

/**
 * Message namespaces used by client components ("use client"). Only these are sent to the browser:
 * the other namespaces (Email, Landing, Blog, etc.) render on the server only and don't need to be
 * in the HTML or RSC payload. Add a namespace here when a new client component uses one;
 * client-messages.test.ts checks for omissions.
 */
export const clientNamespaces = [
  "Account",
  "Acquisition",
  "Admin",
  "ApiKeys",
  "Auth",
  "Billing",
  "Common",
  "Dashboard",
  "Error",
  "Example",
  "Header",
  "Invoices",
  "Locale",
  "LandingPreview",
  "Leads",
  "Onboarding",
  "Playground",
  "Referrals",
  "Status",
  "Theme",
  "Upload",
] as const;

/** Picks the client-side subset of the full messages, for NextIntlClientProvider. */
export function pickClientMessages(
  messages: AbstractIntlMessages,
): AbstractIntlMessages {
  return Object.fromEntries(
    clientNamespaces
      .filter((namespace) => namespace in messages)
      .map((namespace) => [namespace, messages[namespace]!]),
  );
}
