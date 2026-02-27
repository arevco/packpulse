import { cn } from "../../lib/utils";

export default function SortHeaderButton({ onClick, className, children }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "cursor-pointer border-none bg-transparent p-0 m-0 text-inherit font-inherit text-left",
        className
      )}
    >
      {children}
    </button>
  );
}
