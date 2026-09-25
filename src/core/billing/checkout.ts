import { and, eq, gt, inArray, or } from "drizzle-orm";
import { hasLocale } from "next-intl";

import type { Database } from "@/core/db";
import { billingCustomers, orders, subscriptions } from "@/core/db/schema";
import { routing } from "@/core/i18n/routing";
import { localizedPath } from "@/core/seo/urls";

import { getPlan } from "./plans";
import type { PaymentProvider } from "./provider";

/** 结账成功后回到的页面（不含语言前缀）。页面按服务商附带的订单或订阅 ID 轮询状态。 */
export const CHECKOUT_SUCCESS_PATH = "/billing/success";
/** 用户放弃结账时回到的定价区块。Creem 没有取消地址参数，仅供其他服务商使用。 */
export const CHECKOUT_CANCEL_PATH = "/#pricing";

/** 模板里的占位产品 ID（site.config.ts），换成真实 ID 之前不允许结账。 */
const PLACEHOLDER_PRODUCT = /^prod_placeholder/;

export type BillingError =
  | "billing_not_configured"
  | "invalid_plan"
  | "free_plan"
  | "plan_not_configured"
  | "already_subscribed"
  | "already_purchased"
  | "no_customer";

export type BillingResult =
  | { ok: true; url: string }
  | { ok: false; error: BillingError; status: number };

const fail = (error: BillingError, status: number): BillingResult => ({
  ok: false,
  error,
  status,
});

/**
 * 为已登录用户创建结账会话。
 * - 只允许配置了真实产品 ID 的付费套餐。
 * - 已有仍在计费的订阅时拒绝（409），升级、换套餐请走客户门户；一次性套餐买过就不能再买。
 * - 成功页带上用户当前的语言前缀。
 */
export async function startCheckout({
  db,
  provider,
  user,
  planId,
  locale,
  origin,
  now = new Date(),
}: {
  db: Database;
  provider: PaymentProvider | null;
  user: { id: string; email: string };
  planId: unknown;
  locale: unknown;
  /** 站点根地址，例如 https://sass.linonward.com。 */
  origin: string;
  now?: Date;
}): Promise<BillingResult> {
  if (!provider) return fail("billing_not_configured", 503);

  const plan = typeof planId === "string" ? getPlan(planId) : undefined;
  if (!plan) return fail("invalid_plan", 400);
  if (plan.price === 0) return fail("free_plan", 400);
  if (
    !plan.providerProductId ||
    PLACEHOLDER_PRODUCT.test(plan.providerProductId)
  ) {
    return fail("plan_not_configured", 503);
  }

  if (plan.type === "subscription") {
    const [existing] = await db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.userId, user.id),
          or(
            inArray(subscriptions.status, ["active", "past_due"]),
            // 已取消续费但还没到期的，也算仍在使用。
            and(
              eq(subscriptions.status, "canceled"),
              gt(subscriptions.currentPeriodEnd, now),
            ),
          ),
        ),
      )
      .limit(1);
    if (existing) return fail("already_subscribed", 409);
  } else {
    const [existing] = await db
      .select({ id: orders.id })
      .from(orders)
      .where(
        and(
          eq(orders.userId, user.id),
          eq(orders.planId, plan.id),
          eq(orders.status, "paid"),
        ),
      )
      .limit(1);
    if (existing) return fail("already_purchased", 409);
  }

  const lang =
    typeof locale === "string" && hasLocale(routing.locales, locale)
      ? locale
      : routing.defaultLocale;
  const checkout = await provider.createCheckout({
    userId: user.id,
    planId: plan.id,
    customerEmail: user.email,
    successUrl: `${origin}${localizedPath(lang, CHECKOUT_SUCCESS_PATH)}`,
    cancelUrl: `${origin}${localizedPath(lang, "/")}#pricing`,
  });
  return { ok: true, url: checkout.url };
}

/** 客户门户地址。用户还没有在该服务商下付过款（没有客户记录）时返回 no_customer。 */
export async function openPortal({
  db,
  provider,
  userId,
}: {
  db: Database;
  provider: PaymentProvider | null;
  userId: string;
}): Promise<BillingResult> {
  if (!provider) return fail("billing_not_configured", 503);
  const [customer] = await db
    .select({ id: billingCustomers.providerCustomerId })
    .from(billingCustomers)
    .where(
      and(
        eq(billingCustomers.userId, userId),
        eq(billingCustomers.provider, provider.id),
      ),
    );
  if (!customer) return fail("no_customer", 404);
  return { ok: true, url: await provider.getPortalUrl(customer.id) };
}

/**
 * 回跳地址用的站点根地址。生产环境固定用配置的域名，不信任请求头里的 Host；
 * 本地和预览用请求自身的地址（每个预览部署的域名都不同）。
 */
export function billingOrigin(
  request: Request,
  runtimeEnv: Record<string, string | undefined>,
  domain: string,
) {
  if (runtimeEnv.VERCEL_ENV === "production") return `https://${domain}`;
  return new URL(request.url).origin;
}
