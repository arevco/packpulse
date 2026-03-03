import * as React from "react";
import { format, parseISO } from "date-fns";
import { CalendarIcon } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";

import { cn } from "../../lib/utils";
import { Button } from "./button";
import { Calendar } from "./calendar";

function toDate(value) {
  if (!value) return null;
  try {
    var d = parseISO(String(value));
    return isNaN(d) ? null : d;
  } catch (_e) {
    return null;
  }
}

function DatePicker({ value, onChange, placeholder = "Pick a date", className }) {
  var selected = toDate(value);
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn("h-10 w-[150px] justify-between text-left font-normal", !selected && "text-[rgb(var(--muted))]", className)}
        >
          {selected ? format(selected, "yyyy-MM-dd") : placeholder}
          <CalendarIcon className="h-4 w-4 opacity-70" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={6}
          align="start"
          className="z-50 rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-0 shadow-md"
        >
          <Calendar
            mode="single"
            selected={selected || undefined}
            onSelect={function(nextDate) {
              if (!nextDate) return;
              onChange(format(nextDate, "yyyy-MM-dd"));
            }}
            initialFocus
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

DatePicker.displayName = "DatePicker";

export { DatePicker };
