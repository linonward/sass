"use client";

import { ArrowUpRightIcon, CheckIcon, CircleIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState, useEffect, useState } from "react";

import { Link } from "@/core/i18n/navigation";
import { cn } from "@/core/lib/utils";
import { Badge } from "@/core/ui/badge";
import { Button, buttonVariants } from "@/core/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";

import { completeOnboarding, type CompleteState } from "./actions";
import type { OnboardingStep, OnboardingStepId } from "./steps";

/**
 * Steps whose result can be opened directly get a link. The two config-editing steps have no
 * matching page, only a file path.
 */
const stepLinks: Partial<
  Record<OnboardingStepId, { href: string; external?: boolean }>
> = {
  pricing: { href: "/#pricing" },
  blogPost: { href: "/blog" },
  deploy: { href: "https://vercel.com/new", external: true },
};

const idle: CompleteState = { status: "idle" };

/** The disc before each step: product surface, 1px outline, no lip, same color as the check. */
function StepMark({ done }: { done: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg border [&_svg]:size-3.5",
        done
          ? "bg-success-band text-success border-[var(--success-edge)]"
          : "bg-muted text-muted-foreground border-border",
      )}
    >
      {done ? <CheckIcon /> : <CircleIcon />}
    </span>
  );
}

/**
 * First-run checklist. Each step's status is computed on the server (steps.ts); this component
 * only presents it: detected-as-done steps get a check, steps that can't be detected get a manual
 * checkbox, and once everything has been reviewed the user clicks "Mark as done" once.
 *
 * Manual checks are not persisted: the only stored state is the one boolean on the user record
 * (see actions.ts).
 */
export function OnboardingChecklist({
  locale,
  steps,
  donePath,
  completed,
}: {
  locale: string;
  steps: OnboardingStep[];
  /** Where to go after marking done (with the locale prefix). */
  donePath: string;
  /** Whether the user record is already marked done; if so, the button is hidden. */
  completed: boolean;
}) {
  const t = useTranslations("Onboarding");
  const [state, action, pending] = useActionState(
    completeOnboarding.bind(null, locale),
    idle,
  );
  const [ticked, setTicked] = useState<readonly OnboardingStepId[]>([]);

  // After marking succeeds, do a full page navigation: the server re-reads the user record, which
  // is what makes other places (the post-sign-in landing) pick up the change.
  useEffect(() => {
    if (state.status === "success") window.location.assign(donePath);
  }, [state.status, donePath]);

  const isDone = (step: OnboardingStep) =>
    step.status === "done" || ticked.includes(step.id);
  const doneCount = steps.filter(isDone).length;

  function toggle(id: OnboardingStepId) {
    setTicked((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }

  return (
    <Card data-testid="onboarding-checklist">
      <CardHeader>
        <CardTitle>{t("checklist.title")}</CardTitle>
        <CardDescription data-testid="onboarding-progress">
          {t("progress", { done: doneCount, total: steps.length })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col gap-4">
          {steps.map((step) => {
            const done = isDone(step);
            const link = stepLinks[step.id];
            return (
              <li
                key={step.id}
                data-testid="onboarding-step"
                data-step={step.id}
                data-status={done ? "done" : step.status}
                className="flex gap-3"
              >
                <StepMark done={done} />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="font-medium">{t(`steps.${step.id}.title`)}</p>
                    {done && (
                      <Badge variant="success" flat>
                        {t("done")}
                      </Badge>
                    )}
                  </div>
                  <p className="text-muted-foreground text-sm text-pretty">
                    {t(`steps.${step.id}.description`)}
                  </p>
                  <p className="text-muted-foreground font-mono text-xs">
                    {t(`steps.${step.id}.target`)}
                  </p>
                  {step.evidence.length > 0 && (
                    <ul className="text-muted-foreground space-y-0.5 font-mono text-xs">
                      {step.evidence.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  )}
                  {step.status === "manual" && (
                    <label className="text-muted-foreground flex w-fit items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--primary)]"
                        checked={done}
                        onChange={() => toggle(step.id)}
                      />
                      {t("manual")}
                    </label>
                  )}
                  {/* These two are links, not buttons: styled with buttonVariants
                      instead of Base UI's Button. Its nativeButton defaults to true,
                      and rendering it as <a> triggers a dev console warning; setting
                      nativeButton={false} silences that but stamps role="button" on
                      the <a>, which erases "clicking navigates" from the
                      accessibility tree. */}
                  {link &&
                    (link.external ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noreferrer noopener"
                        className={cn(
                          buttonVariants({ variant: "link", size: "sm" }),
                          "h-auto px-0",
                        )}
                      >
                        {t("open")}
                        <ArrowUpRightIcon />
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className={cn(
                          buttonVariants({ variant: "link", size: "sm" }),
                          "h-auto px-0",
                        )}
                      >
                        {t("open")}
                        <ArrowUpRightIcon />
                      </Link>
                    ))}
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
      <CardFooter className="flex-wrap justify-between gap-3">
        <p className="text-muted-foreground text-sm text-pretty">
          {t("footer")}
        </p>
        {completed ? (
          <Badge variant="success" flat data-testid="onboarding-completed-at">
            {t("alreadyDone")}
          </Badge>
        ) : (
          <form action={action}>
            <Button
              type="submit"
              disabled={pending}
              data-testid="onboarding-complete"
            >
              {pending ? t("marking") : t("mark")}
            </Button>
          </form>
        )}
      </CardFooter>
    </Card>
  );
}
