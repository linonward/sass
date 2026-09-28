// Lemon Squeezy 官方 webhook 请求体样本，见同目录的 lemonsqueezy-webhooks.json：
// order_created 等四个逐字摘录自 https://docs.lemonsqueezy.com/help/webhooks/example-payloads
// （2026-09-28 抓取），其余按对象页的字段表构造 —— JSON 顶部的 $comment 里写了出处和构造方式。
import samples from "./lemonsqueezy-webhooks.json";

/** `$comment` 是给读者看的出处说明，不是事件。 */
export type LemonSqueezySampleEvent = Exclude<keyof typeof samples, "$comment">;

type SampleWebhook = {
  meta: Record<string, unknown> & { event_name: string };
  data: Record<string, unknown> & {
    id: string | number;
    attributes: Record<string, unknown> & { first_order_item?: unknown };
  };
};

/** 深拷贝一份示例，测试里可以随意修改（注入 meta.custom_data、换 variant_id 等）。 */
export function lemonSqueezySample(event: LemonSqueezySampleEvent) {
  return structuredClone(samples[event]) as SampleWebhook;
}
