/** 金额以最小货币单位（分）传入，按收件人语言格式化，例如 1900 USD → "$19.00"。 */
export function formatMoney(
  locale: string,
  amount: number | undefined,
  currency: string | undefined,
): string | null {
  if (amount === undefined || !currency) return null;
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(
    amount / 100,
  );
}

/** ISO 时间按收件人语言格式化成日期（UTC），例如 "September 25, 2026"。 */
export function formatDate(locale: string, iso: string | undefined) {
  if (!iso) return null;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(iso));
}
