import { createHmac, timingSafeEqual } from "node:crypto";

import type { Plan } from "@/core/config/schema";
import { logger } from "@/core/observability/logger";

import type { BillingEvent } from "../events";
import { getPlan } from "../plans";
import type { Checkout, CreateCheckoutInput } from "../provider";
import { FakeProvider } from "../testing/fake-provider";

/**
 * e2e 用的站内支付服务商（BILLING_PROVIDER=fake，只在本地和 CI 可用，见 fakeBillingAllowed）。
 * - 结账地址指向站内的模拟付款页 /api/billing/fake/checkout，页面上可以设置 webhook 延迟或不发送。
 * - "付款"后回跳成功页，并按延迟把签名过的事件 POST 到 /api/webhooks/fake，走和 Creem 相同的处理链路。
 * 签名密钥是公开的常量：fake 模式本身就不允许出现在任何部署环境里。
 */
export const FAKE_PROVIDER_ID = "fake";
const FAKE_SECRET = "fake-billing-secret-for-local-and-ci-only";

export const FAKE_CHECKOUT_PATH = "/api/billing/fake/checkout";
export const FAKE_PORTAL_PATH = "/api/billing/fake/portal";
export const FAKE_WEBHOOK_PATH = "/api/webhooks/fake";

/** 模拟结账会话，编码在结账地址的 token 里，所以不依赖进程内存。 */
export type FakeCheckoutSession = {
  checkoutId: string;
  userId: string;
  planId: string;
  successUrl: string;
};

function hmac(value: string) {
  return createHmac("sha256", FAKE_SECRET).update(value).digest("base64url");
}

export function signFakeSession(session: FakeCheckoutSession) {
  const body = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${body}.${hmac(body)}`;
}

/** 校验 token 并取出会话；签名不对或结构不对时返回 null。 */
export function verifyFakeSession(
  token: string | null,
): FakeCheckoutSession | null {
  const [body, signature] = token?.split(".") ?? [];
  if (!body || !signature) return null;
  const expected = Buffer.from(hmac(body));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return null;
  }
  try {
    const session = JSON.parse(Buffer.from(body, "base64url").toString());
    return typeof session?.checkoutId === "string" &&
      typeof session?.userId === "string" &&
      typeof session?.planId === "string" &&
      typeof session?.successUrl === "string"
      ? session
      : null;
  } catch {
    return null;
  }
}

class AppFakeProvider extends FakeProvider {
  constructor() {
    super(FAKE_SECRET, FAKE_PROVIDER_ID);
  }

  // 返回站内相对地址：前端直接跳转，客户门户路由会补全成绝对地址。
  override async createCheckout(input: CreateCheckoutInput): Promise<Checkout> {
    const checkoutId = `chk_fake_${crypto.randomUUID()}`;
    const token = signFakeSession({
      checkoutId,
      userId: input.userId,
      planId: input.planId,
      successUrl: input.successUrl,
    });
    return {
      checkoutId,
      url: `${FAKE_CHECKOUT_PATH}?token=${encodeURIComponent(token)}`,
    };
  }

  override async getPortalUrl(customerId: string): Promise<string> {
    return `${FAKE_PORTAL_PATH}?customer=${encodeURIComponent(customerId)}`;
  }
}

export function createFakeBillingProvider() {
  return new AppFakeProvider();
}

function addInterval(start: Date, plan: Plan) {
  const end = new Date(start);
  if (plan.interval === "year") end.setUTCFullYear(end.getUTCFullYear() + 1);
  else end.setUTCMonth(end.getUTCMonth() + 1);
  return end;
}

/**
 * 一次模拟付款产生的事件和回跳参数，顺序和 Creem 一致：
 * 订阅是 subscription.active → subscription.renewed（首期扣款，发积分）→ checkout.completed；
 * 一次性购买只有带订单的 checkout.completed。回跳参数的名字也和 Creem 相同。
 */
export function fakePayment(
  provider: FakeProvider,
  session: FakeCheckoutSession,
  now = new Date(),
): { events: BillingEvent[]; returnParams: Record<string, string> } | null {
  const plan = getPlan(session.planId);
  if (!plan || plan.price === 0) return null;

  const suffix = session.checkoutId.replace(/^chk_fake_/, "");
  const customerId = `cust_fake_${session.userId}`;
  const base = { userId: session.userId, customerId, planId: plan.id };
  const money = {
    amount: Math.round(plan.price * 100),
    currency: "USD",
  };

  if (plan.type === "subscription") {
    const subscriptionId = `sub_fake_${suffix}`;
    const period = {
      currentPeriodStart: now,
      currentPeriodEnd: addInterval(now, plan),
    };
    const at = (offset: number) => new Date(now.getTime() + offset);
    return {
      events: [
        provider.event("subscription.active", {
          ...base,
          ...period,
          subscriptionId,
          occurredAt: at(0),
        }),
        provider.event("subscription.renewed", {
          ...base,
          ...period,
          ...money,
          subscriptionId,
          orderId: `tran_fake_${suffix}`,
          occurredAt: at(1),
        }),
        provider.event("checkout.completed", {
          ...base,
          checkoutId: session.checkoutId,
          subscriptionId,
          occurredAt: at(2),
        }),
      ],
      returnParams: {
        checkout_id: session.checkoutId,
        subscription_id: subscriptionId,
        customer_id: customerId,
      },
    };
  }

  const orderId = `ord_fake_${suffix}`;
  return {
    events: [
      provider.event("checkout.completed", {
        ...base,
        ...money,
        checkoutId: session.checkoutId,
        orderId,
        occurredAt: now,
      }),
    ],
    returnParams: {
      checkout_id: session.checkoutId,
      order_id: orderId,
      customer_id: customerId,
    },
  };
}

/** 按顺序把事件签名后 POST 给站内 webhook。 */
export async function deliverFakeWebhooks(
  provider: FakeProvider,
  origin: string,
  events: BillingEvent[],
) {
  for (const event of events) {
    const request = provider.request(event);
    const response = await fetch(new URL(FAKE_WEBHOOK_PATH, origin), {
      method: "POST",
      headers: request.headers,
      body: await request.text(),
    });
    if (!response.ok) {
      logger.error("billing.fake_webhook_failed", {
        eventType: event.type,
        status: response.status,
      });
    }
  }
}
