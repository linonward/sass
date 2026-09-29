import * as React from "react";
import { cn } from "cn";

/**
 * tone decides which register the surface belongs to: pass it and you get a marketing sticker
 * (outline + hard lip); omit it and you get a flat product/admin surface (`panel`, 1px outline
 * only).
 *
 * Class names must stay literal: Tailwind scans source text, so concatenated classes get dropped.
 * `panel`'s own background and radius match the `bg-card rounded-xl` in base; the duplication is
 * harmless — its purpose is to make "this is a product-register panel" greppable in the source.
 */
const cardTones = {
  primary: "sticker-lg border-[var(--edge)] [--edge:var(--primary-edge)]",
  success: "sticker-lg border-[var(--edge)] [--edge:var(--success-edge)]",
  warning: "sticker-lg border-[var(--edge)] [--edge:var(--warning-edge)]",
  info: "sticker-lg border-[var(--edge)] [--edge:var(--info-edge)]",
  destructive:
    "sticker-lg border-[var(--edge)] [--edge:var(--destructive-edge)]",
} as const;

export type CardTone = keyof typeof cardTones;

function Card({
  className,
  size = "default",
  tone,
  ...props
}: React.ComponentProps<"div"> & {
  size?: "default" | "sm";
  tone?: CardTone;
}) {
  return (
    <div
      data-slot="card"
      data-size={size}
      data-tone={tone}
      className={cn(
        "group/card bg-card text-card-foreground flex flex-col gap-(--card-spacing) overflow-hidden rounded-xl py-(--card-spacing) text-sm [--card-spacing:--spacing(4)] has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:--spacing(3)] data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl",
        tone ? cardTones[tone] : "panel",
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-xl px-(--card-spacing) has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-(--card-spacing)",
        className,
      )}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        "font-heading text-base leading-snug font-medium group-data-[size=sm]/card:text-sm",
        className,
      )}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  );
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className,
      )}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-(--card-spacing)", className)}
      {...props}
    />
  );
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "bg-muted/50 flex items-center rounded-b-xl border-t p-(--card-spacing)",
        className,
      )}
      {...props}
    />
  );
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
};
