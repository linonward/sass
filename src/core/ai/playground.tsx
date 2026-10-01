"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import {
  CheckIcon,
  CopyIcon,
  Loader2Icon,
  SendIcon,
  SparklesIcon,
  SquareIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { memo, useCallback, useId, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Streamdown, type StreamdownTranslations } from "streamdown";

import { Link } from "@/core/i18n/navigation";
import { cn } from "@/core/lib/utils";
import { Button, buttonVariants } from "@/core/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/core/ui/select";
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

/**
 * Prompt templates shown under an empty conversation. Each id maps to
 * `Playground.templates.<id>.label` / `.prompt` in `messages/*.json`; add or remove ids here and
 * there together. Picking one fills the input rather than sending, so the user can finish the
 * sentence first.
 */
export const PROMPT_TEMPLATES = [
  "summarize",
  "translate",
  "code",
  "email",
] as const;

/**
 * Markdown controls kept in the playground: copy on code blocks and tables. Downloads, fullscreen
 * and mermaid are off, so their strings never show up untranslated.
 */
const MARKDOWN_CONTROLS = {
  code: { copy: true, download: false },
  table: { copy: true, download: false, fullscreen: false },
  mermaid: false,
  image: false,
} as const;

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
 * Streamdown's UI strings that can appear with MARKDOWN_CONTROLS: code/table copy and the
 * confirmation dialog it shows before opening an external link.
 */
function useMarkdownTranslations(): Partial<StreamdownTranslations> {
  const t = useTranslations("Playground.markdown");
  return useMemo(
    () => ({
      copyCode: t("copyCode"),
      copied: t("copied"),
      copyTable: t("copyTable"),
      copyTableAsMarkdown: t("copyTableAsMarkdown"),
      copyTableAsCsv: t("copyTableAsCsv"),
      copyTableAsTsv: t("copyTableAsTsv"),
      tableFormatMarkdown: t("tableFormatMarkdown"),
      tableFormatCsv: t("tableFormatCsv"),
      tableFormatTsv: t("tableFormatTsv"),
      openExternalLink: t("openExternalLink"),
      externalLinkWarning: t("externalLinkWarning"),
      openLink: t("openLink"),
      copyLink: t("copyLink"),
      close: t("close"),
    }),
    [t],
  );
}

/** Copies a whole reply as its markdown source. */
function CopyMessageButton({ text }: { text: string }) {
  const t = useTranslations("Playground");
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // No clipboard permission or insecure context: leave the label alone rather than claim it
      // worked. The text is still selectable in the bubble.
      return;
    }
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={() => void copy()}
      aria-label={copied ? t("copied") : t("copyReply")}
      title={copied ? t("copied") : t("copyReply")}
      data-testid="playground-copy-reply"
    >
      {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
    </Button>
  );
}

/**
 * A single message. memo works because on write-back only the changed message gets a new object:
 * the SDK's ReactChatState.replaceMessage is
 * `[...messages.slice(0, index), snapshot(message), ...messages.slice(index + 1)]`
 * (`@ai-sdk/react/dist/index.js:208-215`), and snapshot clones parts, so during streaming only the
 * message being written re-renders, and diffing finished messages doesn't get costlier as the
 * conversation grows.
 *
 * User messages stay plain text (what they typed is what they see). Assistant replies render as
 * markdown through Streamdown, which tolerates half-written syntax mid-stream (an unclosed code
 * fence or `**`) and sanitizes links and HTML. `streaming` is only true for the reply being
 * written, so finished replies keep their memo.
 */
const MessageBubble = memo(function MessageBubble({
  message,
  streaming,
}: {
  message: UIMessage;
  streaming: boolean;
}) {
  const t = useTranslations("Playground");
  const markdownTranslations = useMarkdownTranslations();
  const isUser = message.role === "user";
  const text = message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");

  if (isUser) {
    return (
      <div className="bg-primary text-primary-foreground ml-auto w-fit max-w-[85%] rounded-lg px-3 py-2 text-sm break-words whitespace-pre-wrap">
        <span className="sr-only">{t("you")}: </span>
        {text}
      </div>
    );
  }

  return (
    <div className="flex max-w-[85%] flex-col items-start gap-1">
      <div
        className="bg-background w-full min-w-0 rounded-lg border px-3 py-2 text-sm"
        data-testid="playground-reply"
      >
        <span className="sr-only">{t("assistant")}: </span>
        <Streamdown
          className="space-y-3 break-words [&_pre]:overflow-x-auto"
          isAnimating={streaming}
          controls={MARKDOWN_CONTROLS}
          lineNumbers={false}
          translations={markdownTranslations}
        >
          {text}
        </Streamdown>
      </div>
      {!streaming && text && <CopyMessageButton text={text} />}
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
  showTemplates,
  onSend,
  onStop,
}: {
  busy: boolean;
  /** Offer the prompt templates (only while the conversation is empty). */
  showTemplates: boolean;
  onSend: (text: string) => void;
  onStop: () => Promise<void>;
}) {
  const t = useTranslations("Playground");
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function applyTemplate(prompt: string) {
    // Commit the value synchronously so the caret can go to the end right away; deferring it lets
    // the first keystroke land before the caret moves.
    flushSync(() => setInput(prompt));
    const field = inputRef.current;
    field?.focus();
    field?.setSelectionRange(prompt.length, prompt.length);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    onSend(text);
    setInput("");
  }

  return (
    <div className="flex flex-col gap-3">
      {showTemplates && (
        <div
          role="group"
          aria-label={t("templates.label")}
          className="flex flex-wrap gap-2"
        >
          {PROMPT_TEMPLATES.map((id) => (
            <Button
              key={id}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => applyTemplate(t(`templates.items.${id}.prompt`))}
            >
              {t(`templates.items.${id}.label`)}
            </Button>
          ))}
        </div>
      )}
      <form onSubmit={submit} className="flex gap-2">
        <Input
          ref={inputRef}
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
    </div>
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
        <Select
          id={selectId}
          value={modelId}
          onValueChange={(value) => value && setModelId(value)}
          disabled={busy}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {models.map((model) => (
              <SelectItem key={model.id} value={model.id}>
                {model.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
          messages.map((message, index) => (
            <MessageBubble
              key={message.id}
              message={message}
              streaming={
                status === "streaming" && index === messages.length - 1
              }
            />
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

      <Composer
        busy={busy}
        showTemplates={messages.length === 0}
        onSend={sendText}
        onStop={stop}
      />
    </div>
  );
}
