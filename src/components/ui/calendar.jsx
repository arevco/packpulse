import * as React from "react";
import { DayPicker } from "react-day-picker";

import { cn } from "../../lib/utils";
import { buttonVariants } from "./button";

function Calendar({ className, classNames, showOutsideDays = true, ...props }) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        months: "flex flex-col sm:flex-row gap-4",
        month: "space-y-4",
        caption: "flex justify-center pt-1 relative items-center",
        caption_label: "text-sm font-medium",
        nav: "space-x-1 flex items-center",
        nav_button: cn(buttonVariants({ variant: "outline", size: "sm" }), "h-7 w-7 bg-transparent p-0 opacity-70 hover:opacity-100"),
        nav_button_previous: "absolute left-1",
        nav_button_next: "absolute right-1",
        table: "w-full border-collapse space-y-1",
        head_row: "flex",
        head_cell: "text-[rgb(var(--muted))] rounded-md w-9 font-normal text-[0.8rem]",
        row: "flex w-full mt-2",
        cell: "h-9 w-9 text-center text-sm p-0 relative [&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected].day-outside)]:bg-[rgb(var(--surface))]/40 [&:has([aria-selected])]:bg-[rgb(var(--surface))] first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md focus-within:relative focus-within:z-20",
        day: cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-9 w-9 p-0 font-normal aria-selected:opacity-100"),
        day_range_end: "day-range-end",
        day_selected: "bg-[rgb(var(--accent))] text-[rgb(var(--accent-foreground))] hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--accent-foreground))] focus:bg-[rgb(var(--accent))] focus:text-[rgb(var(--accent-foreground))]",
        day_today: "bg-[rgb(var(--surface))] text-[rgb(var(--foreground))]",
        day_outside: "day-outside text-[rgb(var(--muted))] opacity-50 aria-selected:bg-[rgb(var(--surface))] aria-selected:text-[rgb(var(--muted))] aria-selected:opacity-30",
        day_disabled: "text-[rgb(var(--muted))] opacity-50",
        day_range_middle: "aria-selected:bg-[rgb(var(--surface))] aria-selected:text-[rgb(var(--foreground))]",
        day_hidden: "invisible",
        ...classNames,
      }}
      {...props}
    />
  );
}

Calendar.displayName = "Calendar";

export { Calendar };
