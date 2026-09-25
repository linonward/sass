// Creem 官方文档里的示例 webhook 请求体，原样摘录自 https://docs.creem.io/code/webhooks
// （2026-09-25 抓取）。文档更新后可以重新摘录，测试不应依赖其中的具体 ID。
import samples from "./creem-webhooks.json";

export type CreemSampleEvent = keyof typeof samples;

/** 深拷贝一份示例，测试里可以随意修改（注入 metadata、换 ID）。 */
export function creemSample(event: CreemSampleEvent) {
  return structuredClone(samples[event]) as {
    id: string;
    eventType: string;
    created_at: number;
    object: Record<string, unknown> & {
      metadata?: Record<string, unknown>;
    };
  };
}
