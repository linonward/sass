import type { SiteConfig } from "@/core/config/schema";

type Product = SiteConfig["downloads"]["products"][number];

/** 授权包含的更新截止时间：购买时间往后 updateMonths 个月（按日历月，月末对齐由 Date 处理）。 */
export function updatesUntil(purchasedAt: Date, updateMonths: number): Date {
  const until = new Date(purchasedAt);
  until.setUTCMonth(until.getUTCMonth() + updateMonths);
  return until;
}

/** 这个套餐买下来换哪个产品；不卖文件的套餐返回 undefined。 */
export function productForPlan(
  config: SiteConfig["downloads"],
  planId: string | undefined,
): Product | undefined {
  if (!config.enabled || !planId) return undefined;
  return config.products.find((p) => p.planId === planId);
}

/**
 * 某个授权能不能下某个版本：同一产品、没被收回、版本在更新期内发布。
 * 更新期过了之后，期内发布的版本照常能下 —— 买到的东西不会被收走。
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
