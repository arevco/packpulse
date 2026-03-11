import * as React from "react";
import { CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";

import { cn } from "../../lib/utils";
import { Button } from "./button";

var MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parseMonthKey(value) {
  var raw = String(value || "").trim();
  var match = raw.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  var year = Number(match[1]);
  var month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
  return { year: year, month: month };
}

function formatMonthKey(year, month) {
  return String(year) + "-" + String(month).padStart(2, "0");
}

function displayMonthKey(value) {
  var parsed = parseMonthKey(value);
  if (!parsed) return "";
  return MONTH_LABELS[parsed.month - 1] + " " + parsed.year;
}

function currentMonthParts() {
  var now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function MonthPicker({ value, onChange, placeholder = "Pick month", className, align = "start" }) {
  var selected = parseMonthKey(value);
  var today = currentMonthParts();
  var [open, setOpen] = React.useState(false);
  var [viewYear, setViewYear] = React.useState(selected ? selected.year : today.year);

  React.useEffect(function() {
    if (open) {
      setViewYear(selected ? selected.year : today.year);
    }
  }, [open, selected ? selected.year : null, today.year]);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn("h-10 w-[150px] justify-between text-left font-normal", !selected && "text-[rgb(var(--muted))]", className)}
        >
          {selected ? displayMonthKey(value) : placeholder}
          <CalendarIcon className="h-4 w-4 opacity-70" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={6}
          align={align}
          className="z-50 w-[248px] overflow-hidden rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-3 shadow-md"
        >
          <div className="mb-3 flex items-center justify-between">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={function() { setViewYear(function(prev) { return prev - 1; }); }}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="text-sm font-medium">{viewYear}</div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={function() { setViewYear(function(prev) { return prev + 1; }); }}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {MONTH_LABELS.map(function(label, idx) {
              var month = idx + 1;
              var active = !!selected && selected.year === viewYear && selected.month === month;
              return (
                <Button
                  key={label}
                  type="button"
                  variant={active ? "active" : "ghost"}
                  className="h-9 justify-center px-2"
                  onClick={function() {
                    onChange(formatMonthKey(viewYear, month));
                    setOpen(false);
                  }}
                >
                  {label}
                </Button>
              );
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

MonthPicker.displayName = "MonthPicker";

export { MonthPicker };
