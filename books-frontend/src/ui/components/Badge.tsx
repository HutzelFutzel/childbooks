import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn";

type Tone = "brand" | "accent" | "neutral" | "success" | "danger";

const TONES: Record<Tone, string> = {
  brand: "bg-brand-50 text-brand-700 ring-brand-100",
  accent: "bg-accent-50 text-accent-600 ring-accent-100",
  neutral: "bg-ink-100 text-ink-600 ring-ink-200",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  danger: "bg-red-50 text-red-700 ring-red-100",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

export function Badge({ tone = "neutral", className, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        TONES[tone],
        className,
      )}
      {...rest}
    />
  );
}
