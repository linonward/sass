// Stripe 官方 API 文档里的示例对象拼成的 webhook 请求体（不是真实投递抓包）。
// 2026-09-28 从下面的页面摘录，字段名以 stripe-node 22.6.2 自带的类型定义（apiVersion
// 2026-08-26.dahlia）为准：
// - Checkout Session：https://docs.stripe.com/api/checkout/sessions/object
// - Subscription：https://docs.stripe.com/api/subscriptions/object
// - Invoice：https://docs.stripe.com/api/invoices/object
// - Invoice Line Item：https://docs.stripe.com/api/invoices/line_item
// - Event 信封：https://docs.stripe.com/api/events/object
// 每个条目都是一条完整的 event（含 data.object），ID 和金额是文档示例里的值；
// 文档更新后可以重新摘录，测试不应依赖其中的具体 ID。
import samples from "./stripe-webhooks.json";

export type StripeSampleEvent = keyof typeof samples;

type StripeSample = {
  id: string;
  type: string;
  created: number;
  data: { object: Record<string, unknown> };
};

/** 深拷贝一份示例，测试里可以随意修改（改 metadata、改 status、删字段）。 */
export function stripeSample(event: StripeSampleEvent) {
  return structuredClone(samples[event]) as StripeSample;
}
