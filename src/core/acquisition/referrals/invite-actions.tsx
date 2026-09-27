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
  const [declined, setDeclined] = useState(false);
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
        setError(body?.error === "invalid" ? t("invalidTitle") : t("error"));
        return;
      }
      if (action === "decline") setDeclined(true);
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
        {mode !== "accepted" && (
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
        {!declined && (
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
      {/* 拒绝后说清楚发生了什么：页面回到未接受的状态，别让人以为点了没反应。 */}
      {declined && (
        <p role="status" className="text-muted-foreground text-sm">
          {t("declined")}
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
