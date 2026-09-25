import type { Messages } from "next-intl";

import { loadMessages } from "./translator";

/** 套餐在收件人语言里的显示名称（messages 的 Landing.pricing.plans.<id>.name），缺失时用 planId。 */
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
