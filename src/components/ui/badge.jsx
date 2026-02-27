import { cva } from "class-variance-authority";

import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold",
  {
    variants: {
      variant: {
        default: "border-[rgb(var(--border))] bg-[rgb(var(--surface))] text-[rgb(var(--foreground))]",
        secondary: "border-[rgb(var(--border))] text-[rgb(var(--muted))]",
        success: "border-transparent bg-[color-mix(in_oklab,rgb(var(--success))_15%,white)] text-[rgb(var(--success))]",
        warning: "border-transparent bg-[color-mix(in_oklab,rgb(var(--warning))_18%,white)] text-[rgb(var(--warning))]",
        danger: "border-transparent bg-[color-mix(in_oklab,rgb(var(--danger))_12%,white)] text-[rgb(var(--danger))]",
        info: "border-transparent bg-[color-mix(in_oklab,rgb(var(--accent))_12%,white)] text-[rgb(var(--accent))]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

function Badge({ className, variant, ...props }) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
