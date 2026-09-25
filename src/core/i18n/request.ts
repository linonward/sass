import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { notFound } from "next/navigation";
import * as rootParams from "next/root-params";

import { routing } from "./routing";

export default getRequestConfig(async ({ locale: requested }) => {
  // 显式传入的语言（如 generateMetadata 里的 params.locale）同样要校验，
  // 否则 /missing.png 这类路径会去加载不存在的 messages 文件。
  const locale = requested ?? (await rootParams.locale());
  if (!hasLocale(routing.locales, locale)) notFound();

  return {
    locale,
    messages: (await import(`../../../messages/${locale}.json`)).default,
  };
});
