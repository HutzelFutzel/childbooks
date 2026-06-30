"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import type { Timeframe } from "../../../core/analytics/types";
import { useAdminAnalytics } from "../../../state/adminAnalyticsStore";
import { Button } from "../../components/Button";
import { Tabs } from "../../components/Tabs";
import { Kpis } from "./Kpis";
import { ActivityChart, HourChart, SourcesChart } from "./Charts";
import { Heatmap } from "./Heatmap";
import { UsersTable } from "./UsersTable";
import { SettingsCard } from "./SettingsCard";
import { PaymentsAnalysis } from "./PaymentsAnalysis";
import { fmtRelative } from "./format";

const TIMEFRAMES: { id: Timeframe; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "7d", label: "Last 7d" },
  { id: "30d", label: "Last 30d" },
  { id: "custom", label: "Custom" },
];

function toDateInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function AnalysisTab() {
  const init = useAdminAnalytics((s) => s.init);
  const refresh = useAdminAnalytics((s) => s.refresh);
  const loading = useAdminAnalytics((s) => s.loading);
  const error = useAdminAnalytics((s) => s.error);
  const overview = useAdminAnalytics((s) => s.overview);
  const lastUpdated = useAdminAnalytics((s) => s.lastUpdated);
  const timeframe = useAdminAnalytics((s) => s.timeframe);
  const setTimeframe = useAdminAnalytics((s) => s.setTimeframe);
  const customFrom = useAdminAnalytics((s) => s.customFrom);
  const customTo = useAdminAnalytics((s) => s.customTo);
  const setCustomRange = useAdminAnalytics((s) => s.setCustomRange);
  const autoRefreshSec = useAdminAnalytics((s) => s.settings.autoRefreshSec);

  const [, forceTick] = useState(0);
  const [section, setSection] = useState<"users" | "payments">("users");

  useEffect(() => {
    void init();
  }, [init]);

  // Auto-refresh: poll on the configured interval, but pause while the tab is
  // hidden so a backgrounded dashboard doesn't keep re-scanning every user.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    if (!autoRefreshSec) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshRef.current();
    }, autoRefreshSec * 1000);
    return () => window.clearInterval(id);
  }, [autoRefreshSec]);

  // Re-render the "updated Xs ago" label every 30s.
  useEffect(() => {
    const id = window.setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="space-y-5">
      <Tabs
        items={[
          { id: "users", label: "Users" },
          { id: "payments", label: "Payments" },
        ]}
        value={section}
        onChange={(id) => setSection(id as "users" | "payments")}
      />

      {section === "payments" && <PaymentsAnalysis />}

      {section === "users" && (
      <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs items={TIMEFRAMES} value={timeframe} onChange={(id) => setTimeframe(id as Timeframe)} />
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-xs text-ink-400">Updated {fmtRelative(lastUpdated)}</span>
          )}
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />}
            onClick={() => void refresh()}
            disabled={loading}
          >
            Refresh
          </Button>
        </div>
      </div>

      {timeframe === "custom" && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink-500">From</span>
          <input
            type="date"
            value={toDateInput(customFrom)}
            onChange={(e) => setCustomRange(new Date(e.target.value).getTime(), customTo)}
            className="h-9 rounded-lg bg-white px-3 text-sm ring-1 ring-inset ring-ink-200 focus:outline-none focus:ring-2 focus:ring-brand-400"
          />
          <span className="text-ink-500">to</span>
          <input
            type="date"
            value={toDateInput(customTo)}
            onChange={(e) =>
              setCustomRange(customFrom, new Date(e.target.value).getTime() + 24 * 60 * 60 * 1000 - 1)
            }
            className="h-9 rounded-lg bg-white px-3 text-sm ring-1 ring-inset ring-ink-200 focus:outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100">
          <AlertTriangle className="size-4 shrink-0" />
          {error}
        </div>
      )}

      {!overview && loading && (
        <div className="flex items-center justify-center py-20 text-ink-400">
          <Loader2 className="size-6 animate-spin" />
        </div>
      )}

      {overview && (
        <>
          {overview.capped && (
            <div className="rounded-xl bg-amber-50 px-4 py-2.5 text-xs text-amber-700 ring-1 ring-amber-100">
              Showing a partial scan (project exceeds the per-request user cap) — totals are a lower bound.
            </div>
          )}
          <Kpis totals={overview.totals} />
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <ActivityChart overview={overview} />
            </div>
            <SourcesChart overview={overview} />
          </div>
          <Heatmap overview={overview} />
          <HourChart overview={overview} />
          <UsersTable />
          <SettingsCard />
        </>
      )}
      </div>
      )}
    </div>
  );
}
