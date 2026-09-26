import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary:
          "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        destructive:
          "bg-destructive/10 text-destructive focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20",
        outline:
          "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        ghost:
          "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary-text underline-offset-4 hover:underline",
        // 语义粉彩档。底色和文字色都取自同一族的 token，唇边由下面的 compoundVariants 补。
        // `band` 指品牌色那条带（token 叫 --primary-band），其余按语义命名。
        // `destructive-band` 的横线是不得已：`destructive` 已经被上面的半透明档占了，
        // 那个档有十几处错误提示在用，不能改名。
        band: "bg-primary-band text-primary-text border-[var(--edge)] [--edge:var(--primary-edge)]",
        success:
          "bg-success-band text-success border-[var(--edge)] [--edge:var(--success-edge)]",
        warning:
          "bg-warning-band text-warning border-[var(--edge)] [--edge:var(--warning-edge)]",
        info: "bg-info-band text-info border-[var(--edge)] [--edge:var(--info-edge)]",
        "destructive-band":
          "bg-destructive-band text-destructive border-[var(--edge)] [--edge:var(--destructive-edge)]",
      },
      // 语域，不是风格偏好：营销面的徽章是一张贴纸（描边 + 零模糊唇边），
      // 产品面/后台是平面，只有描边。默认 false，所以营销页一个字节都不用改。
      flat: {
        true: "",
        false: "",
      },
    },
    compoundVariants: [
      {
        variant: ["band", "success", "warning", "info", "destructive-band"],
        flat: false,
        class: "sticker",
      },
    ],
    defaultVariants: {
      variant: "default",
      flat: false,
    },
  },
);

function Badge({
  className,
  variant = "default",
  flat = false,
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant, flat }), className),
      },
      props,
    ),
    render,
    state: {
      slot: "badge",
      variant,
      flat,
    },
  });
}

export { Badge, badgeVariants };
