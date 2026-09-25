import type { BillingEvent } from "./events";

export type CreateCheckoutInput = {
  userId: string;
  planId: string;
  successUrl: string;
  cancelUrl: string;
  /** 预填到结账页的邮箱。 */
  customerEmail?: string;
};

export type Checkout = { checkoutId: string; url: string };

/**
 * 支付服务商的统一接口。v1 只实现 Creem（T303）；换服务商时实现这个接口即可，
 * 账单表、事件处理和积分都不需要改。
 */
export interface PaymentProvider {
  /** 服务商 ID，写入各张账单表的 provider 列。 */
  readonly id: string;
  /** 创建结账会话，返回要跳转的地址。userId 须作为 metadata 传给服务商，webhook 里带回来。 */
  createCheckout(input: CreateCheckoutInput): Promise<Checkout>;
  /** 客户自助管理订阅和账单的页面地址。 */
  getPortalUrl(customerId: string): Promise<string>;
  cancelSubscription(subscriptionId: string): Promise<void>;
  /**
   * 校验 webhook 签名并返回解析后的请求体。签名缺失或不正确时抛出 WebhookVerificationError。
   * 会读取 request 的 body，调用后不要再读。
   */
  verifyWebhook(request: Request): Promise<unknown>;
  /** 把已校验的请求体转换成 BillingEvent；不关心的事件类型返回 null。 */
  parseEvent(payload: unknown): BillingEvent | null;
}

/** webhook 签名校验失败。processWebhook 对它返回 401，不写库、不重试。 */
export class WebhookVerificationError extends Error {
  constructor(message = "Invalid webhook signature") {
    super(message);
    this.name = "WebhookVerificationError";
  }
}
