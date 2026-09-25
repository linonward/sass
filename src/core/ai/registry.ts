import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createProviderRegistry, type LanguageModel } from "ai";

import type { AiModel, AiProvider } from "@/core/config/schema";

import { aiProviderKeys } from "./env";

type ProviderKeys = Partial<
  Record<(typeof aiProviderKeys)[AiProvider], string | undefined>
>;

const factories = {
  openai: (apiKey: string) => createOpenAI({ apiKey }),
  anthropic: (apiKey: string) => createAnthropic({ apiKey }),
  google: (apiKey: string) => createGoogleGenerativeAI({ apiKey }),
} satisfies Record<AiProvider, (apiKey: string) => unknown>;

/** env 里配置了 key 的服务商。 */
export function enabledProviders(keys: ProviderKeys): AiProvider[] {
  return (Object.keys(aiProviderKeys) as AiProvider[]).filter((provider) =>
    Boolean(keys[aiProviderKeys[provider]]),
  );
}

/**
 * 按 env 里的 key 创建 provider registry（模型 ID 形如 "openai:gpt-5-mini"），
 * 返回 getModel：服务商没有 key 时返回 null，由 runAI 转成 503。
 */
export function createModelResolver(keys: ProviderKeys) {
  const providers = enabledProviders(keys);
  const registry = createProviderRegistry(
    Object.fromEntries(
      providers.map((provider) => [
        provider,
        factories[provider](keys[aiProviderKeys[provider]]!),
      ]),
    ),
  );
  return (model: AiModel): LanguageModel | null =>
    providers.includes(model.provider)
      ? registry.languageModel(`${model.provider}:${model.model}` as never)
      : null;
}
