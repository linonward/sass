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

/**
 * Actions available per exception kind: first the one specific to that kind, then the two closing
 * actions.
 */
const actionsFor = {
  refund_reclaim_shortfall: ["retry_reclaim", "resolve", "ignore"],
  ai_job_needs_review: ["recheck", "resolve", "ignore"],
  notification_failed: ["resend", "resolve", "ignore"],
} as const satisfies Record<BillingExceptionKind, readonly string[]>;

/**
 * Dialog for handling one exception: enter a reason (required) and pick an action.
 *
 * The result stays in the dialog for the admin to read (a retry that still fell short, or the
 * provider status a reconcile got back, must be visible); the list is shown again after closing.
 * Submission is handled by hand (startTransition + setState), as in src/core/api-keys/dialogs.tsx.
 * All buttons are disabled while submitting; even if someone gets around that and double-clicks,
 * the server handles it only once (lock + only open exceptions are handled).
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
        // Refresh the list and sidebar count only if an action ran: the result stays in the dialog
        // first, and the fresh list replaces it after closing.
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
          {/* No separate "Cancel": the close button in the top-right corner is it; two buttons with
              the same name would only confuse screen readers and e2e alike. */}
          <DialogFooter className="flex-wrap">
            {actionsFor[kind].map((action, index) => (
              <Button
                key={action}
                type="submit"
                name="action"
                value={action}
                // One solid primary action per screen: the action specific to this kind; the
                // closing actions are secondary.
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
