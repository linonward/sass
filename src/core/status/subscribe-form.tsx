"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";

import { subscribeAction, type SubscribeState } from "./actions";

const idle: SubscribeState = { status: "idle" };

/**
 * 状态页底部的订阅表单：留邮箱 → 收确认信 → 之后 incident 变更会通知。
 *
 * 提交结果只有两种（成功 / 输错了），没有「这个地址已经订过」这一档 —— 见 subscribeAction。
 */
export function SubscribeForm({ locale }: { locale: string }) {
  const t = useTranslations("Status.subscribe");
  const [state, action, pending] = useActionState(subscribeAction, idle);

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="locale" value={locale} />
      {/* 蜜罐：真人看不到这个输入框，填了的都是脚本。 */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden
        className="hidden"
      />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="status-subscribe-email">{t("label")}</Label>
        <div className="flex flex-wrap items-center gap-3">
          <Input
            id="status-subscribe-email"
            name="email"
            type="email"
            required
            maxLength={254}
            autoComplete="email"
            placeholder={t("placeholder")}
            disabled={pending}
            className="sm:max-w-72"
          />
          <Button
            type="submit"
            size="marketing"
            tone="primary"
            disabled={pending}
          >
            {t("cta")}
          </Button>
        </div>
      </div>
      {state.status === "success" && (
        <p role="status" className="text-sm">
          {t("done")}
        </p>
      )}
      {state.status === "error" && (
        <p role="alert" className="text-destructive text-sm">
          {t(`errors.${state.error}`)}
        </p>
      )}
    </form>
  );
}
