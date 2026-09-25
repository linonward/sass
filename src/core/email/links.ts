import { routing } from "@/core/i18n/routing";

import { emailBrand } from "./brand";

/** 邮件里指向站内页面的绝对地址，带收件人语言的前缀（默认语言不带）。 */
export function siteLink(locale: string, path: string) {
  const prefix = locale === routing.defaultLocale ? "" : `/${locale}`;
  return `${emailBrand.siteUrl}${prefix}${path}`;
}
