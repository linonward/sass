/**
 * Formats an amount given in the smallest currency unit (cents) for the recipient's locale, e.g.
 * 1900 USD → "$19.00".
 */
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

/**
 * Formats an ISO timestamp as a date (UTC) in the recipient's locale, e.g. "September 25, 2026".
 */
export function formatDate(locale: string, iso: string | undefined) {
  if (!iso) return null;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(iso));
}
