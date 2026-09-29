import type { useFormatter } from "next-intl";

/** 营销页上的标价：整数不带小数位（$99），有零头时保留两位（$9.50）。 */
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
