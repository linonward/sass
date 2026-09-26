"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";

import { captureError } from "@/core/observability/sentry";
import { Button } from "@/core/ui/button";

export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const t = useTranslations("Error");

  useEffect(() => {
    console.error(error);
    captureError(error);
  }, [error]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      {/* 错误边界必须是 client 组件，用不了 metadata 导出，按文档用 React <title>。
          React 会把它插到 <head> 里已有 <title> 的前面，浏览器取第一个，所以能盖住
          被替换掉的那页的标题。 */}
      <title>{t("title")}</title>
      <h1 className="heading-display text-4xl sm:text-5xl">{t("title")}</h1>
      <p className="text-muted-foreground text-lg text-pretty">
        {t("description")}
      </p>
      {error.digest && (
        <p className="text-muted-foreground font-mono text-xs">
          {t("id", { digest: error.digest })}
        </p>
      )}
      {/* 营销面的 CTA 是 44px 带唇边的贴纸；默认的 32px 也低于 design.md 的触控目标下限。 */}
      <Button size="marketing" tone="primary" onClick={() => retry()}>
        {t("retry")}
      </Button>
    </main>
  );
}
