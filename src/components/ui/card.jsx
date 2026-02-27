import { cn } from "../../lib/utils";

function Card({ className, ...props }) {
  return <div className={cn("rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--surface))]", className)} {...props} />;
}

function CardHeader({ className, ...props }) {
  return <div className={cn("px-4 py-3", className)} {...props} />;
}

function CardContent({ className, ...props }) {
  return <div className={cn("px-4 pb-4", className)} {...props} />;
}

export { Card, CardHeader, CardContent };
