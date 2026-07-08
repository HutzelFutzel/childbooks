import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { Sparkles, type LucideIcon } from "lucide-react";
import { fadeRise } from "../lib/motion";

export interface StageHeaderProps {
  /** Small eyebrow pill, e.g. "Step 2 · Characters". */
  eyebrow?: string;
  eyebrowIcon?: LucideIcon;
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
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700 ring-1 ring-inset ring-brand-100">
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
