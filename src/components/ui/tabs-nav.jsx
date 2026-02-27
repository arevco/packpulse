import { Button } from "./button";
import { cn } from "../../lib/utils";

export default function TabsNav({ items, activeKey, onChange, className }) {
  return (
    <div
      role="tablist"
      aria-label="Primary dashboard views"
      className={cn("mb-4 flex flex-nowrap gap-1 overflow-x-auto border-b border-[rgb(var(--border))]", className)}
    >
      {items.map(function(item) {
        var isActive = activeKey === item.key;
        return (
          <Button
            key={item.key}
            variant="ghost"
            role="tab"
            aria-selected={isActive}
            aria-controls={"view-" + item.key}
            id={"tab-" + item.key}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(item.key)}
            className={cn(
              "h-auto shrink-0 -mb-px rounded-none border-x-0 border-t-0 border-b-2 px-5 py-2.5 text-sm",
              isActive
                ? "border-b-[rgb(var(--accent))] text-[rgb(var(--foreground))]"
                : "border-b-transparent text-[rgb(var(--muted))]"
            )}
          >
            {item.label}
            {item.count != null ? (
              <span className={cn("ml-1 text-xs opacity-70", item.alert ? "text-[rgb(var(--danger))] opacity-100" : "")}>{item.alert ? "⚠ " : ""}{item.count}</span>
            ) : null}
          </Button>
        );
      })}
    </div>
  );
}
