import * as React from "react";

import { cn } from "../../lib/utils";

const Textarea = React.forwardRef(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      className={cn(
        "flex min-h-[108px] w-full rounded-md border border-[rgb(var(--border))] bg-white px-3 py-2 text-base text-[rgb(var(--foreground))] shadow-sm transition-colors placeholder:text-[rgb(var(--muted))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--accent))] focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      ref={ref}
      {...props}
    />
  );
});

export { Textarea };
