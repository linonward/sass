import { ArrowRightIcon, ArrowUpRightIcon } from "lucide-react";

import { Link } from "@/core/i18n/navigation";

/**
 * Button logic shared by the hero and the closing section: with a purchasable plan, the primary
 * button is "Buy now · price" (jumping to the delivery section's purchase card so terms are read
 * before checkout); otherwise it falls back to the in-site demo. The secondary button prefers the
 * real showcase site.
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
  /** Formatted price of the purchase card's plan; undefined when no plan is purchasable. */
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
