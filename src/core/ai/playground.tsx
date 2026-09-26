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
 * 流式更新的节流窗口（毫秒）。服务端按模型 delta 逐个推流（`run.ts` 的 streamText →
 * `chat.ts` 的 toUIMessageStreamResponse），而 useChat 默认**每个分片都触发一次重渲染**
 * （`@ai-sdk/react/dist/index.d.ts:119-122`：不传 throttle 就是关闭节流）。
 * 常见 30–80 token/s，即每秒 30–80 次重渲染。
 *
 * 取 50ms（每秒约 20 次）：吐字看起来仍是连续的，而两次提交之间留出约 3 帧，
 * 输入回显这类紧急更新不用和流式渲染抢主线程。50 也是 AI SDK 文档里 useChat 示例统一用的值
 * （`node_modules/ai/docs/04-ai-sdk-ui/02-chatbot.mdx` 的 "Throttling UI Updates"）。
 *
 * 语义（同文档）：只降低 React 通知频率，流处理和回调不受影响，
 * 且进入 ready / error 前会先发布最新消息 —— 不会丢最后一小段文字。
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

/**
 * 单条消息。memo 成立的前提是「写回时只有被改的那条消息换新对象」：
 * SDK 的 ReactChatState.replaceMessage 是
 * `[...messages.slice(0, index), snapshot(message), ...messages.slice(index + 1)]`
 * （`@ai-sdk/react/dist/index.js:208-215`），snapshot 又会克隆 parts，
 * 所以流式期间只有正在写的那条重渲染，已完成消息的 diff 成本不随对话变长。
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
 * 输入框。input 状态放在这里而不是 Playground：打字只重渲染这个子组件，
 * 不会把整条消息列表一起重渲染 —— 对话越长，这一点越重要。
 * memo 生效依赖 `onSend` / `onStop` 的引用稳定（见 Playground 里的 useCallback）。
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
  const selectId = useId();
  const { messages, sendMessage, status, error, stop, clearError } = useChat({
    transport: new DefaultChatTransport({ api: "/api/ai/chat" }),
    throttle: STREAM_THROTTLE_MS,
  });
  const busy = status === "submitted" || status === "streaming";
  const cost = models.find((m) => m.id === modelId)?.creditCost ?? 0;
  const errorCode = error ? chatErrorCode(error) : null;

  // Composer 是 memo 的，所以这几个引用要稳：sendMessage / clearError / stop 都是 chat
  // 实例上的属性（引用不随渲染变），这里只有 modelId 会变。
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
        // 空的时候把这个盒子本身变成居中容器，空状态才不会贴在 256px 高的框顶上。
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
