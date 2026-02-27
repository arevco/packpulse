import { Button } from "./button";
import { cn } from "../../lib/utils";

export default function TabsNav({ items, activeKey, onChange, className }) {
  return (
    <div className={cn("mb-4 flex flex-wrap gap-1 border-b border-[rgb(var(--border))]", className)}>
      {items.map(function(item) {
        return (
          <Button
            key={item.key}
            variant="ghost"
            size="sm"
            onClick={() => onChange(item.key)}
            className={cn(
              "-mb-px rounded-none border-b-2 px-4 py-2 text-sm",
              activeKey === item.key
                ? "border-[rgb(var(--accent))] text-[rgb(var(--foreground))]"
                : "border-transparent text-[rgb(var(--muted))]"
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
