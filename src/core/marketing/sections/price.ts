import type { useFormatter } from "next-intl";

/** Price shown on marketing pages: whole amounts have no decimals ($99); fractional amounts keep two ($9.50). */
export function formatPrice(
  format: ReturnType<typeof useFormatter>,
  price: number,
  currency: string,
) {
  return format.number(price, {
    style: "currency",
    currency,
    maximumFractionDigits: Number.isInteger(price) ? 0 : 2,
  });
}
