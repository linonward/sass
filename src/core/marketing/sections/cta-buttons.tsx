import { ArrowRightIcon, ArrowUpRightIcon } from "lucide-react";

import { Link } from "@/core/i18n/navigation";

/**
 * 首屏和结尾共用的按钮取向：有可买的套餐时，主按钮是「立即购买 · 价格」（跳到交付区块的
 * 购买卡片，先看条款再结账）；没有时退回站内演示。次按钮优先指向真实案例站点。
 */
export type CtaTarget =
  | { kind: "buy"; label: string }
  | { kind: "demo"; label: string }
  | { kind: "delivery"; label: string }
  | { kind: "showcase"; label: string; href: string };

export function ctaTargets({
  price,
  showcaseUrl,
  labels,
}: {
  /** 购买卡片套餐的格式化标价；没有可买的套餐时为 undefined。 */
  price?: string;
  showcaseUrl?: string;
  labels: { buy: string; demo: string; delivery: string; showcase: string };
}): { primary: CtaTarget; secondary: CtaTarget } {
  const showcase: CtaTarget | undefined = showcaseUrl
    ? { kind: "showcase", label: labels.showcase, href: showcaseUrl }
    : undefined;
  if (price !== undefined) {
    return {
      primary: { kind: "buy", label: labels.buy },
      secondary: showcase ?? { kind: "demo", label: labels.demo },
    };
  }
  return {
    primary: { kind: "demo", label: labels.demo },
    secondary: showcase ?? { kind: "delivery", label: labels.delivery },
  };
}

export function CtaLink({
  target,
  className,
  iconClassName,
}: {
  target: CtaTarget;
  className: string;
  iconClassName?: string;
}) {
  if (target.kind === "showcase") {
    return (
      <a
        href={target.href}
        target="_blank"
        rel="noopener"
        className={className}
      >
        {target.label}
        <ArrowUpRightIcon className={iconClassName} aria-hidden />
      </a>
    );
  }
  const href = target.kind === "demo" ? "/demo" : "/#delivery";
  const Icon = target.kind === "demo" ? ArrowUpRightIcon : ArrowRightIcon;
  return (
    <Link href={href} className={className}>
      {target.label}
      <Icon className={iconClassName} aria-hidden />
    </Link>
  );
}
