"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Download, Loader2, RefreshCw } from "lucide-react";
import { countryFlag, countryLabel } from "../../../core/analytics/markets";
import type { ActivityMetric, Timeframe, TimezoneMode } from "../../../core/analytics/types";
import { useAdminAnalytics } from "../../../state/adminAnalyticsStore";
import { useAdminFinance } from "../../../state/adminFinanceStore";
import { useAdminMarket } from "../../../state/adminMarketStore";
import { useAdminPayments } from "../../../state/adminPaymentsStore";
import { ANALYSIS_GROUPS, useAdminTab, type AnalysisGroupId, type AnalysisTabId } from "../adminTabStore";
import { ANALYSIS_TAB_META } from "../adminNav";
import { filterReadableTabs, SectionGate } from "../AccessGate";
import { useAdminAccess } from "../../../state/adminAccessStore";
import { Button } from "../../components/Button";
import { Tabs } from "../../components/Tabs";
import { Kpis } from "./Kpis";
import { ActivityChart, HourChart, SourcesChart } from "./Charts";
import { Heatmap } from "./Heatmap";
import { UsersTable } from "./UsersTable";
import { SettingsCard } from "./SettingsCard";
import { PaymentsAnalysis } from "./PaymentsAnalysis";
import { FinanceAnalysis } from "./FinanceAnalysis";
import { CostsAnalysis } from "./CostsAnalysis";
import { ProjectsAnalysis } from "./ProjectsAnalysis";
import { ProductsAnalysis } from "./ProductsAnalysis";
import { ReferralsAnalysis } from "./ReferralsAnalysis";
import { AffiliatesAnalysis } from "./AffiliatesAnalysis";
import { CampaignsAnalysis } from "./CampaignsAnalysis";
import { SurveysAnalysis } from "./SurveysAnalysis";
import { MarketPicker } from "./MarketPicker";
import { MarketsCard } from "./MarketsCard";
import { FunnelCard } from "./FunnelCard";
import { downloadCsv } from "./csv";
import { fmtRelative, toDateInput } from "./format";

type Section = AnalysisTabId;

const TIMEFRAMES: { id: Timeframe; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "7d", label: "Last 7d" },
  { id: "30d", label: "Last 30d" },
  { id: "custom", label: "Custom" },
];

const METRICS: { id: ActivityMetric; label: string }[] = [
  { id: "all", label: "All activity" },
  { id: "signups", label: "Signups" },
  { id: "logins", label: "Logins" },
];

const TZ_MODES: { id: TimezoneMode; label: string }[] = [
  { id: "market", label: "User local time" },
  { id: "fixed", label: "Single timezone" },
];

const METRIC_LABEL: Record<ActivityMetric, string> = {
  all: "Activity",
  signups: "Signups",
  logins: "Logins",
};

export function AnalysisTab() {
  const init = useAdminAnalytics((s) => s.init);
  const refresh = useAdminAnalytics((s) => s.refresh);
  const loading = useAdminAnalytics((s) => s.loading);
  const error = useAdminAnalytics((s) => s.error);
  const overview = useAdminAnalytics((s) => s.overview);
  const funnel = useAdminAnalytics((s) => s.funnel);
  const lastUpdated = useAdminAnalytics((s) => s.lastUpdated);
  const timeframe = useAdminAnalytics((s) => s.timeframe);
  const setTimeframe = useAdminAnalytics((s) => s.setTimeframe);
  const customFrom = useAdminAnalytics((s) => s.customFrom);
  const customTo = useAdminAnalytics((s) => s.customTo);
  const setCustomRange = useAdminAnalytics((s) => s.setCustomRange);
  const autoRefreshSec = useAdminAnalytics((s) => s.settings.autoRefreshSec);
  const setCountry = useAdminAnalytics((s) => s.setCountry);
  const tzMode = useAdminAnalytics((s) => s.tzMode);
  const setTzMode = useAdminAnalytics((s) => s.setTzMode);
  const metric = useAdminAnalytics((s) => s.metric);
  const setMetric = useAdminAnalytics((s) => s.setMetric);
  const countUniqueUsers = useAdminAnalytics((s) => s.countUniqueUsers);
  const setCountUniqueUsers = useAdminAnalytics((s) => s.setCountUniqueUsers);

  const refreshProducts = useAdminAnalytics((s) => s.refreshProducts);
  const refreshPayments = useAdminPayments((s) => s.refresh);
  const refreshFinance = useAdminFinance((s) => s.refresh);

  const country = useAdminMarket((s) => s.country);
  const knownMarkets = useAdminMarket((s) => s.known);

  const [, forceTick] = useState(0);
  // Lifted to the nav store (not local state) so other tabs can deep-link
  // straight to a specific Analysis section, e.g. Marketing → Referrals'
  // "see the funnel" cross-link.
  const section = useAdminTab((s) => s.analysisTab);
  const setSection = useAdminTab((s) => s.setAnalysisTab);
  const group = useAdminTab((s) => s.analysisGroup);
  const setGroup = useAdminTab((s) => s.setAnalysisGroup);
  const canRead = useAdminAccess((s) => s.canRead);
  const visibleGroups = useMemo(
    () =>
      ANALYSIS_GROUPS.map((g) => ({ ...g, tabs: filterReadableTabs("analysis", g.tabs, canRead) })).filter(
        (g) => g.tabs.length > 0,
      ),
    [canRead],
  );
  const activeGroup = visibleGroups.find((g) => g.id === group) ?? visibleGroups[0] ?? ANALYSIS_GROUPS[0];

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

  // Keep the visible section in sync with the market filter. Each section
  // remembers the market its data was fetched under, so switching markets
  // re-fetches only what's on screen and switching back to a stale section
  // refreshes it then — rather than re-scanning all four on every click.
  const loadedFor = useRef<Partial<Record<Section, string>>>({});
  useEffect(() => {
    const key = country ?? "all";
    const previous = loadedFor.current[section];
    loadedFor.current[section] = key;
    // The first time a section is shown, its own mount effect does the initial
    // fetch; this effect only handles going stale afterwards.
    if (previous === undefined || previous === key) return;
    if (section === "users") void refresh();
    if (section === "products") void refreshProducts();
    if (section === "payments") void refreshPayments();
    if (section === "finance") void refreshFinance();
  }, [section, country, refresh, refreshProducts, refreshPayments, refreshFinance]);

  const grid = overview?.activity[metric] ?? null;

  return (
    <div className="space-y-5">
      {/* Group pills, then the tabs within that group, then the dashboard-wide
          market filter that every section honours. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {visibleGroups.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => setGroup(g.id as AnalysisGroupId)}
              className={
                "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors " +
                (group === g.id
                  ? "bg-brand-600 text-white shadow-sm"
                  : "bg-white text-ink-600 ring-1 ring-inset ring-ink-100 hover:bg-ink-50")
              }
            >
              {g.label}
            </button>
          ))}
        </div>
        <MarketPicker
          value={country}
          markets={knownMarkets}
          onChange={setCountry}
          disabled={loading}
        />
      </div>

      <p className="text-xs text-ink-400">{activeGroup.description}</p>

      <Tabs
        items={activeGroup.tabs.map((id) => ({
          id,
          label: ANALYSIS_TAB_META[id].label,
          icon: ANALYSIS_TAB_META[id].icon,
        }))}
        value={section}
        onChange={(id) => setSection(id as Section)}
      />

      {country && (
        <div className="flex items-center gap-2 rounded-xl bg-brand-50 px-3.5 py-2 text-sm text-brand-800 ring-1 ring-brand-100">
          <span>
            Showing <strong>{countryFlag(country)} {countryLabel(country)}</strong> only — every
            number below is scoped to this market.
          </span>
          <button
            type="button"
            onClick={() => setCountry(null)}
            className="ml-auto text-xs font-medium text-brand-600 hover:underline"
          >
            Clear
          </button>
        </div>
      )}

      <SectionGate permissionKey={`analysis.${section}`}>
      {section === "projects" && <ProjectsAnalysis />}
      {section === "costs" && <CostsAnalysis />}
      {section === "products" && <ProductsAnalysis />}
      {section === "payments" && <PaymentsAnalysis />}
      {section === "finance" && <FinanceAnalysis />}
      {section === "referrals" && <ReferralsAnalysis />}
      {section === "affiliates" && <AffiliatesAnalysis />}
      {section === "campaigns" && <CampaignsAnalysis />}
      {section === "surveys" && <SurveysAnalysis />}

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

          {overview && grid && (
            <>
              {overview.capped && (
                <div className="rounded-xl bg-amber-50 px-4 py-2.5 text-xs text-amber-700 ring-1 ring-amber-100">
                  Showing a partial scan (project exceeds the per-request user cap) — totals are a
                  lower bound.
                </div>
              )}
              {overview.eventsCapped && (
                <div className="rounded-xl bg-amber-50 px-4 py-2.5 text-xs text-amber-700 ring-1 ring-amber-100">
                  The auth event log exceeded the per-request scan cap for this window — login and
                  activity counts are a lower bound. Narrow the window for exact numbers.
                </div>
              )}

              <Kpis
                totals={overview.totals}
                previous={overview.previousTotals}
                activeUsersSource={overview.activeUsersSource}
                activeUsersComparable={overview.activeUsersComparable}
              />

              <div className="grid gap-4 lg:grid-cols-3">
                <div className="lg:col-span-2">
                  <ActivityChart overview={overview} />
                </div>
                <SourcesChart overview={overview} />
              </div>

              {funnel && <FunnelCard funnel={funnel} />}

              {/* Activity controls, shared by the heatmap and the hour chart. */}
              <div className="flex flex-wrap items-center gap-3">
                <Tabs items={METRICS} value={metric} onChange={(id) => setMetric(id as ActivityMetric)} />
                <Tabs items={TZ_MODES} value={tzMode} onChange={(id) => setTzMode(id as TimezoneMode)} />
                <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-600">
                  <input
                    type="checkbox"
                    checked={countUniqueUsers}
                    onChange={(e) => setCountUniqueUsers(e.target.checked)}
                    className="size-4 rounded border-ink-300 text-brand-500 focus:ring-brand-400"
                  />
                  Count people, not events
                </label>
              </div>

              <Heatmap
                grid={grid}
                timezone={overview.timezone}
                tzMode={overview.tzMode}
                countUniqueUsers={countUniqueUsers}
                metricLabel={METRIC_LABEL[metric]}
              />

              <div className="grid gap-4 lg:grid-cols-2">
                <HourChart
                  grid={grid}
                  tzMode={overview.tzMode}
                  timezone={overview.timezone}
                  metricLabel={METRIC_LABEL[metric]}
                />
                <MarketsCard
                  countries={overview.countries}
                  selected={country}
                  onSelect={setCountry}
                />
              </div>

              <div className="flex justify-end">
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<Download className="size-4" />}
                  onClick={() =>
                    downloadCsv(
                      "markets",
                      overview.countries.map((c) => ({
                        country: c.country,
                        name: countryLabel(c.country),
                        accounts: c.totalUsers,
                        signups: c.signups,
                        logins: c.logins,
                        activeUsers: c.activeUsers,
                        timezone: c.timezone,
                      })),
                    )
                  }
                >
                  Export markets CSV
                </Button>
              </div>

              <UsersTable />
              <SettingsCard />
            </>
          )}
        </div>
      )}
      </SectionGate>
    </div>
  );
}
