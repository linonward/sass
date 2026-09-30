import { ArrowRightIcon, ArrowUpRightIcon } from "lucide-react";

import type { LandingConfig } from "@/core/config/schema";
import { Link } from "@/core/i18n/navigation";

/**
 * Button logic shared by the hero and the closing section.
 *
 * - With a purchasable plan, the primary button is "Buy now · price" (jumping to the delivery
 *   section's purchase card so terms are read before checkout).
 * - Otherwise it is the in-site demo when `landing.demo` is on, or "get started" (sign-in) on a
 *   product site.
 * - The secondary button prefers the real showcase site, then the demo / purchase card, then
 *   pricing.
 */
export type CtaTarget =
  | { kind: "buy"; label: string }
  | { kind: "demo"; label: string }
  | { kind: "delivery"; label: string }
  | { kind: "start"; label: string }
  | { kind: "pricing"; label: string; href: string }
  | { kind: "showcase"; label: string; href: string };

export type CtaLabels = Record<
  "buy" | "demo" | "delivery" | "start" | "pricing" | "showcase",
  string
>;

export function ctaTargets({
  price,
  showcaseUrl,
  demo = false,
  sections = [],
  labels,
}: {
  /** Formatted price of the purchase card's plan; undefined when no plan is purchasable. */
  price?: string;
  showcaseUrl?: string;
  /** `landing.demo`: whether the site points visitors at /demo. */
  demo?: boolean;
  /** `landing.sections`, so buttons only jump to sections that are on the page. */
  sections?: LandingConfig["sections"];
  labels: CtaLabels;
}): { primary: CtaTarget; secondary: CtaTarget } {
  const showcase: CtaTarget | undefined = showcaseUrl
    ? { kind: "showcase", label: labels.showcase, href: showcaseUrl }
    : undefined;
  const pricing: CtaTarget = {
    kind: "pricing",
    label: labels.pricing,
    href: sections.includes("pricing") ? "/#pricing" : "/pricing",
  };
  if (price !== undefined) {
    return {
      primary: { kind: "buy", label: labels.buy },
      secondary:
        showcase ?? (demo ? { kind: "demo", label: labels.demo } : pricing),
    };
  }
  return {
    primary: demo
      ? { kind: "demo", label: labels.demo }
      : { kind: "start", label: labels.start },
    secondary:
      showcase ??
      (sections.includes("delivery")
        ? { kind: "delivery", label: labels.delivery }
        : pricing),
  };
}

const internalHref = {
  buy: "/#delivery",
  delivery: "/#delivery",
  demo: "/demo",
  start: "/sign-in",
} as const;

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
  const href =
    target.kind === "pricing" ? target.href : internalHref[target.kind];
  const Icon = target.kind === "demo" ? ArrowUpRightIcon : ArrowRightIcon;
  return (
    <Link href={href} className={className}>
      {target.label}
      <Icon className={iconClassName} aria-hidden />
    </Link>
  );
}
