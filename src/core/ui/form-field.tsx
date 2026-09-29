"use client";

import * as React from "react";
import { Field as FieldPrimitive } from "@base-ui/react/field";
import { cn } from "cn";

import { Label, labelClassName } from "@/core/ui/label";

/**
 * A labelled form field: label, control, optional description and error.
 *
 * Built on Base UI's Field, which wires the relationships for Base UI controls
 * (`Input`, `Select`, `Checkbox`, `Switch`, `Textarea`): the label names the
 * control, the description and error land in its `aria-describedby`, and
 * `error` sets `aria-invalid`. Callers never pass ids by hand.
 *
 * Validation stays in server actions; pass the message you got back as `error`.
 *
 * `labelFor="button"` is for controls that render a `<button>` (Select): the
 * label becomes plain text linked by `aria-labelledby`, so clicking it doesn't
 * open the popup and hovering it doesn't style the trigger.
 */
function FormField({
  label,
  description,
  error,
  labelFor = "input",
  className,
  children,
  ...props
}: Omit<FieldPrimitive.Root.Props, "invalid"> & {
  label: React.ReactNode;
  description?: React.ReactNode;
  error?: React.ReactNode;
  labelFor?: "input" | "button";
}) {
  const invalid = Boolean(error);
  return (
    <FieldPrimitive.Root
      data-slot="form-field"
      invalid={invalid}
      className={cn("flex flex-col gap-1.5", className)}
      {...props}
    >
      <FieldPrimitive.Label
        nativeLabel={labelFor === "input"}
        render={
          labelFor === "input" ? (
            <Label />
          ) : (
            <div data-slot="label" className={labelClassName} />
          )
        }
      >
        {label}
      </FieldPrimitive.Label>
      {children}
      {description && (
        <FieldPrimitive.Description className="text-muted-foreground text-xs">
          {description}
        </FieldPrimitive.Description>
      )}
      <FieldPrimitive.Error
        match={invalid}
        className="text-destructive text-sm"
      >
        {error}
      </FieldPrimitive.Error>
    </FieldPrimitive.Root>
  );
}

export { FormField };
