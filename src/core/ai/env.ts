import { z } from "zod";

// 会被 next.config.ts 间接加载，那里不解析 `@/` 别名，只能用相对路径。
import type { AiProvider } from "../config/schema";
import { requiredWhen } from "../create-env";

type RuntimeEnv = Record<string, string | undefined>;

/** 各服务商的 API key 变量名，与 AI SDK 各 provider 默认读取的变量一致。 */
export const aiProviderKeys = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
} as const satisfies Record<AiProvider, string>;

/**
 * AI 模块的变量：每家服务商一个 key，填了哪家就启用哪家。
 * `features.ai` 开启时，Vercel 生产环境必须填上 `ai.models` 用到的每家服务商的 key；
 * 其他环境可以不填，此时这些模型的调用返回 503。
 */
export function aiServerEnv(
  runtimeEnv: RuntimeEnv,
  { enabled, providers }: { enabled: boolean; providers: AiProvider[] },
) {
  const production = runtimeEnv.VERCEL_ENV === "production" && enabled;
  const key = (provider: AiProvider) =>
    requiredWhen(production && providers.includes(provider), z.string().min(1));
  return {
    OPENAI_API_KEY: key("openai"),
    ANTHROPIC_API_KEY: key("anthropic"),
    GOOGLE_GENERATIVE_AI_API_KEY: key("google"),
  };
}
