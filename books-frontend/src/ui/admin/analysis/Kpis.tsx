import type { ReactNode } from "react";
import { UserPlus, LogIn, Users, Activity, UserCircle2 } from "lucide-react";
import type { AnalyticsTotals } from "../../../core/analytics/types";
import { fmtNumber } from "./format";

interface KpiDef {
  key: keyof AnalyticsTotals;
  label: string;
  icon: ReactNode;
  tone: string;
  hint?: string;
}

const KPIS: KpiDef[] = [
  { key: "newSignups", label: "New signups", icon: <UserPlus className="size-5" />, tone: "bg-emerald-50 text-emerald-600" },
  { key: "logins", label: "Logins", icon: <LogIn className="size-5" />, tone: "bg-sky-50 text-sky-600", hint: "From the auth event log (forward-only)." },
  { key: "activeUsers", label: "Active users", icon: <Activity className="size-5" />, tone: "bg-violet-50 text-violet-600" },
  { key: "totalUsers", label: "Total accounts", icon: <Users className="size-5" />, tone: "bg-amber-50 text-amber-600" },
  { key: "totalGuests", label: "Guests", icon: <UserCircle2 className="size-5" />, tone: "bg-ink-100 text-ink-500" },
];

export function Kpis({ totals }: { totals: AnalyticsTotals }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {KPIS.map((k) => (
        <div
          key={k.key}
          title={k.hint}
          className="rounded-2xl bg-white p-4 ring-1 ring-ink-100 shadow-soft"
        >
          <span className={`inline-flex size-9 items-center justify-center rounded-xl ${k.tone}`}>
            {k.icon}
          </span>
          <div className="mt-3 text-2xl font-bold tabular-nums text-ink-900">
            {fmtNumber(totals[k.key])}
          </div>
          <div className="text-xs font-medium text-ink-500">{k.label}</div>
        </div>
      ))}
    </div>
  );
}
