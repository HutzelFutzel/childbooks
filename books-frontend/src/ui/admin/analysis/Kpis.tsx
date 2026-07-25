import type { ReactNode } from "react";
import { UserPlus, LogIn, Users, Activity, UserCircle2, TrendingDown, TrendingUp } from "lucide-react";
import {
  deltaPct,
  type ActiveUsersSource,
  type AnalyticsTotals,
} from "../../../core/analytics/types";
import { cn } from "../../lib/cn";
import { fmtNumber } from "./format";

interface KpiDef {
  key: keyof AnalyticsTotals;
  label: string;
  icon: ReactNode;
  tone: string;
  hint?: string;
  /** Lifetime counters have no meaningful period-over-period comparison. */
  lifetime?: boolean;
}

const KPIS: KpiDef[] = [
  { key: "newSignups", label: "New signups", icon: <UserPlus className="size-5" />, tone: "bg-emerald-50 text-emerald-600" },
  { key: "logins", label: "Logins", icon: <LogIn className="size-5" />, tone: "bg-sky-50 text-sky-600", hint: "From the auth event log (forward-only)." },
  { key: "activeUsers", label: "Active users", icon: <Activity className="size-5" />, tone: "bg-violet-50 text-violet-600" },
  { key: "totalUsers", label: "Total accounts", icon: <Users className="size-5" />, tone: "bg-amber-50 text-amber-600", lifetime: true },
  { key: "totalGuests", label: "Guests", icon: <UserCircle2 className="size-5" />, tone: "bg-ink-100 text-ink-500", lifetime: true },
];

const ACTIVE_SOURCE_HINT: Record<ActiveUsersSource, string> = {
  events: "Distinct users seen in the auth event log during this window.",
  auth: "Approximated from each account's last sign-in — historical windows undercount until the event log has history.",
};

export function Kpis({
  totals,
  previous,
  activeUsersSource,
  activeUsersComparable,
}: {
  totals: AnalyticsTotals;
  previous: AnalyticsTotals;
  activeUsersSource: ActiveUsersSource;
  activeUsersComparable: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {KPIS.map((k) => {
        // Suppress the trend when the two windows aren't measured the same way.
        const comparable = !k.lifetime && (k.key !== "activeUsers" || activeUsersComparable);
        const delta = comparable ? deltaPct(totals[k.key], previous[k.key]) : null;
        const hint = k.key === "activeUsers" ? ACTIVE_SOURCE_HINT[activeUsersSource] : k.hint;
        return (
          <div key={k.key} title={hint} className="rounded-2xl bg-white p-4 ring-1 ring-ink-100 shadow-soft">
            <span className={`inline-flex size-9 items-center justify-center rounded-xl ${k.tone}`}>
              {k.icon}
            </span>
            <div className="mt-3 text-2xl font-bold tabular-nums text-ink-900">
              {fmtNumber(totals[k.key])}
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-xs font-medium text-ink-500">{k.label}</span>
              {delta !== null && delta !== 0 && <Delta pct={delta} />}
            </div>
            {!k.lifetime && (
              <div className="mt-0.5 text-[11px] text-ink-400">
                {comparable
                  ? `${fmtNumber(previous[k.key])} previous period`
                  : "no comparable baseline"}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Delta({ pct }: { pct: number }) {
  const up = pct > 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums",
        up ? "text-emerald-600" : "text-rose-600",
      )}
    >
      {up ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
      {up ? "+" : ""}
      {pct}%
    </span>
  );
}
