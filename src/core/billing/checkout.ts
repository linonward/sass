import { and, eq, gt, inArray, or } from "drizzle-orm";
import { hasLocale } from "next-intl";

import type { Database } from "@/core/db";
import {
  billingCustomers,
  checkoutSessions,
  orders,
  subscriptions,
  user as userTable,
} from "@/core/db/schema";
import { routing } from "@/core/i18n/routing";
import type {
  RateLimitIdentifiers,
  RateLimitResult,
} from "@/core/ratelimit/limiter";
import { localizedPath } from "@/core/seo/urls";

import { getPlan } from "./plans";
import type { PaymentProvider } from "./provider";

/** 结账成功后回到的页面（不含语言前缀）。页面按服务商附带的订单或订阅 ID 轮询状态。 */
export const CHECKOUT_SUCCESS_PATH = "/billing/success";
/** 用户放弃结账时回到的定价区块。Creem 没有取消地址参数，仅供其他服务商使用。 */
export const CHECKOUT_CANCEL_PATH = "/#pricing";

/** 模板里的占位产品 ID（site.config.ts），换成真实 ID 之前不允许结账。 */
const PLACEHOLDER_PRODUCT = /^prod_placeholder/;

/**
 * 结账会话的复用窗口。窗口内同一 (user, plan) 的重复请求拿到同一个 URL，不重复建单；
 * 超时后重新建（用户放弃结账过一阵子再回来，拿到的是新会话）。
 */
export const CHECKOUT_SESSION_TTL_MS = 30 * 60 * 1000;

export type BillingError =
  | "billing_not_configured"
  | "invalid_plan"
  | "free_plan"
  | "plan_not_configured"
  | "already_subscribed"
  | "already_purchased"
  | "no_customer"
  | "rate_limited";

export type BillingResult =
  | { ok: true; url: string }
  // rate_limited 带 retryAfter（秒），路由用它写 Retry-After 响应头。
  | { ok: false; error: BillingError; status: number; retryAfter?: number };

const fail = (
  error: BillingError,
  status: number,
  retryAfter?: number,
): BillingResult => ({
  ok: false,
  error,
  status,
  ...(retryAfter ? { retryAfter } : {}),
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
  ip,
  checkRateLimit,
  now = new Date(),
}: {
  db: Database;
  provider: PaymentProvider | null;
  user: { id: string; email: string };
  planId: unknown;
  locale: unknown;
  /** 站点根地址，例如 https://example.com。 */
  origin: string;
  ip?: string | null;
  checkRateLimit: (
    policy: string,
    identifiers: RateLimitIdentifiers,
  ) => Promise<RateLimitResult>;
  now?: Date;
}): Promise<BillingResult> {
  if (!provider) return fail("billing_not_configured", 503);

  const plan = typeof planId === "string" ? getPlan(planId) : undefined;
  if (!plan) return fail("invalid_plan", 400);
  if (plan.price === 0) return fail("free_plan", 400);
  // 有产品目录的服务商必须配好产品 ID；金额直接传的服务商（inlinePricing）不需要。
  if (
    !provider.inlinePricing &&
    (!plan.providerProductId ||
      PLACEHOLDER_PRODUCT.test(plan.providerProductId))
  ) {
    return fail("plan_not_configured", 503);
  }

  // 每次调用都会在服务商侧真实建单，先限流再往下走（放在参数校验之后：
  // 非法套餐不消耗额度，免得把同一用户的正常结账误伤掉）。
  const limit = await checkRateLimit("checkout", { userId: user.id, ip });
  if (!limit.ok) {
    return fail(
      "rate_limited",
      limit.reason === "limited" ? 429 : 503,
      limit.retryAfter,
    );
  }

  const lang =
    typeof locale === "string" && hasLocale(routing.locales, locale)
      ? locale
      : routing.defaultLocale;
  const successUrl = `${origin}${localizedPath(lang, CHECKOUT_SUCCESS_PATH)}`;
  const cancelUrl = `${origin}${localizedPath(lang, "/")}#pricing`;

  // 去重与互斥：先锁住这个用户的行（并发/双击在这里排队），再复查重和未过期的会话，
  // 都没有才向服务商建新单并记下。见 checkoutSessions 的注释（Creem 的 request_id 不是
  // 幂等键，实测同一 request_id 会返回两个会话）。
  // 取舍：provider 调用在事务里（持连接约 0.5 秒）—— 这是仓库里唯一一处「事务内外部
  // HTTP」，结账是低频操作，宁可贵一点也不要双扣款。
  return db.transaction(async (tx) => {
    await tx
      .select({ id: userTable.id })
      .from(userTable)
      .where(eq(userTable.id, user.id))
      .for("update");

    if (plan.type === "subscription") {
      const [existing] = await tx
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
      const [existing] = await tx
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

    // 有效期内复用同一个会话：重复请求（双开标签页、连点、重试）拿到的是同一个 URL，
    // 用户不可能在两个页面上重复付款。
    const [reusable] = await tx
      .select({ url: checkoutSessions.url })
      .from(checkoutSessions)
      .where(
        and(
          eq(checkoutSessions.userId, user.id),
          eq(checkoutSessions.planId, plan.id),
          gt(checkoutSessions.expiresAt, now),
        ),
      )
      .limit(1);
    if (reusable) return { ok: true, url: reusable.url };

    const checkout = await provider.createCheckout({
      userId: user.id,
      planId: plan.id,
      customerEmail: user.email,
      successUrl,
      cancelUrl,
    });
    await tx
      .insert(checkoutSessions)
      .values({
        userId: user.id,
        provider: provider.id,
        planId: plan.id,
        providerSessionId: checkout.checkoutId,
        url: checkout.url,
        expiresAt: new Date(now.getTime() + CHECKOUT_SESSION_TTL_MS),
      })
      .onConflictDoUpdate({
        target: [checkoutSessions.userId, checkoutSessions.planId],
        set: {
          provider: provider.id,
          providerSessionId: checkout.checkoutId,
          url: checkout.url,
          expiresAt: new Date(now.getTime() + CHECKOUT_SESSION_TTL_MS),
          updatedAt: new Date(),
        },
      });
    return { ok: true, url: checkout.url };
  });
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
