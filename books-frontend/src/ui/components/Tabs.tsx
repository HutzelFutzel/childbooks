import { motion } from "framer-motion";
import { useId } from "react";
import { cn } from "../lib/cn";
import { spring } from "../lib/motion";

export interface TabItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
}

export interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
  /** Stretch tabs evenly across the container width. */
  fullWidth?: boolean;
}

export function Tabs({ items, value, onChange, className, fullWidth }: TabsProps) {
  const layoutId = useId();
  return (
    <div className={cn("inline-flex rounded-full bg-ink-100/70 p-1", fullWidth && "flex w-full", className)}>
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            onClick={() => onChange(item.id)}
            className={cn(
              "relative inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
              fullWidth && "min-w-0 flex-1 justify-center px-2 text-xs sm:px-3.5 sm:text-sm",
              active ? "text-ink-900" : "text-ink-500 hover:text-ink-700",
            )}
          >
            {active && (
              <motion.span
                layoutId={`tab-${layoutId}`}
                className="absolute inset-0 rounded-full bg-white shadow-soft"
                transition={spring}
              />
            )}
            <span className="relative z-10 inline-flex items-center gap-1.5">
              {item.icon}
              {item.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
