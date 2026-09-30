import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";

// Sticker surface: 1px outline + zero-blur hard lip, both the same color (see .sticker in
// globals.css). These two constants must stay literal: Tailwind scans source text, so a name like
// `[--edge:var(--primary-edge)]` must appear verbatim in the source to be generated; classes built
// by concatenation are silently dropped.
const STICKER = "sticker border-[var(--edge)]";
/** On press the lip collapses and the button sinks, for a squashed feel. */
const STICKER_PRESS =
  "hover:[--tw-shadow:0_1px_0_0_var(--edge)] active:not-aria-[haspopup]:translate-y-[2px] active:[--tw-shadow:0_0_0_0_var(--edge)]";

const buttonVariantsRaw = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color,translate,box-shadow] duration-150 ease-out outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary-text underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
        // Large marketing button: 44px tall, a generous tap target that also holds its own next
        // to display type.
        marketing:
          "h-11 gap-2 px-5 text-base has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
      },
      // tone must be declared after variant: cva emits classes in the key order of variants, and
      // if tone came first, variant="outline"'s border-border would override tone's outline.
      // Without tone, the rendered output is byte-for-byte what it was before tone existed.
      tone: {
        primary: `${STICKER} [--edge:var(--primary-edge)] ${STICKER_PRESS}`,
        success: `${STICKER} [--edge:var(--success-edge)] ${STICKER_PRESS}`,
        warning: `${STICKER} [--edge:var(--warning-edge)] ${STICKER_PRESS}`,
        info: `${STICKER} [--edge:var(--info-edge)] ${STICKER_PRESS}`,
        destructive: `${STICKER} [--edge:var(--destructive-edge)] ${STICKER_PRESS}`,
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

/**
 * Button classes for non-button elements (links styled as buttons).
 *
 * Returned already merged: the base sets `border-transparent` and variants such
 * as `outline` add `border-border` at the same specificity, so an unmerged string
 * lets whichever rule Tailwind emits last win — in light mode the outline border
 * came out transparent wherever `buttonVariants()` went straight into `className`.
 */
function buttonVariants(
  props?: Parameters<typeof buttonVariantsRaw>[0],
): string {
  return cn(buttonVariantsRaw(props));
}

function Button({
  className,
  variant = "default",
  size = "default",
  tone,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariantsRaw>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={buttonVariants({ variant, size, tone, className })}
      {...props}
    />
  );
}

export { Button, buttonVariants };
