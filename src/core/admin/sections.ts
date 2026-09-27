/**
 * 没有付费套餐时不出收入区块：免费部署上那些数字永远是 0 /「—」，
 * 占位置不如省掉。/admin/metrics 和 /admin/acquisition 用同一个判定，
 * 两个后台页的收入显隐才是同一条规则（见 README 的「后台」一节）。
 *
 * 只取 `plans` 里的 `price`：调用方直接传 `siteConfig.billing`，测试和
 * 未来的配置形状都不必凑出完整的套餐对象。
 */
export function revenueEnabled({
  plans,
}: {
  plans: readonly { price: number }[];
}): boolean {
  return plans.some((plan) => plan.price > 0);
}
