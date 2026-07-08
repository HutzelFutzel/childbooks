"use client";

import { motion } from "framer-motion";
import { Check, Loader2, type LucideIcon } from "lucide-react";
import { cn } from "../lib/cn";

export interface PipelinePhase {
  id: string;
  label: string;
  icon: LucideIcon;
}

export interface PipelineStepperProps {
  phases: PipelinePhase[];
  /** Index of the phase currently running. Earlier ones render as done. */
  activeIndex: number;
  title: string;
  subtitle?: string;
  className?: string;
}

/**
 * A calm, beautiful full-stage waiting screen for multi-step background work
 * (story analysis → casting → screenplay → illustrations). Shows the whole
 * pipeline so the wait feels purposeful and legible rather than a lone spinner.
 */
export function PipelineStepper({
  phases,
  activeIndex,
  title,
  subtitle,
  className,
}: PipelineStepperProps) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-md flex-col items-center gap-6 px-6 py-16 text-center",
        className,
      )}
    >
      <div className="space-y-1.5">
        <h2 className="font-display text-2xl font-bold tracking-tight text-ink-900">{title}</h2>
        {subtitle && <p className="text-sm leading-relaxed text-ink-500">{subtitle}</p>}
      </div>

      <ol className="w-full space-y-2">
        {phases.map((phase, i) => {
          const done = i < activeIndex;
          const active = i === activeIndex;
          const Icon = phase.icon;
          return (
            <motion.li
              key={phase.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className={cn(
                "flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors",
                active
                  ? "border-brand-200 bg-brand-50"
                  : done
                    ? "border-emerald-100 bg-emerald-50/60"
                    : "border-ink-100 bg-white/60",
              )}
            >
              <span
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-xl shadow-soft transition-colors",
                  done
                    ? "bg-emerald-500 text-white"
                    : active
                      ? "bg-brand-600 text-(--color-brand-foreground)"
                      : "bg-ink-100 text-ink-400",
                )}
              >
                {done ? (
                  <Check className="size-5" />
                ) : active ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Icon className="size-4" />
                )}
              </span>
              <span
                className={cn(
                  "text-sm font-semibold",
                  active ? "text-brand-700" : done ? "text-ink-700" : "text-ink-400",
                )}
              >
                {phase.label}
              </span>
              {active && (
                <motion.span
                  layoutId="pipeline-active-dot"
                  className="ml-auto size-2 rounded-full bg-brand-500"
                  animate={{ opacity: [0.4, 1, 0.4] }}
                  transition={{ duration: 1.4, repeat: Infinity }}
                />
              )}
            </motion.li>
          );
        })}
      </ol>
    </div>
  );
}
