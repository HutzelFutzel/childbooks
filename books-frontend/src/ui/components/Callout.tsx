import type { ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Sparkles,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../lib/cn";

export type CalloutTone = "info" | "success" | "warning" | "danger" | "brand";

const TONES: Record<CalloutTone, { wrap: string; icon: string; defaultIcon: LucideIcon }> = {
  info: {
    wrap: "border-ink-200 bg-ink-50 text-ink-700",
    icon: "text-ink-400",
    defaultIcon: Info,
  },
  success: {
    wrap: "border-emerald-200 bg-emerald-50 text-emerald-800",
    icon: "text-emerald-500",
    defaultIcon: CheckCircle2,
  },
  warning: {
    wrap: "border-amber-200 bg-amber-50 text-amber-800",
    icon: "text-amber-500",
    defaultIcon: AlertTriangle,
  },
  danger: {
    wrap: "border-red-200 bg-red-50 text-red-800",
    icon: "text-red-500",
    defaultIcon: XCircle,
  },
  brand: {
    wrap: "border-brand-200 bg-brand-50 text-brand-800",
    icon: "text-brand-500",
    defaultIcon: Sparkles,
  },
};

export interface CalloutProps {
  tone?: CalloutTone;
  title?: ReactNode;
  children?: ReactNode;
  /** Trailing action(s), e.g. a Button — kept on the same row on wide layouts. */
  action?: ReactNode;
  icon?: LucideIcon | null;
  className?: string;
}

/**
 * One consistent inline message surface (info / success / warning / danger /
 * brand). Replaces the ad-hoc amber/emerald/brand boxes scattered across the
 * studio so every notice reads the same.
 */
export function Callout({ tone = "info", title, children, action, icon, className }: CalloutProps) {
  const t = TONES[tone];
  const Icon = icon === null ? null : (icon ?? t.defaultIcon);
  return (
    <div
      className={cn(
        "flex flex-wrap items-start gap-x-3 gap-y-2 rounded-2xl border px-3.5 py-2.5",
        t.wrap,
        className,
      )}
    >
      {Icon && <Icon className={cn("mt-0.5 size-4 shrink-0", t.icon)} />}
      <div className="min-w-0 flex-1 text-xs leading-relaxed">
        {title && <p className="text-sm font-semibold">{title}</p>}
        {children && <div className={cn(title && "mt-0.5 opacity-90")}>{children}</div>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}
