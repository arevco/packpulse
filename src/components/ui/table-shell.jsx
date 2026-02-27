import { cn } from "../../lib/utils";

export default function TableShell({ className, children }) {
  return (
    <div className={cn("overflow-hidden rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--surface))]", className)}>
      {children}
    </div>
  );
}
