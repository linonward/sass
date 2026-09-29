"use client";

import * as React from "react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/core/ui/alert-dialog";
import { FormField } from "@/core/ui/form-field";
import { FormMessage } from "@/core/ui/form-message";
import { Input } from "@/core/ui/input";
import { SubmitButton } from "@/core/ui/submit-button";

/** What a confirm action resolves to. `idle` is the state before the first try. */
export type ConfirmActionResult<E extends string = string> =
  { status: "idle" } | { status: "success" } | { status: "error"; error: E };

const idle = { status: "idle" } as const;

/** Trimmed, case-insensitive: the typed text only has to name the right thing. */
export function confirmTextMatches(typed: string, expected: string) {
  return typed.trim().toLowerCase() === expected.trim().toLowerCase();
}

/**
 * Asks before doing something, then runs it.
 *
 * - Success closes the dialog, then calls `onSuccess`.
 * - An error keeps the dialog open with the message and whatever was typed,
 *   so the user can see what went wrong and try again.
 * - Closing (Cancel, Esc) resets it: reopening starts clean.
 * - `confirmText` adds a field that must match before the button enables
 *   (the server should check it again — this only prevents slips).
 *
 * It submits through `onSubmit`, not `<form action={fn}>`: React resets the
 * form's fields after a function action, which would wipe the typed text on a
 * failed attempt. Closing happens in the submit handler once the result is in,
 * never from an effect watching state.
 *
 * `fields` become hidden inputs, so the action receives the ids it acts on in
 * the same `FormData` as the typed confirmation (sent as `confirm`).
 */
export function ConfirmActionDialog<E extends string>({
  trigger,
  title,
  description,
  confirmLabel,
  pendingLabel,
  cancelLabel,
  tone = "default",
  confirmText,
  fields,
  action,
  errorMessage,
  onSuccess,
  confirmTestId,
}: {
  /** The button that opens the dialog, with its label. */
  trigger: React.ReactElement;
  title: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel: React.ReactNode;
  pendingLabel?: React.ReactNode;
  cancelLabel: React.ReactNode;
  /** `destructive` for actions that delete or can't be undone. */
  tone?: "default" | "destructive";
  confirmText?: {
    label: React.ReactNode;
    expected: string;
    inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  };
  fields?: Record<string, string>;
  action: (form: FormData) => Promise<ConfirmActionResult<E>>;
  errorMessage: (error: E) => React.ReactNode;
  onSuccess?: () => void;
  confirmTestId?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [result, setResult] = React.useState<ConfirmActionResult<E>>(idle);
  const [typed, setTyped] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  const confirmed =
    !confirmText || confirmTextMatches(typed, confirmText.expected);

  function reset() {
    setResult(idle);
    setTyped("");
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirmed) return;
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      const next = await action(form);
      if (next.status === "success") {
        setOpen(false);
        reset();
        onSuccess?.();
        return;
      }
      setResult(next);
    });
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <AlertDialogTrigger render={trigger} />
      <AlertDialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          {Object.entries(fields ?? {}).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            {description && (
              <AlertDialogDescription>{description}</AlertDialogDescription>
            )}
          </AlertDialogHeader>
          {confirmText && (
            <FormField
              label={confirmText.label}
              labelClassName="block leading-relaxed"
            >
              <Input
                name="confirm"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                inputMode={confirmText.inputMode}
              />
            </FormField>
          )}
          <FormMessage
            error={
              result.status === "error" ? errorMessage(result.error) : undefined
            }
          />
          <AlertDialogFooter>
            <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
            <SubmitButton
              variant={tone === "destructive" ? "destructive" : "default"}
              pending={pending}
              pendingLabel={pendingLabel}
              disabled={!confirmed}
              data-testid={confirmTestId}
            >
              {confirmLabel}
            </SubmitButton>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
