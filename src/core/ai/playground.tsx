"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Loader2Icon, SendIcon, SparklesIcon, SquareIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { memo, useCallback, useId, useState } from "react";

import { Link } from "@/core/i18n/navigation";
import { cn } from "@/core/lib/utils";
import { Button, buttonVariants } from "@/core/ui/button";
import { EmptyState } from "@/core/ui/empty-state";
import { Input } from "@/core/ui/input";

/**
 * Throttle window for streaming updates (ms). The server streams model deltas one by one
 * (streamText in `run.ts` → toUIMessageStreamResponse in `chat.ts`), and by default useChat
 * **re-renders on every chunk** (`@ai-sdk/react/dist/index.d.ts:119-122`: no throttle means
 * throttling is off). Typical rates are 30–80 tokens/s, i.e. 30–80 re-renders per second.
 *
 * 50ms (about 20 per second): text still appears to flow continuously, while leaving about 3
 * frames between commits so urgent updates like input echo don't compete with stream rendering for
 * the main thread. 50 is also the value every useChat example in the AI SDK docs uses
 * ("Throttling UI Updates" in `node_modules/ai/docs/04-ai-sdk-ui/02-chatbot.mdx`).
 *
 * Semantics (same doc): it only lowers how often React is notified; stream processing and callbacks
 * are unaffected, and the latest message is published before entering ready / error — the last bit
 * of text is never dropped.
 */
const STREAM_THROTTLE_MS = 50;

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

/**
 * Error responses are JSON `{ error }`, and useChat puts the response body as is into
 * error.message; an error mid-stream is "model_error".
 */
export function chatErrorCode(
  error: Error | undefined,
): KnownError | "generic" {
  if (!error) return "generic";
  let code: unknown = error.message;
  try {
    code = (JSON.parse(error.message) as { error?: unknown }).error;
  } catch {
    // Not JSON; match the raw text.
  }
  return knownErrors.includes(code as KnownError)
    ? (code as KnownError)
    : "generic";
}

/**
 * A single message. memo works because on write-back only the changed message gets a new object:
 * the SDK's ReactChatState.replaceMessage is
 * `[...messages.slice(0, index), snapshot(message), ...messages.slice(index + 1)]`
 * (`@ai-sdk/react/dist/index.js:208-215`), and snapshot clones parts, so during streaming only the
 * message being written re-renders, and diffing finished messages doesn't get costlier as the
 * conversation grows.
 */
const MessageBubble = memo(function MessageBubble({
  message,
}: {
  message: UIMessage;
}) {
  const t = useTranslations("Playground");
  return (
    <div
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
        part.type === "text" ? <span key={index}>{part.text}</span> : null,
      )}
    </div>
  );
});

/**
 * The input box. input state lives here rather than in Playground: typing re-renders only this
 * child, not the whole message list — which matters more the longer the conversation gets.
 * memo only helps if the `onSend` / `onStop` references are stable (see the useCallback in
 * Playground).
 */
const Composer = memo(function Composer({
  busy,
  onSend,
  onStop,
}: {
  busy: boolean;
  onSend: (text: string) => void;
  onStop: () => Promise<void>;
}) {
  const t = useTranslations("Playground");
  const [input, setInput] = useState("");

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    onSend(text);
    setInput("");
  }

  return (
    <form onSubmit={submit} className="flex gap-2">
      <Input
        value={input}
        onChange={(event) => setInput(event.target.value)}
        placeholder={t("placeholder")}
        aria-label={t("placeholder")}
        maxLength={4000}
      />
      {busy ? (
        <Button type="button" variant="outline" onClick={() => void onStop()}>
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
  );
});

/**
 * Example Playground: pick a model, send messages, and see replies stream in. Conversations aren't
 * saved; a reload clears them.
 */
export function Playground({
  models,
  defaultModel,
}: {
  models: { id: string; creditCost: number }[];
  defaultModel: string;
}) {
  const t = useTranslations("Playground");
  const [modelId, setModelId] = useState(defaultModel);
  const selectId = useId();
  const { messages, sendMessage, status, error, stop, clearError } = useChat({
    transport: new DefaultChatTransport({ api: "/api/ai/chat" }),
    throttle: STREAM_THROTTLE_MS,
  });
  const busy = status === "submitted" || status === "streaming";
  const cost = models.find((m) => m.id === modelId)?.creditCost ?? 0;
  const errorCode = error ? chatErrorCode(error) : null;

  // Composer is memoized, so these references must be stable: sendMessage / clearError / stop are
  // all properties of the chat instance (their references don't change across renders); only
  // modelId changes here.
  const sendText = useCallback(
    (text: string) => {
      clearError();
      void sendMessage({ text }, { body: { modelId } });
    },
    [clearError, sendMessage, modelId],
  );

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
          className="border-border dark:bg-input/30 h-8 rounded-lg border bg-transparent px-2"
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
        // When empty, turn this box itself into a centering container so the empty state doesn't
        // stick to the top of the 256px-tall box.
        className={cn(
          "panel min-h-64 space-y-4 p-4",
          messages.length === 0 && "flex items-center justify-center",
        )}
        aria-live="polite"
        data-testid="playground-messages"
      >
        {messages.length === 0 ? (
          <EmptyState size="sm" icon={<SparklesIcon />} title={t("empty")} />
        ) : (
          messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
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

      <Composer busy={busy} onSend={sendText} onStop={stop} />
    </div>
  );
}
