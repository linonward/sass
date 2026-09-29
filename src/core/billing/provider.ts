import type { BillingEvent } from "./events";

export type CreateCheckoutInput = {
  userId: string;
  planId: string;
  successUrl: string;
  cancelUrl: string;
  /** Email prefilled on the checkout page. */
  customerEmail?: string;
};

export type Checkout = { checkoutId: string; url: string };

/**
 * Common interface for payment providers. Implementations live in ./providers/ (creem, stripe, plus
 * fake for tests) and are dispatched by `BILLING_PROVIDER` (see ./providers/index.ts). Billing tables,
 * event handling and credits need no changes: adding a provider only means implementing this interface
 * and adding an entry to the registry.
 */
export interface PaymentProvider {
  /** Provider ID, written to the provider column of every billing table. */
  readonly id: string;
  /**
   * Create a checkout session and return the URL to redirect to. userId must be passed to the provider
   * as metadata so it comes back in the webhook.
   */
  createCheckout(input: CreateCheckoutInput): Promise<Checkout>;
  /** URL of the page where customers manage their subscription and billing themselves. */
  getPortalUrl(customerId: string): Promise<string>;
  cancelSubscription(subscriptionId: string): Promise<void>;
  /**
   * Verify the webhook signature and return the parsed body. Throws WebhookVerificationError when the
   * signature is missing or wrong. Reads the request body, so don't read it again afterwards.
   */
  verifyWebhook(request: Request): Promise<unknown>;
  /** Turn a verified body into a BillingEvent; returns null for event types we don't care about. */
  parseEvent(payload: unknown): BillingEvent | null;
}

/**
 * Webhook signature verification failed. processWebhook returns 401 for it: nothing written, no
 * retry.
 */
export class WebhookVerificationError extends Error {
  constructor(message = "Invalid webhook signature") {
    super(message);
    this.name = "WebhookVerificationError";
  }
}
