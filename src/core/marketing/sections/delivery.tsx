import { ArrowUpRightIcon, CheckIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { PlanButton } from "@/core/billing/ui/plan-button";
import type { Plan } from "@/core/config/schema";

import { Link } from "@/core/i18n/navigation";
import { bands, type Band } from "./band";
import { formatPrice } from "./price";
import { Section } from "./section";

/**
 * The "delivery" section: the purchase card on the left (the plan `landing.purchasePlan` points to)
 * and the list of deliverables (`landing.deliverables`) on the right. When no purchase plan is configured or the plan is
 * hidden, the card shows "coming soon" with no buy button.
 */
export function Delivery({
  items,
  demo,
  waveFrom,
  plan,
  currency,
}: {
  /** `landing.deliverables`: message keys of the list on the right. */
  items: string[];
  /** `landing.demo`: show the "try the demo first" link under the card. */
  demo: boolean;
  waveFrom?: Band;
  plan?: Plan;
  currency: string;
}) {
  const t = useTranslations("Landing.delivery");
  const tp = useTranslations("Landing.pricing");
  const format = useFormatter();
  return (
    <Section id="delivery" band={bands.delivery} waveFrom={waveFrom}>
      <div className="grid gap-12 lg:grid-cols-2 lg:gap-20">
        <div>
          <h2 className="landing-section-title max-w-[14ch]">{t("title")}</h2>
          <p className="text-muted-foreground mt-5 max-w-[35ch] text-lg leading-relaxed">
            {t("description")}
          </p>
          {plan ? (
            <div
              className="bg-card sticker mt-8 rounded-xl border-[var(--primary-edge)] p-6 [--edge:var(--primary-edge)]"
              data-testid="delivery-offer"
            >
              <p className="text-sm font-medium">{t("offer")}</p>
              <p className="mt-4 flex items-baseline gap-1.5">
                <span
                  data-numeric
                  className="heading-display text-4xl leading-none"
                >
                  {formatPrice(format, plan.price, currency)}
                </span>
                <span className="text-muted-foreground text-sm">
                  {tp(`interval.${plan.interval}`)}
                </span>
              </p>
              <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
                {t("terms")}
              </p>
              <PlanButton
                planId={plan.id}
                label={t("buy")}
                free={false}
                highlighted
              />
            </div>
          ) : (
            <div className="bg-warning-band border-warning-edge mt-8 rounded-lg border p-6">
              <p className="text-sm font-medium">{t("offer")}</p>
              <p className="heading-display mt-4 text-4xl">{t("pending")}</p>
              <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
                {t("termsPending")}
              </p>
            </div>
          )}
          {demo && (
            <Link
              href="/demo"
              className="text-primary-text mt-6 inline-flex min-h-11 items-center gap-2 border-b text-base font-semibold"
            >
              {t("demo")}
              <ArrowUpRightIcon className="size-4" aria-hidden />
            </Link>
          )}
        </div>
        <dl className="divide-border border-border divide-y border-t">
          {items.map((key) => (
            <div key={key} className="flex gap-5 py-7">
              <CheckIcon
                className="text-primary-text bg-primary-band mt-1 size-8 shrink-0 rounded-full p-1.5"
                aria-hidden
              />
              <div>
                <dt className="text-xl font-semibold">
                  {t(`items.${key}.title` as "items.credits.title")}
                </dt>
                <dd className="text-muted-foreground mt-2 leading-relaxed">
                  {t(`items.${key}.description` as "items.credits.description")}
                </dd>
              </div>
            </div>
          ))}
        </dl>
      </div>
    </Section>
  );
}
