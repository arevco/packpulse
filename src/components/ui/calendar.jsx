import * as React from "react";
import { DayPicker } from "react-day-picker";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "../../lib/utils";
import { buttonVariants } from "./button";

function Calendar({ className, classNames, showOutsideDays = true, ...props }) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("w-fit p-3", className)}
      classNames={{
        months: "flex flex-col sm:flex-row gap-3",
        month: "space-y-3",
        month_caption: "relative flex h-8 items-center justify-center px-8 pt-1",
        caption_label: "text-sm font-medium",
        nav: "absolute inset-x-0 top-1 flex items-center justify-between",
        button_previous: cn(
          buttonVariants({ variant: "outline" }),
          "h-7 w-7 bg-[rgb(var(--surface))] p-0 opacity-80 hover:opacity-100"
        ),
        button_next: cn(
          buttonVariants({ variant: "outline" }),
          "h-7 w-7 bg-[rgb(var(--surface))] p-0 opacity-80 hover:opacity-100"
        ),
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
          if (props.orientation === "left") return <ChevronLeft className="h-4 w-4" />;
          return <ChevronRight className="h-4 w-4" />;
        },
      }}
      {...props}
    />
  );
}

Calendar.displayName = "Calendar";

export { Calendar };
