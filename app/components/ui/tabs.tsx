"use client";

import { cn } from "./utils";

interface TabsProps<T extends string> {
  items: T[];
  value: T;
  onValueChange: (value: T) => void;
  ariaLabel: string;
}

export function Tabs<T extends string>({ items, value, onValueChange, ariaLabel }: TabsProps<T>) {
  return (
    <div
      aria-label={ariaLabel}
      className="inline-flex rounded-[12px] bg-panel-subtle p-1 text-xs text-muted"
      role="tablist"
    >
      {items.map((item) => (
        <button
          aria-selected={item === value}
          className={cn(
            "h-8 min-w-11 rounded-[9px] px-3 font-semibold transition-colors",
            item === value ? "bg-panel text-foreground shadow-sm" : "hover:text-foreground",
          )}
          key={item}
          onClick={() => onValueChange(item)}
          role="tab"
          type="button"
        >
          {item}
        </button>
      ))}
    </div>
  );
}
