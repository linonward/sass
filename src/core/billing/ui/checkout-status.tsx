"use client";

import {
  CircleAlertIcon,
  CircleCheckIcon,
  ClockIcon,
  Loader2Icon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Link } from "@/core/i18n/navigation";
import { buttonVariants } from "@/core/ui/button";
import { EmptyStateIcon } from "@/core/ui/empty-state";

type Result =
  | { status: "pending" }
  | { status: "complete"; planId: string | null; balance?: number }
  | { status: "failed"; planId: string | null };

const FIRST_DELAY = 1000;
const MAX_DELAY = 5000;

/**
 * 成功页：轮询 /api/billing/status，直到 webhook 把付款写进数据库。
 * 间隔从 1 秒起按 1.5 倍退避，最长 5 秒；超过 timeoutMs 显示联系支持，但仍在后台继续轮询，
 * webhook 晚到时页面会自动变成成功。离开页面时停止。
 */
export function CheckoutStatus({
  reference,
  timeoutMs,
  supportEmail,
  planNames,
}: {
  /** 服务商回跳附带的订阅或订单 ID。 */
  reference: { subscriptionId?: string; orderId?: string };
  timeoutMs: number;
  supportEmail: string;
  planNames: Record<string, string>;
}) {
  const t = useTranslations("Billing.success");
  const [result, setResult] = useState<Result>({ status: "pending" });
  const [timedOut, setTimedOut] = useState(false);
  const { subscriptionId, orderId } = reference;

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let delay = FIRST_DELAY;
    const query = new URLSearchParams();
    if (subscriptionId) query.set("subscription_id", subscriptionId);
    if (orderId) query.set("order_id", orderId);

    async function poll() {
      try {
        const response = await fetch(`/api/billing/status?${query}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (response.ok) {
          const next = (await response.json()) as Result;
          if (next.status !== "pending") {
            setResult(next);
            return;
          }
        }
      } catch {
        if (controller.signal.aborted) return;
        // 网络抖动：继续下一轮。
      }
      timer = setTimeout(poll, delay);
      delay = Math.min(delay * 1.5, MAX_DELAY);
    }

    const timeout = setTimeout(() => setTimedOut(true), timeoutMs);
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
      clearTimeout(timeout);
    };
  }, [subscriptionId, orderId, timeoutMs]);

  const plan = (id: string | null) => (id && planNames[id]) || "";

  if (result.status === "complete") {
    return (
      <State icon={<CircleCheckIcon />}>
        <h1 className="heading-display text-2xl">{t("completeTitle")}</h1>
        <p className="text-muted-foreground">
          {t("completeDescription", { plan: plan(result.planId) })}
        </p>
        {result.balance !== undefined && (
          <p className="text-sm">{t("credits", { balance: result.balance })}</p>
        )}
        <Actions />
      </State>
    );
  }

  if (result.status === "failed") {
    return (
      <State
        tone="neutral"
        icon={<CircleAlertIcon className="text-destructive" />}
      >
        <h1 className="heading-display text-2xl">{t("failedTitle")}</h1>
        <p className="text-muted-foreground">{t("failedDescription")}</p>
        <Actions />
      </State>
    );
  }

  if (timedOut) {
    return (
      <State tone="neutral" icon={<ClockIcon />}>
        <h1 className="heading-display text-2xl">{t("timeoutTitle")}</h1>
        <p className="text-muted-foreground">
          {t.rich("timeoutDescription", {
            email: supportEmail,
            link: (chunks) => (
              <a
                href={`mailto:${supportEmail}`}
                className="text-primary-text underline underline-offset-4"
              >
                {chunks}
              </a>
            ),
          })}
        </p>
        <Actions />
      </State>
    );
  }

  return (
    <State tone="neutral" icon={<Loader2Icon className="animate-spin" />} busy>
      <h1 className="heading-display text-2xl">{t("processingTitle")}</h1>
      <p className="text-muted-foreground">{t("processingDescription")}</p>
    </State>
  );
}

function State({
  icon,
  tone = "brand",
  busy = false,
  children,
}: {
  icon: React.ReactNode;
  /** 只有「完成了」用品牌片，等待和失败用中性片，语义交给图标自己。 */
  tone?: "brand" | "neutral";
  busy?: boolean;
  children: React.ReactNode;
}) {
  // role=status 必须留在最外层：dashboard 的 e2e 用无作用域的 getByRole("status")
  // 断言保存提示，这里再套一层会撞车。
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy={busy}
      className="mx-auto flex w-full max-w-md flex-col items-center gap-4 py-14 text-center"
    >
      <EmptyStateIcon tone={tone}>{icon}</EmptyStateIcon>
      {children}
    </div>
  );
}

function Actions() {
  const t = useTranslations("Billing.success");
  return (
    <div className="mt-4 flex flex-wrap justify-center gap-2">
      <Link href="/billing" className={buttonVariants()}>
        {t("toBilling")}
      </Link>
      <Link
        href="/dashboard"
        className={buttonVariants({ variant: "outline" })}
      >
        {t("toDashboard")}
      </Link>
    </div>
  );
}
