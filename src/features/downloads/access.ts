import type { SiteConfig } from "@/core/config/schema";

type Product = SiteConfig["downloads"]["products"][number];

/**
 * When a grant's included updates end: updateMonths after the purchase time (calendar months; Date
 * handles month-end alignment).
 */
export function updatesUntil(purchasedAt: Date, updateMonths: number): Date {
  const until = new Date(purchasedAt);
  until.setUTCMonth(until.getUTCMonth() + updateMonths);
  return until;
}

/** Which product buying this plan gets you; undefined for plans that don't sell files. */
export function productForPlan(
  config: SiteConfig["downloads"],
  planId: string | undefined,
): Product | undefined {
  if (!config.enabled || !planId) return undefined;
  return config.products.find((p) => p.planId === planId);
}

/**
 * Whether a grant can download a version: same product, not revoked, and the version was released
 * within the updates period. Once the period is over, versions released during it stay
 * downloadable — what you bought isn't taken away.
 */
export function canDownload(
  entitlement: {
    productId: string;
    updatesUntil: Date;
    revokedAt: Date | null;
  },
  release: { productId: string; publishedAt: Date },
): boolean {
  return (
    entitlement.revokedAt === null &&
    entitlement.productId === release.productId &&
    release.publishedAt.getTime() <= entitlement.updatesUntil.getTime()
  );
}
