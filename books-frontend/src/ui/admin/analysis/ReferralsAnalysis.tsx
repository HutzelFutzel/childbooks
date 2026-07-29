"use client";

/**
 * Referral funnel analytics: invites sent → accepted → verified → activated →
 * first purchase, plus who's driving it and what it's costing.
 *
 * This used to live inside Configuration → Referrals, but it's a live metrics
 * view, not a setting — it belongs next to the rest of the funnels in Analysis.
 * The program's rules, copy and business-impact model are still configured
 * under Configuration → Referrals; held payouts needing a human decision live
 * there too (cross-linked below).
 */
import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, Loader2, RefreshCw } from "lucide-react";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { useAdminTab } from "../adminTabStore";
import { funnelRates, type ReferralDayStats, type ReferralStatsSummary } from "../../../core/config/referral";
import { CardBody, CardHeader, CardTitle } from "../../components/Card";
import { Button } from "../../components/Button";
import { Tabs } from "../../components/Tabs";
import { cn } from "../../lib/cn";
import { fmtNumber, fmtRelative } from "./format";

const WINDOWS = [
  { id: "7", label: "Last 7d" },
  { id: "30", label: "Last 30d" },
  { id: "90", label: "Last 90d" },
];

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function stagesFor(t: ReferralDayStats): { key: string; label: string; value: number }[] {
  return [
    { key: "sent", label: "Invites sent", value: t.invitesSent },
    { key: "accepted", label: "Accepted", value: t.invitesAccepted },
    { key: "verified", label: "Verified", value: t.verified },
    { key: "activated", label: "First book", value: t.activated },
    { key: "purchased", label: "First purchase", value: t.purchased },
  ];
}

function FunnelStages({ totals }: { totals: ReferralDayStats }) {
  const stages = stagesFor(totals);
  const first = stages[0]?.value ?? 0;
  return (
    <div className="space-y-1.5">
      {stages.map((stage, i) => {
        const width = first > 0 ? Math.max(2, (stage.value / first) * 100) : 0;
        const prev = i > 0 ? stages[i - 1].value : null;
        const stepPct = prev ? Math.round((stage.value / prev) * 1000) / 10 : null;
        const overallPct = first > 0 ? Math.round((stage.value / first) * 1000) / 10 : null;
        return (
          <div key={stage.key} className="flex items-center gap-3">
            <div className="w-28 shrink-0 text-xs text-ink-500">{stage.label}</div>
            <div className="relative h-7 flex-1 overflow-hidden rounded-lg bg-ink-50">
              <div
                className={cn(
                  "h-full rounded-lg transition-all",
                  i === stages.length - 1 ? "bg-emerald-400/70" : "bg-brand-400/70",
                )}
                style={{ width: `${width}%` }}
              />
              <span className="absolute inset-y-0 left-2.5 flex items-center text-xs font-semibold tabular-nums text-ink-800">
                {fmtNumber(stage.value)}
              </span>
            </div>
            <div className="w-28 shrink-0 text-right text-xs tabular-nums">
              {stepPct === null ? (
                <span className="text-ink-300">—</span>
              ) : (
                <span
                  className={cn(
                    "font-semibold",
                    stepPct >= 50 ? "text-emerald-600" : stepPct >= 20 ? "text-amber-600" : "text-rose-600",
                  )}
                >
                  {stepPct}%
                </span>
              )}
              <span className="ml-1 text-ink-400">{overallPct !== null && i > 0 ? `(${overallPct}%)` : ""}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StatCard({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg bg-white px-3 py-2 ring-1 ring-inset ring-ink-100">
      <div className="text-[11px] uppercase tracking-wide text-ink-400">{label}</div>
      <div className="text-base font-semibold text-ink-800">{value}</div>
      {note && <div className="text-[11px] text-ink-400">{note}</div>}
    </div>
  );
}

export function ReferralsAnalysis() {
  const loadStats = useAppConfigStore((s) => s.loadReferralStats);
  const baseCurrency = useAppConfigStore((s) => s.pricingSettings.baseCurrency);
  const setSection = useAdminTab((s) => s.setSection);
  const setConfigTab = useAdminTab((s) => s.setConfigTab);

  const [days, setDays] = useState(30);
  const [stats, setStats] = useState<ReferralStatsSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const refresh = () => {
    setLoading(true);
    setError(null);
    const to = Date.now();
    const from = to - days * 86_400_000;
    void loadStats(from, to)
      .then((s) => {
        setStats(s);
        setLastUpdated(Date.now());
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load referral stats."))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-fetch when the window changes
  }, [days]);

  const openHeldPayouts = () => {
    setConfigTab("referrals");
    setSection("configuration");
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs items={WINDOWS} value={String(days)} onChange={(id) => setDays(Number(id))} />
        <div className="flex items-center gap-3">
          {lastUpdated && <span className="text-xs text-ink-400">Updated {fmtRelative(lastUpdated)}</span>}
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />}
            onClick={refresh}
            disabled={loading}
          >
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100">
          <AlertTriangle className="size-4 shrink-0" />
          {error}
        </div>
      )}

      {!stats && loading && (
        <div className="flex items-center justify-center py-20 text-ink-400">
          <Loader2 className="size-6 animate-spin" />
        </div>
      )}

      {stats && (
        <>
          <div className="rounded-2xl bg-white ring-1 ring-ink-100 shadow-soft">
            <CardHeader className="py-3.5">
              <CardTitle className="text-sm">Invite funnel</CardTitle>
              <p className="mt-0.5 text-xs text-ink-400">
                Invites sent → accepted → verified → made a first book → first purchase.
              </p>
            </CardHeader>
            <CardBody className="space-y-4 pt-2">
              <FunnelStages totals={stats.totals} />

              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard
                  label="Cost / paying customer"
                  value={money(funnelRates(stats.totals).costPerPayingCustomer, baseCurrency)}
                  note={`${stats.totals.rewardsGranted} rewards · ${money(stats.totals.rewardCost, baseCurrency)} total`}
                />
                <StatCard label="Clawbacks" value={fmtNumber(stats.totals.clawbacks)} />
                {stats.pendingReview > 0 && (
                  <div className="rounded-lg bg-amber-50 px-3 py-2 ring-1 ring-inset ring-amber-100 sm:col-span-2">
                    <div className="text-[11px] uppercase tracking-wide text-amber-700">Needs a decision</div>
                    <button
                      type="button"
                      onClick={openHeldPayouts}
                      className="mt-0.5 flex items-center gap-1 text-sm font-semibold text-amber-800 hover:underline"
                    >
                      {stats.pendingReview} held reward{stats.pendingReview === 1 ? "" : "s"} waiting in
                      Configuration → Referrals <ArrowRight className="size-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </CardBody>
          </div>

          {stats.topInviters.length > 0 && (
            <div className="rounded-2xl bg-white ring-1 ring-ink-100 shadow-soft">
              <CardHeader className="py-3.5">
                <CardTitle className="text-sm">Top inviters</CardTitle>
              </CardHeader>
              <CardBody className="pt-2">
                <div className="overflow-x-auto rounded-lg ring-1 ring-inset ring-ink-100">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-ink-50 text-[11px] uppercase tracking-wide text-ink-500">
                      <tr>
                        <th className="px-2.5 py-1.5 font-semibold">Inviter</th>
                        <th className="px-2.5 py-1.5 font-semibold">Sent</th>
                        <th className="px-2.5 py-1.5 font-semibold">Accepted</th>
                        <th className="px-2.5 py-1.5 font-semibold">Rewarded</th>
                        <th className="px-2.5 py-1.5 font-semibold">Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.topInviters.map((row) => (
                        <tr key={row.uid} className="border-t border-ink-100">
                          <td className="px-2.5 py-1.5 text-ink-700">
                            {row.email ?? row.uid.slice(0, 8)}
                            {row.needsReview && (
                              <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                                review
                              </span>
                            )}
                          </td>
                          <td className="px-2.5 py-1.5">{row.sent}</td>
                          <td className="px-2.5 py-1.5">{row.accepted}</td>
                          <td className="px-2.5 py-1.5">{row.rewarded}</td>
                          <td className="px-2.5 py-1.5">{money(row.cost, baseCurrency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardBody>
            </div>
          )}
        </>
      )}
    </div>
  );
}
