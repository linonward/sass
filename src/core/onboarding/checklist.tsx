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

/** 能直接打开看结果的那几步，给一个链接。改配置的两步没有对应的页面，只有文件路径。 */
const stepLinks: Partial<
  Record<OnboardingStepId, { href: string; external?: boolean }>
> = {
  pricing: { href: "/#pricing" },
  blogPost: { href: "/blog" },
  deploy: { href: "https://vercel.com/new", external: true },
};

const idle: CompleteState = { status: "idle" };

/** 步骤前的圆片：产品面，1px 描边、零唇边，和对勾同色。 */
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
 * 首次运行清单。每一步的判定在服务端算好（steps.ts），这里只负责呈现：
 * 自动判定为完成的打勾，判定不了的给一个手动勾选，全部看完点一次「标记完成」。
 *
 * 手动勾选不落库：持久化的只有用户记录上的那一个布尔值（见 actions.ts）。
 */
export function OnboardingChecklist({
  locale,
  steps,
  donePath,
  completed,
}: {
  locale: string;
  steps: OnboardingStep[];
  /** 标记完成之后去哪（含语言前缀）。 */
  donePath: string;
  /** 用户记录上是否已经标记过完成：已完成时不再显示按钮。 */
  completed: boolean;
}) {
  const t = useTranslations("Onboarding");
  const [state, action, pending] = useActionState(
    completeOnboarding.bind(null, locale),
    idle,
  );
  const [ticked, setTicked] = useState<readonly OnboardingStepId[]>([]);

  // 标记成功后整页跳转：服务端重新读一次用户记录，别的地方（登录后的落点）才跟着变。
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
                  {/* 这两个是链接不是按钮，用 buttonVariants 套样式、不走 Base UI 的
                      Button：它的 nativeButton 默认 true，render 成 <a> 会在 dev
                      控制台报警；声明 nativeButton={false} 能消警，但会往 <a> 上盖
                      role="button"，把「点了会跳转」从无障碍树里抹掉。 */}
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
