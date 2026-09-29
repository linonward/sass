"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import type { BillingExceptionKind } from "@/core/db/schema";
import { Button } from "@/core/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/core/ui/dialog";
import { Label } from "@/core/ui/label";
import { Textarea } from "@/core/ui/textarea";

import { exceptionAction, type ExceptionActionState } from "../actions";

const idle: ExceptionActionState = { status: "idle" };

/** 每种单子能做的动作：先是这类单子专属的那个，再是两个关单动作。 */
const actionsFor = {
  refund_reclaim_shortfall: ["retry_reclaim", "resolve", "ignore"],
  ai_job_needs_review: ["recheck", "resolve", "ignore"],
  notification_failed: ["resend", "resolve", "ignore"],
} as const satisfies Record<BillingExceptionKind, readonly string[]>;

/**
 * 处理一张异常单的弹层：填理由（必填），选一个动作。
 *
 * 结果留在弹层里给人看（重试没扣够、核对拿到的服务商状态都要看得见），关掉再看列表。
 * 提交自己接（startTransition + setState），同 src/core/api-keys/dialogs.tsx。
 * 提交中所有按钮禁用；即便绕过去连点，服务端也只处理一次（锁 + 只处理 open 的单）。
 */
export function HandleExceptionDialog({
  exceptionId,
  kind,
}: {
  exceptionId: string;
  kind: BillingExceptionKind;
}) {
  const t = useTranslations("Admin.exceptions");
  const tc = useTranslations("Common");
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ExceptionActionState>(idle);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const reasonId = `exception-reason-${exceptionId}`;

  function submit(form: FormData) {
    startTransition(async () => {
      setState(await exceptionAction(idle, form));
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) return;
        // 做过动作才刷新列表和侧边栏计数：结果先留在弹层里给人看，关掉再换成新的列表。
        if (state.status === "success") router.refresh();
        setState(idle);
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" data-testid="exception-handle" />
        }
      >
        {t("dialog.open")}
      </DialogTrigger>
      <DialogContent closeLabel={tc("close")}>
        <form action={submit} className="flex flex-col gap-4">
          <input type="hidden" name="exceptionId" value={exceptionId} />
          <DialogHeader>
            <DialogTitle>{t("dialog.title")}</DialogTitle>
            <DialogDescription>{t("dialog.description")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor={reasonId}>{t("dialog.reasonLabel")}</Label>
            <Textarea
              id={reasonId}
              name="reason"
              required
              maxLength={500}
              placeholder={t("dialog.reasonPlaceholder")}
            />
          </div>
          {state.status === "error" && (
            <p role="alert" className="text-destructive text-sm">
              {t(`errors.${state.error}`)}
            </p>
          )}
          {state.status === "success" && (
            <p
              role="status"
              className="text-muted-foreground text-sm break-words"
              data-testid="exception-result"
            >
              {t(state.closed ? "dialog.doneClosed" : "dialog.done", {
                result: state.result,
              })}
            </p>
          )}
          {/* 不另放「取消」：右上角的关闭按钮就是它，两个同名按钮只会让读屏和 e2e 都分不清。 */}
          <DialogFooter className="flex-wrap">
            {actionsFor[kind].map((action, index) => (
              <Button
                key={action}
                type="submit"
                name="action"
                value={action}
                // 每屏一个实心主操作：这类单子专属的动作；关单动作是次要的。
                variant={index === 0 ? "default" : "outline"}
                disabled={pending}
                data-testid={`exception-action-${action}`}
              >
                {pending && index === 0
                  ? t("dialog.working")
                  : t(`actions.${action}`)}
              </Button>
            ))}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
