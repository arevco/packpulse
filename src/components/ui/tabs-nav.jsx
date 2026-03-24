import { Button } from "./button";
import { cn } from "../../lib/utils";

export default function TabsNav({ items, activeKey, onChange, className }) {
  var handleNavClick = function(event, itemKey) {
    if (!onChange) return;
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.altKey ||
      event.ctrlKey ||
      event.shiftKey
    ) {
      return;
    }
    event.preventDefault();
    onChange(itemKey);
  };

  return (
    <nav
      aria-label="Primary dashboard views"
      className={cn("mb-4 flex flex-nowrap gap-1 overflow-x-auto border-b border-[rgb(var(--border))] pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", className)}
    >
      {items.map(function(item) {
        var isActive = activeKey === item.key;
        return (
          <Button
            key={item.key}
            asChild
            variant="ghost"
            className={cn(
              "h-auto shrink-0 -mb-px rounded-none border-x-0 border-t-0 border-b-2 px-3 py-2.5 text-sm sm:px-5",
              isActive
                ? "border-b-[rgb(var(--accent))] text-[rgb(var(--foreground))]"
                : "border-b-transparent text-[rgb(var(--muted))]"
            )}
          >
            <a
              href={item.href || "#"}
              aria-current={isActive ? "page" : undefined}
              onClick={function(event) { handleNavClick(event, item.key); }}
            >
              {item.label}
              {item.count != null ? (
                <span className={cn("ml-1 text-xs opacity-70", item.alert ? "text-[rgb(var(--danger))] opacity-100" : "")}>{item.alert ? "⚠ " : ""}{item.count}</span>
              ) : null}
            </a>
          </Button>
        );
      })}
    </nav>
  );
}
