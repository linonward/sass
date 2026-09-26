"use client";

import { useEffect } from "react";

import { captureError } from "@/core/observability/sentry";

// 根布局出错时替换整个文档，拿不到 globals.css 和主题，只用内联样式。
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
    captureError(error);
  }, [error]);

  return (
    // lang 和文案都写死英文：这个文件替换整个 root layout，拿不到 NextIntlClientProvider，
    // 是框架约束不是懒。今天与 site.config.ts 的 locales: ["en"] 一致；买家新增语言后
    // 这一页要自己处理（例如按 Accept-Language 选 lang 和文案），否则全局错误页不跟着变。
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          fontFamily: "system-ui, sans-serif",
          colorScheme: "light dark",
        }}
      >
        <title>Something went wrong</title>
        <main style={{ textAlign: "center", padding: "1rem" }}>
          <h1>Something went wrong</h1>
          <p>An unexpected error occurred. Please try again.</p>
          <button type="button" onClick={() => retry()}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
