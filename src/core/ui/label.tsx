"use client";

import * as React from "react";
import { cn } from "cn";

/** Shared with FormField, which renders a non-`<label>` label for button controls. */
const labelClassName =
  "flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50";

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(labelClassName, className)}
      {...props}
    />
  );
}

export { Label, labelClassName };
