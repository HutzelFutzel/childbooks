import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { cn } from "../lib/cn";
import { spring } from "../lib/motion";

export interface OptionCardProps {
  selected: boolean;
  onSelect: () => void;
  title: string;
  description?: string;
  /** Optional visual rendered above the text (e.g. a swatch or diagram). */
  visual?: React.ReactNode;
  /**
   * Currently applied / in-use option (can differ from `selected` while the
   * user previews a change). Shown with a quieter ring + badge when not also
   * selected.
   */
  current?: boolean;
  /** Badge when `current` (default "Current"). */
  currentLabel?: string;
  disabled?: boolean;
  className?: string;
}

export function OptionCard({
  selected,
  onSelect,
  title,
  description,
  visual,
  current = false,
  currentLabel = "Current",
  disabled,
  className,
}: OptionCardProps) {
  return (
    <motion.button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      whileHover={disabled ? undefined : { y: -2 }}
      whileTap={disabled ? undefined : { scale: 0.99 }}
      transition={spring}
      className={cn(
        "relative flex w-full flex-col gap-2 rounded-2xl border p-3 text-left transition-colors",
        selected
          ? "border-brand-500 bg-brand-50/60 ring-2 ring-brand-200"
          : current
            ? "border-ink-300 bg-ink-50/80 ring-1 ring-ink-200"
            : "border-ink-200 bg-white hover:border-brand-300",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      {current && (
        <span
          className={cn(
            "absolute right-2 top-2 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
            selected
              ? "bg-brand-100 text-brand-700"
              : "bg-ink-100 text-ink-600",
          )}
        >
          {currentLabel}
        </span>
      )}
      {visual}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-ink-800">{title}</p>
          {description && <p className="mt-0.5 text-xs text-ink-500">{description}</p>}
        </div>
        <span
          className={cn(
            "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border transition",
            selected
              ? "border-brand-500 bg-brand-500 text-(--color-brand-foreground)"
              : "border-ink-300 bg-white",
          )}
        >
          {selected && <Check className="size-3.5" strokeWidth={3} />}
        </span>
      </div>
    </motion.button>
  );
}
