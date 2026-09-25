import { hasLocale } from "next-intl";

import { routing } from "@/core/i18n/routing";

/**
 * 给这个用户发事务邮件时使用的语言：优先用偏好语言，未设置或已停用时用站点默认语言。
 */
export function preferredLocale(user: { locale?: string | null }): string {
  return user.locale && hasLocale(routing.locales, user.locale)
    ? user.locale
    : routing.defaultLocale;
}
