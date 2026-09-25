"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Loader2Icon, SendIcon, SquareIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import { Link } from "@/core/i18n/navigation";
import { cn } from "@/core/lib/utils";
import { Button, buttonVariants } from "@/core/ui/button";
import { Input } from "@/core/ui/input";

const knownErrors = [
  "insufficient_credits",
  "rate_limited",
  "unavailable",
  "model_unavailable",
  "invalid_model",
  "too_large",
  "unauthorized",
  "model_error",
] as const;
type KnownError = (typeof knownErrors)[number];

/** 接口的错误响应是 JSON `{ error }`，useChat 把响应体原样放进 error.message；流中报错是 "model_error"。 */
export function chatErrorCode(
  error: Error | undefined,
): KnownError | "generic" {
  if (!error) return "generic";
  let code: unknown = error.message;
  try {
    code = (JSON.parse(error.message) as { error?: unknown }).error;
  } catch {
    // 不是 JSON，按原文匹配。
  }
  return knownErrors.includes(code as KnownError)
    ? (code as KnownError)
    : "generic";
}

/** 示例 Playground：选模型、发消息、流式显示回复。对话不保存，刷新即清空。 */
export function Playground({
  models,
  defaultModel,
}: {
  models: { id: string; creditCost: number }[];
  defaultModel: string;
}) {
  const t = useTranslations("Playground");
  const [modelId, setModelId] = useState(defaultModel);
  const [input, setInput] = useState("");
  const selectId = useId();
  const { messages, sendMessage, status, error, stop, clearError } = useChat({
    transport: new DefaultChatTransport({ api: "/api/ai/chat" }),
  });
  const busy = status === "submitted" || status === "streaming";
  const cost = models.find((m) => m.id === modelId)?.creditCost ?? 0;
  const errorCode = error ? chatErrorCode(error) : null;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    clearError();
    void sendMessage({ text }, { body: { modelId } });
    setInput("");
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label htmlFor={selectId} className="font-medium">
          {t("model")}
        </label>
        <select
          id={selectId}
          value={modelId}
          onChange={(event) => setModelId(event.target.value)}
          disabled={busy}
          className="border-input dark:bg-input/30 h-8 rounded-lg border bg-transparent px-2"
        >
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.id}
            </option>
          ))}
        </select>
        <span className="text-muted-foreground">
          {cost > 0 ? t("cost", { cost }) : t("free")}
        </span>
      </div>

      <div
        className="bg-muted/30 min-h-64 space-y-4 rounded-xl border p-4"
        aria-live="polite"
        data-testid="playground-messages"
      >
        {messages.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("empty")}</p>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                "max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap",
                message.role === "user"
                  ? "bg-primary text-primary-foreground ml-auto"
                  : "bg-background border",
              )}
            >
              <span className="sr-only">
                {message.role === "user" ? t("you") : t("assistant")}:{" "}
              </span>
              {message.parts.map((part, index) =>
                part.type === "text" ? (
                  <span key={index}>{part.text}</span>
                ) : null,
              )}
            </div>
          ))
        )}
        {status === "submitted" && (
          <Loader2Icon
            className="text-muted-foreground size-4 animate-spin"
            aria-label={t("thinking")}
          />
        )}
      </div>

      {errorCode && (
        <p role="alert" className="text-destructive text-sm">
          {t(`errors.${errorCode}`)}{" "}
          {errorCode === "insufficient_credits" && (
            <Link
              href="/pricing"
              className={buttonVariants({ variant: "link", size: "sm" })}
            >
              {t("buyCredits")}
            </Link>
          )}
        </p>
      )}

      <form onSubmit={submit} className="flex gap-2">
        <Input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={t("placeholder")}
          aria-label={t("placeholder")}
          maxLength={4000}
        />
        {busy ? (
          <Button type="button" variant="outline" onClick={() => void stop()}>
            <SquareIcon aria-hidden />
            {t("stop")}
          </Button>
        ) : (
          <Button type="submit" disabled={!input.trim()}>
            <SendIcon aria-hidden />
            {t("send")}
          </Button>
        )}
      </form>
    </div>
  );
}
