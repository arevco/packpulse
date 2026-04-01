import * as React from "react";
import { DayPicker } from "react-day-picker";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "../../lib/utils";
import { buttonVariants } from "./button";

function Calendar({ className, classNames, showOutsideDays = true, ...props }) {
  return (
    <DayPicker
      navLayout="around"
      showOutsideDays={showOutsideDays}
      className={cn("w-fit p-3", className)}
      classNames={{
        months: "flex flex-col sm:flex-row gap-3",
        month: "relative space-y-3",
        month_caption: "flex h-9 items-center justify-center px-10",
        caption_label: "text-sm font-medium",
        nav: "flex items-center gap-1",
        button_previous:
          "absolute left-0 top-0 inline-flex h-8 w-8 items-center justify-center rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-0 text-[rgb(var(--muted))] opacity-80 transition-colors hover:text-[rgb(var(--foreground))] hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--accent))] focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50",
        button_next:
          "absolute right-0 top-0 inline-flex h-8 w-8 items-center justify-center rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-0 text-[rgb(var(--muted))] opacity-80 transition-colors hover:text-[rgb(var(--foreground))] hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--accent))] focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50",
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday: "w-9 text-center text-[0.8rem] font-medium text-[rgb(var(--muted))]",
        weeks: "mt-1",
        week: "mt-1 flex w-full",
        day: "h-9 w-9 p-0 text-center text-sm",
        day_button: cn(
          buttonVariants({ variant: "ghost" }),
          "h-9 w-9 rounded-md p-0 font-normal text-[rgb(var(--foreground))] aria-selected:bg-[rgb(var(--accent))] aria-selected:text-[rgb(var(--accent-foreground))] aria-selected:hover:bg-[rgb(var(--accent))] aria-selected:hover:text-[rgb(var(--accent-foreground))] aria-selected:opacity-100"
        ),
        selected:
          "bg-transparent text-[rgb(var(--foreground))]",
        today: "text-[rgb(var(--foreground))]",
        outside:
          "text-[rgb(var(--muted))] opacity-50 aria-selected:bg-transparent aria-selected:text-[rgb(var(--muted))] aria-selected:opacity-50",
        disabled: "text-[rgb(var(--muted))] opacity-50",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: function Chevron(props) {
          var chevronClassName = cn("h-4 w-4 shrink-0", props.className);
          if (props.orientation === "left") return <ChevronLeft className={chevronClassName} />;
          return <ChevronRight className={chevronClassName} />;
        },
      }}
      {...props}
    />
  );
}

Calendar.displayName = "Calendar";

export { Calendar };
