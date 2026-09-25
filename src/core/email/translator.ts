import { createTranslator, hasLocale, type Messages } from "next-intl";

import { routing } from "@/core/i18n/routing";

/** 邮件模板使用的翻译函数，限定在 messages 的 `Email` 命名空间。 */
export function emailTranslator(locale: string, messages: Messages) {
  return createTranslator({ locale, messages, namespace: "Email" });
}

export type EmailT = ReturnType<typeof emailTranslator>;

/** 按语言加载 messages；未启用的语言会报错，避免静默发出默认语言的邮件。 */
export async function loadMessages(locale: string): Promise<Messages> {
  if (!hasLocale(routing.locales, locale)) {
    throw new Error(
      `Unsupported email locale "${locale}", expected one of: ${routing.locales.join(", ")}`,
    );
  }
  return (await import(`../../../messages/${locale}.json`)).default;
}
