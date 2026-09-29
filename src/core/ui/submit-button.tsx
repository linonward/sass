"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/core/ui/button";

/**
 * A submit button that disables itself and swaps its label while the form is
 * submitting.
 *
 * With `<form action={formAction}>` from `useActionState` it reads the pending
 * state from `useFormStatus`. Forms that submit through their own
 * `startTransition` (dialogs that close only on success) resolve the action
 * immediately, so `useFormStatus` never sees them pending — pass `pending` from
 * `useTransition` instead.
 */
function SubmitButton({
  pending,
  pendingLabel,
  children,
  disabled,
  ...props
}: Omit<React.ComponentProps<typeof Button>, "type"> & {
  pending?: boolean;
  pendingLabel?: React.ReactNode;
}) {
  const status = useFormStatus();
  const busy = pending ?? status.pending;
  return (
    <Button type="submit" disabled={busy || disabled} {...props}>
      {busy && pendingLabel ? pendingLabel : children}
    </Button>
  );
}

export { SubmitButton };
