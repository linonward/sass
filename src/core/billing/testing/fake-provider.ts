import { createHmac, timingSafeEqual } from "node:crypto";

import type { BillingEvent, BillingEventType } from "../events";
import {
  WebhookVerificationError,
  type Checkout,
  type CreateCheckoutInput,
  type PaymentProvider,
} from "../provider";

const SIGNATURE_HEADER = "x-fake-signature";

/** FakeProvider 的 webhook 请求体：一个 BillingEvent，时间以 ISO 字符串传输。 */
type FakePayload = Omit<BillingEvent, "provider" | "raw" | "occurredAt"> & {
  occurredAt: string;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
};

let sequence = 0;

/**
 * 测试用的支付服务商：签名是请求体的 HMAC-SHA256，事件结构和 BillingEvent 一一对应。
 * 用 `event()` 构造事件，`request()` 生成带签名的 webhook 请求，也记录下游调用供断言。
 */
export class FakeProvider implements PaymentProvider {
  readonly id: string;
  readonly checkouts: CreateCheckoutInput[] = [];
  readonly canceled: string[] = [];

  constructor(
    private readonly secret = "fake-webhook-secret",
    id = "fake",
  ) {
    this.id = id;
  }

  async createCheckout(input: CreateCheckoutInput): Promise<Checkout> {
    this.checkouts.push(input);
    const checkoutId = `chk_${++sequence}`;
    return { checkoutId, url: `https://fake.test/checkout/${checkoutId}` };
  }

  async getPortalUrl(customerId: string): Promise<string> {
    return `https://fake.test/portal/${customerId}`;
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    this.canceled.push(subscriptionId);
  }

  sign(body: string): string {
    return createHmac("sha256", this.secret).update(body).digest("hex");
  }

  async verifyWebhook(request: Request): Promise<unknown> {
    const body = await request.text();
    const signature = request.headers.get(SIGNATURE_HEADER) ?? "";
    const expected = Buffer.from(this.sign(body));
    const actual = Buffer.from(signature);
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      throw new WebhookVerificationError();
    }
    return JSON.parse(body);
  }

  parseEvent(payload: unknown): BillingEvent | null {
    const data = payload as FakePayload;
    if (!data || typeof data !== "object" || !("type" in data)) return null;
    const toDate = (value?: string) => (value ? new Date(value) : undefined);
    return {
      ...data,
      provider: this.id,
      occurredAt: new Date(data.occurredAt),
      ...("currentPeriodStart" in data && {
        currentPeriodStart: toDate(data.currentPeriodStart),
      }),
      ...("currentPeriodEnd" in data && {
        currentPeriodEnd: toDate(data.currentPeriodEnd),
      }),
      raw: payload,
    } as BillingEvent;
  }

  /** 构造一个事件（provider 固定为本实例，eventId 默认唯一，occurredAt 默认现在）。 */
  event<T extends BillingEventType>(
    type: T,
    fields: Omit<
      Extract<BillingEvent, { type: T }>,
      "type" | "provider" | "raw" | "eventId" | "occurredAt"
    > & { eventId?: string; occurredAt?: Date },
  ): Extract<BillingEvent, { type: T }> {
    const { eventId, occurredAt, ...rest } = fields;
    return {
      ...rest,
      type,
      provider: this.id,
      eventId: eventId ?? `evt_${Date.now()}_${++sequence}`,
      occurredAt: occurredAt ?? new Date(),
      raw: { fake: true, type },
    } as unknown as Extract<BillingEvent, { type: T }>;
  }

  /** 把事件编码成带签名的 webhook 请求；`signature` 可以传入错误的签名做负面测试。 */
  request(event: BillingEvent, { signature }: { signature?: string } = {}) {
    // provider 和 raw 由接收方补上，不在请求体里。
    const body = JSON.stringify({
      ...event,
      provider: undefined,
      raw: undefined,
    });
    return new Request("https://example.test/api/billing/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [SIGNATURE_HEADER]: signature ?? this.sign(body),
      },
      body,
    });
  }
}
