import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { Sparkles, type LucideIcon } from "lucide-react";
import { fadeRise } from "../lib/motion";

export type StageTone = "brand" | "accent" | "sky" | "mint";

const TONES: Record<StageTone, string> = {
  brand: "bg-brand-50 text-brand-700 ring-brand-100",
  accent: "bg-accent-50 text-accent-700 ring-accent-100",
  sky: "bg-sky-50 text-sky-700 ring-sky-100",
  mint: "bg-emerald-50 text-emerald-700 ring-emerald-100",
};

export interface StageHeaderProps {
  /** Small eyebrow pill, e.g. "Step 2 · Characters". */
  eyebrow?: string;
  eyebrowIcon?: LucideIcon;
  /** Color identity of the pill — each studio stage gets its own tint. */
  tone?: StageTone;
  title: ReactNode;
  subtitle?: ReactNode;
  className?: string;
}

/**
 * The consistent centered header used at the top of each studio stage
 * (eyebrow pill + display title + subtitle). Replaces the copy/pasted markup
 * in StoryStage / AnchorsStage.
 */
export function StageHeader({
  eyebrow,
  eyebrowIcon: Icon = Sparkles,
  tone = "brand",
  title,
  subtitle,
  className,
}: StageHeaderProps) {
  return (
    <motion.header
      variants={fadeRise}
      initial="hidden"
      animate="show"
      className={"mb-7 text-center " + (className ?? "")}
    >
      {eyebrow && (
        <span
          className={
            "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset " +
            TONES[tone]
          }
        >
          <Icon className="size-3.5" /> {eyebrow}
        </span>
      )}
      <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-ink-900">{title}</h1>
      {subtitle && (
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-500">{subtitle}</p>
      )}
    </motion.header>
  );
}
