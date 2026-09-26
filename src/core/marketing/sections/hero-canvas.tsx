import { CheckIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import type { Plan } from "@/core/config/schema";
import { cn } from "@/core/lib/utils";

/**
 * 首屏右侧的产品拼贴。
 *
 * 参考站用的是「几张真实 UI 卡片互相叠压」，不是一张干净的截图，也不是装饰渐变。
 * 这里用真实 DOM 搭同样的东西：终端、结账台、到账提示。
 *
 * 卡片之间用负外边距压出叠压感，不用绝对定位 —— 绝对定位在窄屏上最容易把
 * 页面撑出横向滚动条，而 375px 不横向溢出是 e2e 锁死的行为。
 */
export function HeroCanvas({
  plan,
  currency,
}: {
  plan: Plan | undefined;
  currency: string;
}) {
  const t = useTranslations("Landing.hero.mock");
  const format = useFormatter();
  // 套餐名在 messages 里，不在配置对象上（和 pricing 区块同源）。
  const planT = useTranslations("Landing.pricing");
  const planName = plan
    ? planT(`plans.${plan.id}.name` as "plans.free.name")
    : null;

  const price = plan
    ? format.number(plan.price, {
        style: "currency",
        currency,
        maximumFractionDigits: Number.isInteger(plan.price) ? 0 : 2,
      })
    : null;

  return (
    <div className="flex min-w-0 flex-col">
      {/* 终端：暗面 + 等宽字体，给开发者看的可信度。 */}
      <div className="bg-footer text-footer-foreground ring-footer/40 rounded-xl p-4 ring-1 sm:mr-12">
        <div className="flex items-center gap-2">
          <span className="flex gap-1.5" aria-hidden>
            <span className="size-2.5 rounded-full bg-current/25" />
            <span className="size-2.5 rounded-full bg-current/25" />
            <span className="size-2.5 rounded-full bg-current/25" />
          </span>
          <span className="font-mono text-[0.6875rem] tracking-widest uppercase opacity-60">
            {t("terminalTitle")}
          </span>
        </div>
        <div className="mt-4 space-y-2.5 font-mono text-xs leading-relaxed">
          <p className="opacity-90">
            <span className="opacity-50">$ </span>
            {t("terminalCommand")}
          </p>
          {plan ? (
            <>
              <p className="text-success-text flex gap-2">
                <CheckIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {t("terminalReady")}
              </p>
              <p className="text-success-text flex gap-2">
                <CheckIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {format.number(plan.credits)} {t("terminalCredits")}
              </p>
            </>
          ) : null}
        </div>
      </div>

      {/* 结账台：压在终端右下角。展示配置里真实的高亮套餐，不是假数据。 */}
      <div className="bg-card sticker-lg relative z-20 mt-3 rounded-xl p-5 sm:-mt-8 sm:ml-12">
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-muted-foreground font-mono text-[0.6875rem] tracking-widest uppercase">
            {t("checkoutTitle")}
          </span>
          {plan && price && (
            <span
              data-numeric
              className="heading-display text-2xl leading-none"
            >
              {price}
            </span>
          )}
        </div>

        {planName && <p className="mt-2 font-medium">{planName}</p>}

        <dl className="mt-4 space-y-3 text-sm">
          <MockRow label={t("checkoutCustomer")}>
            {t("checkoutCustomerValue")}
          </MockRow>
          <MockRow label={t("checkoutCountry")}>
            {t("checkoutCountryValue")}
          </MockRow>
        </dl>

        <div className="border-border mt-4 flex items-baseline justify-between gap-4 border-t border-dashed pt-4">
          <span className="text-muted-foreground text-sm">
            {t("checkoutTotal")}
          </span>
          {price && (
            <span data-numeric className="font-semibold">
              {price}
            </span>
          )}
        </div>
      </div>

      {/* 到账提示：最后压一张上去，给拼贴收个尾。 */}
      <div className="bg-card sticker relative z-30 mt-3 flex items-start gap-3 rounded-xl p-3.5 sm:-mt-6 sm:mr-8 sm:ml-4">
        <span className="bg-success-band text-success mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg">
          <CheckIcon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium">{t("toastTitle")}</p>
          <p className="text-muted-foreground text-xs">{t("toastBody")}</p>
        </div>
      </div>
    </div>
  );
}

function MockRow({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4", className)}>
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="truncate font-medium">{children}</dd>
    </div>
  );
}
