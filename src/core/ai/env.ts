import { z } from "zod";

// Loaded indirectly by next.config.ts, which doesn't resolve the `@/` alias, so relative paths
// only.
import type { AiProvider } from "../config/schema";
import { requiredWhen } from "../create-env";

type RuntimeEnv = Record<string, string | undefined>;

/**
 * API key variable names per provider, matching the variables each AI SDK provider reads by
 * default.
 */
export const aiProviderKeys = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
  alibaba: "ALIBABA_API_KEY",
} as const satisfies Record<AiProvider, string>;

/**
 * Variables for the AI module: one key per provider; each provider with a key set is enabled. When
 * `features.ai` is on, Vercel production must set a key for every provider used by `ai.models`;
 * other environments may leave them out, in which case calls to those models return 503.
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
    ALIBABA_API_KEY: key("alibaba"),
    // Model Studio's OpenAI-compatible URL; the key's region decides which one to use. Leave it
    // unset for the AI SDK default, the international site (Singapore); for the Beijing region set
    // https://dashscope.aliyuncs.com/compatible-mode/v1.
    ALIBABA_BASE_URL: z.url().optional(),
  };
}
