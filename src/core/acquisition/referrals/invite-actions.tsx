"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { useRouter } from "@/core/i18n/navigation";
import { Button } from "@/core/ui/button";

type Mode = "offer" | "accepted" | "clear";

/**
 * 邀请的接受/拒绝。只把码交给服务端，归属由服务端在注册时依据登录身份决定；
 * 客户端不提交任何用户 ID，也不决定谁能拿奖励。动作完成后刷新服务端渲染的页面。
 */
export function InviteActions({ code, mode }: { code: string; mode: Mode }) {
  const t = useTranslations("Referrals.invite");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  // 清掉的是哪一份邀请：清除前一处上下文和拒绝本次邀请不是同一件事，文案要说对。
  const [done, setDone] = useState<"declined" | "cleared" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(action: "accept" | "decline") {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/acquisition/referrals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          action === "accept" ? { action, code } : { action },
        ),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(
          response.status === 429
            ? t("rateLimited")
            : body?.error === "invalid"
              ? t("invalidTitle")
              : t("error"),
        );
        return;
      }
      if (action === "decline")
        setDone(mode === "clear" ? "cleared" : "declined");
      router.refresh();
    } catch {
      setError(t("error"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {/* 已有上下文时接受不了这一份（服务端保持第一个邀请不动），不给会静默失败的按钮。 */}
        {mode === "offer" && (
          <Button
            type="button"
            size="marketing"
            disabled={pending}
            data-testid="referral-accept"
            onClick={() => submit("accept")}
          >
            {t("accept")}
          </Button>
        )}
        {!done && (
          <Button
            type="button"
            size="marketing"
            variant="outline"
            disabled={pending}
            data-testid="referral-decline"
            onClick={() => submit("decline")}
          >
            {mode === "offer" ? t("decline") : t("clear")}
          </Button>
        )}
      </div>
      {/* 清除或拒绝后说清楚发生了什么：页面回到未接受的状态，别让人以为点了没反应。 */}
      {done && (
        <p role="status" className="text-muted-foreground text-sm">
          {done === "cleared" ? t("cleared") : t("declined")}
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
