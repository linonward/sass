/**
 * No revenue section when there are no paid plans: on a free deployment those numbers are always
 * 0 / "—", so better to leave them out than take up space. /admin/metrics and /admin/acquisition
 * use the same check, so revenue visibility follows one rule on both admin pages (see the "Admin"
 * section of the README).
 *
 * Only `price` from `plans` is read: callers pass `siteConfig.billing` directly, and neither tests
 * nor future config shapes have to assemble a full plan object.
 */
export function revenueEnabled({
  plans,
}: {
  plans: readonly { price: number }[];
}): boolean {
  return plans.some((plan) => plan.price > 0);
}
