"use client";

import { useLocale } from "next-intl";
import { useState } from "react";

import { getPathname } from "@/core/i18n/navigation";
import { trackEvents } from "@/core/observability/events";
import { track } from "@/core/observability/track";

export type CheckoutErrorKey =
  | "billing_not_configured"
  | "plan_not_configured"
  | "invalid_plan"
  | "no_customer"
  | "generic";

const KNOWN: readonly string[] = [
  "billing_not_configured",
  "plan_not_configured",
  "invalid_plan",
  "no_customer",
];

/**
 * 发起结账：
 * - 成功：跳到服务商的结账页。
 * - 未登录：去登录页，登录后回到 /pricing?plan=<id> 继续结账。
 * - 已订阅：去客户门户；一次性套餐已买过：去账单页。
 * - 其他错误：返回错误 key，由调用方显示。
 */
/** 整页跳转。结账、客户门户要离开本站；登录页和账单页也用整页跳转，组件不依赖 App Router 上下文。 */
function go(path: string) {
  window.location.assign(new URL(path, window.location.href));
}

export function useCheckout() {
  const locale = useLocale();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<CheckoutErrorKey | null>(null);

  async function start(planId: string) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planId, locale }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (response.ok && body.url) {
        // 服务商的结账页（fake 模式下是站内的模拟页）。
        track(trackEvents.checkoutStarted, { plan: planId });
        go(body.url);
        return;
      }
      if (response.status === 401) {
        // 登录页的 callbackURL 是带语言前缀的完整站内路径。
        const callback = `${getPathname({ href: "/pricing", locale })}?plan=${encodeURIComponent(planId)}`;
        const signIn = getPathname({ href: "/sign-in", locale });
        go(`${signIn}?callbackURL=${encodeURIComponent(callback)}`);
        return;
      }
      if (body.error === "already_subscribed") {
        // 客户门户由服务端重定向到服务商。
        go("/api/billing/portal");
        return;
      }
      if (body.error === "already_purchased") {
        go(getPathname({ href: "/billing", locale }));
        return;
      }
      setError(
        body.error && KNOWN.includes(body.error)
          ? (body.error as CheckoutErrorKey)
          : "generic",
      );
    } catch {
      setError("generic");
    }
    setPending(false);
  }

  return { start, pending, error };
}
