import { createAlibaba } from "@ai-sdk/alibaba";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { ImageModelV4 } from "@ai-sdk/provider";
import { createProviderRegistry, type LanguageModel } from "ai";

import type {
  AiImageModel,
  AiImageProvider,
  AiModel,
  AiProvider,
  AiVideoModel,
} from "@/core/config/schema";

import { createAlibabaImageModel } from "./alibaba-image";
import { createAlibabaVideoClient, type VideoClient } from "./alibaba-video";

import { aiProviderKeys } from "./env";

type ProviderKeys = Partial<
  Record<
    (typeof aiProviderKeys)[AiProvider] | "ALIBABA_BASE_URL",
    string | undefined
  >
>;

const factories = {
  openai: (apiKey: string) => createOpenAI({ apiKey }),
  anthropic: (apiKey: string) => createAnthropic({ apiKey }),
  google: (apiKey: string) => createGoogleGenerativeAI({ apiKey }),
  alibaba: (apiKey: string, keys: ProviderKeys) =>
    createAlibaba({ apiKey, baseURL: keys.ALIBABA_BASE_URL }),
} satisfies Record<AiProvider, (apiKey: string, keys: ProviderKeys) => unknown>;

/** Providers that have a key configured in env. */
export function enabledProviders(keys: ProviderKeys): AiProvider[] {
  return (Object.keys(aiProviderKeys) as AiProvider[]).filter((provider) =>
    Boolean(keys[aiProviderKeys[provider]]),
  );
}

/**
 * Builds the provider registry from the keys in env (model IDs look like "openai:gpt-5-mini") and
 * returns getModel: it returns null when the provider has no key, which runAI turns into a 503.
 */
export function createModelResolver(keys: ProviderKeys) {
  const providers = enabledProviders(keys);
  const registry = createProviderRegistry(
    Object.fromEntries(
      providers.map((provider) => [
        provider,
        factories[provider](keys[aiProviderKeys[provider]]!, keys),
      ]),
    ),
  );
  return (model: AiModel): LanguageModel | null =>
    providers.includes(model.provider)
      ? registry.languageModel(`${model.provider}:${model.model}` as never)
      : null;
}

const imageFactories = {
  openai: (model: string, apiKey: string) =>
    createOpenAI({ apiKey }).image(model),
  google: (model: string, apiKey: string) =>
    createGoogleGenerativeAI({ apiKey }).image(model),
  alibaba: (model: string, apiKey: string, keys: ProviderKeys) =>
    createAlibabaImageModel(model, { apiKey, baseURL: keys.ALIBABA_BASE_URL }),
} satisfies Record<
  AiImageProvider,
  (model: string, apiKey: string, keys: ProviderKeys) => ImageModelV4
>;

/** Image model: returns null when the provider has no key, which runImage turns into a 503. */
export function createImageModelResolver(keys: ProviderKeys) {
  const providers = enabledProviders(keys);
  return (model: AiImageModel): ImageModelV4 | null =>
    providers.includes(model.provider)
      ? imageFactories[model.provider](
          model.model,
          keys[aiProviderKeys[model.provider]]!,
          keys,
        )
      : null;
}

/**
 * Video client: returns null when the provider has no key, which the video endpoint turns into a
 * 503.
 */
export function createVideoClientResolver(keys: ProviderKeys) {
  const providers = enabledProviders(keys);
  return (model: AiVideoModel): VideoClient | null =>
    providers.includes(model.provider)
      ? createAlibabaVideoClient({
          apiKey: keys[aiProviderKeys[model.provider]]!,
          baseURL: keys.ALIBABA_BASE_URL,
        })
      : null;
}
