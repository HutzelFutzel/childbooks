import type { ReactNode } from "react";
import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { fadeRise } from "../lib/motion";
import { cn } from "../lib/cn";

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  /** Render as a big clickable card (dashed border) instead of plain centered. */
  as?: "plain" | "card";
  onClick?: () => void;
}

/** A consistent, friendly empty/teaching state used across the studio. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  as = "plain",
  onClick,
}: EmptyStateProps) {
  const inner = (
    <motion.div
      variants={fadeRise}
      initial="hidden"
      animate="show"
      className="flex flex-col items-center gap-3 text-center"
    >
      <span className="flex size-14 items-center justify-center rounded-2xl bg-brand-100 text-brand-600 shadow-soft animate-float-slow">
        <Icon className="size-7" strokeWidth={2.25} />
      </span>
      <div className="space-y-1">
        <p className="font-display text-base font-semibold text-ink-800">{title}</p>
        {description && (
          <p className="mx-auto max-w-sm text-sm leading-relaxed text-ink-500">{description}</p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </motion.div>
  );

  if (as === "card") {
    return (
      <button
        onClick={onClick}
        className={cn(
          "flex w-full flex-col items-center justify-center rounded-3xl border-2 border-dashed border-ink-200 bg-white/50 py-16 transition hover:border-brand-300 hover:bg-white",
          className,
        )}
      >
        {inner}
      </button>
    );
  }

  return (
    <div className={cn("flex h-full flex-col items-center justify-center p-6", className)}>
      {inner}
    </div>
  );
}
