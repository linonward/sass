import * as React from "react";
import { cn } from "cn";

/**
 * The result line under a form: an error (`role="alert"`, announced right away)
 * or a success note (`role="status"`). Renders nothing when neither is given, so
 * callers pass whatever their action state resolves to:
 *
 *   <FormMessage
 *     error={state.status === "error" ? t(state.error) : undefined}
 *     success={state.status === "success" ? t("saved") : undefined}
 *   />
 *
 * An error wins if both are set.
 */
function FormMessage({
  error,
  success,
  className,
}: {
  error?: React.ReactNode;
  success?: React.ReactNode;
  className?: string;
}) {
  if (error) {
    return (
      <p
        role="alert"
        data-slot="form-message"
        className={cn("text-destructive text-sm", className)}
      >
        {error}
      </p>
    );
  }
  if (success) {
    return (
      <p
        role="status"
        data-slot="form-message"
        className={cn("text-muted-foreground text-sm", className)}
      >
        {success}
      </p>
    );
  }
  return null;
}

export { FormMessage };
