import { createHmac, timingSafeEqual } from "node:crypto";

import type { BillingEvent, BillingEventType } from "../events";
import {
  WebhookVerificationError,
  type Checkout,
  type CreateCheckoutInput,
  type PaymentProvider,
} from "../provider";

const SIGNATURE_HEADER = "x-fake-signature";

/** FakeProvider webhook body: one BillingEvent, with times sent as ISO strings. */
type FakePayload = Omit<BillingEvent, "provider" | "raw" | "occurredAt"> & {
  occurredAt: string;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
};

let sequence = 0;

/**
 * Payment provider for tests: the signature is an HMAC-SHA256 of the body and the event shape maps
 * one-to-one to BillingEvent. Build events with `event()` and signed webhook requests with
 * `request()`; it also records downstream calls for assertions.
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

  /**
   * Build an event (provider is fixed to this instance, eventId is unique by default, occurredAt
   * defaults to now).
   */
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

  /** Encode an event as a signed webhook request; pass a wrong `signature` for negative tests. */
  request(event: BillingEvent, { signature }: { signature?: string } = {}) {
    // provider and raw are filled in by the receiver; they aren't in the body.
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
