import type { Messages } from "next-intl";

import { loadMessages } from "./translator";

/**
 * The plan's display name in the recipient's locale (Landing.pricing.plans.<id>.name in messages),
 * falling back to planId.
 */
export async function planDisplayName(
  locale: string,
  planId: string | null | undefined,
): Promise<string | undefined> {
  if (!planId) return undefined;
  const messages: Messages = await loadMessages(locale);
  const plans = messages.Landing.pricing.plans as Record<
    string,
    { name?: string } | undefined
  >;
  return plans[planId]?.name ?? planId;
}
