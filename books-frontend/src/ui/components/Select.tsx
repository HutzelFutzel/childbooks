import { forwardRef } from "react";
import type { SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../lib/cn";
import { useReadOnly } from "./ReadOnlyContext";

export interface SelectOption {
  value: string;
  label: string;
  /**
   * Shown but not choosable. Lets a select DISPLAY a value it no longer offers —
   * a native select whose value isn't among its options renders the first one
   * instead, so without this the only ways to keep display and state honest are
   * to silently rewrite the value or to hide it.
   */
  disabled?: boolean;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: SelectOption[];
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { options, className, ...rest },
  ref,
) {
  const readOnly = useReadOnly();
  if (readOnly) {
    const selected = options.find((o) => o.value === rest.value);
    return (
      <div className={cn("flex h-11 w-full items-center rounded-xl2 bg-ink-50 px-3.5 text-sm text-ink-700", className)}>
        {selected?.label ?? "—"}
      </div>
    );
  }
  return (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          "h-11 w-full appearance-none rounded-xl2 bg-white pl-3.5 pr-9 text-sm text-ink-800",
          "ring-1 ring-inset ring-ink-200 transition focus:outline-none focus:ring-2 focus:ring-brand-400",
          "disabled:opacity-60",
          className,
        )}
        {...rest}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
    </div>
  );
});
