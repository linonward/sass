"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";

/**
 * 邀请链接的展示与复制。复制失败（无剪贴板权限、非安全上下文）时退回手动复制：
 * 选中输入框内容并提示按键，不假装已经复制成功。
 */
export function CopyLink({ link }: { link: string }) {
  const t = useTranslations("Referrals");
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setState("copied");
    } catch {
      const field = document.getElementById("referral-link");
      if (field instanceof HTMLInputElement) field.select();
      setState("manual");
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="referral-link">
          {t("linkLabel")}
        </label>
        <Input
          id="referral-link"
          data-testid="referral-link"
          readOnly
          value={link}
          className="font-mono text-xs sm:text-sm"
        />
        <Button
          type="button"
          variant="outline"
          className="sm:w-40"
          data-testid="referral-copy"
          data-state={state}
          onClick={copy}
        >
          {state === "copied" ? t("copied") : t("copy")}
        </Button>
      </div>
      {state === "manual" && (
        <p className="text-muted-foreground text-sm">{t("copyManual")}</p>
      )}
    </div>
  );
}
