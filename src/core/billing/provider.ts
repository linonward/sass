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
 * 支付服务商的统一接口。实现见 ./providers/（creem、stripe，以及测试用的 fake），
 * 由 `BILLING_PROVIDER` 分派（见 ./providers/index.ts）。
 * 账单表、事件处理和积分都不需要改，加服务商只要实现这个接口并在注册表里加一条。
 */
export interface PaymentProvider {
  /** 服务商 ID，写入各张账单表的 provider 列。 */
  readonly id: string;
  /**
   * 金额每次下单时直接传、服务商那边没有产品目录（例如 Waffo）：结账不要求套餐配
   * `providerProductId`，adapter 自己按套餐的 `price` 和站点币种下单。默认 false。
   */
  readonly inlinePricing?: boolean;
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
  /**
   * 服务商对 webhook 的回复有特定要求时实现（例如 Waffo 要求带签名的 `{"message":"success"}`，
   * 否则按失败重推）。`ok` 为 false 表示处理失败、需要服务商重推。不实现时用默认的 JSON 回复。
   * 签名校验失败（401）不走这里。
   */
  webhookResponse?(ok: boolean): Response;
}

/** webhook 签名校验失败。processWebhook 对它返回 401，不写库、不重试。 */
export class WebhookVerificationError extends Error {
  constructor(message = "Invalid webhook signature") {
    super(message);
    this.name = "WebhookVerificationError";
  }
}
