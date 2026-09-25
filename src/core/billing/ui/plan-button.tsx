"use client";

import { Loader2Icon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Link } from "@/core/i18n/navigation";
import { cn } from "@/core/lib/utils";
import { Button, buttonVariants } from "@/core/ui/button";

import { useCheckout } from "./use-checkout";

/**
 * 定价卡片上的按钮。落地页是静态页面，不知道访客是否登录，`owned` 为空：
 * 点击后由结账接口决定去结账、去登录还是去客户门户。/pricing 会传入 `owned`，直接显示对应状态。
 */
export function PlanButton({
  planId,
  label,
  free,
  highlighted,
  owned,
}: {
  planId: string;
  label: string;
  free: boolean;
  highlighted: boolean;
  owned?: "subscribed" | "purchased";
}) {
  const t = useTranslations("Billing");
  const { start, pending, error } = useCheckout();
  const variant = highlighted ? "default" : "outline";
  const className = "mt-8 w-full";

  // 免费套餐不用付款：直接进 dashboard，未登录时由 proxy 先带去登录。
  if (free) {
    return (
      <Link
        href="/dashboard"
        className={cn(buttonVariants({ size: "lg", variant }), className)}
      >
        {label}
      </Link>
    );
  }
  if (owned === "subscribed") {
    return (
      // 客户门户是服务端重定向，要整页跳转。
      // eslint-disable-next-line @next/next/no-html-link-for-pages
      <a
        href="/api/billing/portal"
        className={cn(buttonVariants({ size: "lg", variant }), className)}
      >
        {t("actions.manage")}
      </a>
    );
  }
  if (owned === "purchased") {
    return (
      <Link
        href="/billing"
        className={cn(
          buttonVariants({ size: "lg", variant: "outline" }),
          className,
        )}
      >
        {t("actions.purchased")}
      </Link>
    );
  }

  return (
    <div className={className}>
      <Button
        type="button"
        size="lg"
        variant={variant}
        className="w-full"
        disabled={pending}
        aria-busy={pending}
        onClick={() => start(planId)}
      >
        {pending && <Loader2Icon className="animate-spin" aria-hidden />}
        {label}
      </Button>
      {error && (
        <p role="alert" className="text-destructive mt-2 text-sm">
          {t(`errors.${error}`)}
        </p>
      )}
    </div>
  );
}
