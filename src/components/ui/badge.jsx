import { cva } from "class-variance-authority";
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from "lucide-react";

import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold",
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

function Badge({ className, variant, children, ...props }) {
  var Icon = null;
  if (variant === "success") Icon = CheckCircle2;
  else if (variant === "warning") Icon = AlertTriangle;
  else if (variant === "danger") Icon = AlertCircle;
  else if (variant === "info") Icon = Info;

  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

export { Badge, badgeVariants };
