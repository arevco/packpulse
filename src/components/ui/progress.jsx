import { Progress as BaseProgress } from "@base-ui/react/progress";

import { cn } from "../../lib/utils";

function Progress({ className, value = 0, label = "Progress" }) {
  const safeValue = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  return (
    <BaseProgress.Root value={safeValue} aria-label={label} className={cn("w-full", className)}>
      <BaseProgress.Track className="h-1.5 w-full overflow-hidden rounded-full border border-[rgb(var(--border))] bg-[rgb(var(--surface))]">
        <BaseProgress.Indicator
          className="h-full bg-[rgb(var(--accent))] transition-[width] duration-300"
          style={{ width: safeValue + "%" }}
        />
      </BaseProgress.Track>
    </BaseProgress.Root>
  );
}

export { Progress };
