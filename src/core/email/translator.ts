import { createTranslator, hasLocale, type Messages } from "next-intl";

import { routing } from "@/core/i18n/routing";

/** Translation function for email templates, scoped to the `Email` namespace in messages. */
export function emailTranslator(locale: string, messages: Messages) {
  return createTranslator({ locale, messages, namespace: "Email" });
}

export type EmailT = ReturnType<typeof emailTranslator>;

/**
 * Loads messages for a locale. Locales that aren't enabled throw, so we never silently send an
 * email in the default locale.
 */
export async function loadMessages(locale: string): Promise<Messages> {
  if (!hasLocale(routing.locales, locale)) {
    throw new Error(
      `Unsupported email locale "${locale}", expected one of: ${routing.locales.join(", ")}`,
    );
  }
  return (await import(`../../../messages/${locale}.json`)).default;
}
