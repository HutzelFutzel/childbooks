"use client";

/**
 * Campaign results: what each promotion paid out, and — the only question that
 * actually matters — whether it caused anything.
 *
 * The headline number here is **lift**, not conversion. A campaign's treated
 * group converting at 8% tells you nothing on its own; if the holdout also
 * converted at 8%, you paid for every one of those purchases and changed nothing.
 * So the holdout comparison is the first thing on the card, and a campaign
 * configured without a holdout is shown as "unmeasurable" rather than being given
 * a flattering conversion number it hasn't earned.
 *
 * The rules, budgets and held payouts are configured under
 * Marketing → Campaigns, cross-linked below.
 */
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Loader2, RefreshCw } from "lucide-react";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { useAdminTab } from "../adminTabStore";
import { campaignTeaser, type CampaignReport } from "../../../core/config/campaigns";
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

function StatCard({
  label,
  value,
  note,
  tone = "plain",
}: {
  label: string;
  value: string;
  note?: string;
  tone?: "plain" | "good" | "bad" | "unknown";
}) {
  return (
    <div
      className={cn(
        "rounded-lg px-3 py-2 ring-1 ring-inset",
        tone === "good"
          ? "bg-emerald-50 ring-emerald-100"
          : tone === "bad"
            ? "bg-rose-50 ring-rose-100"
            : tone === "unknown"
              ? "bg-amber-50 ring-amber-100"
              : "bg-white ring-ink-100",
      )}
    >
      <div className="text-[11px] uppercase tracking-wide text-ink-400">{label}</div>
      <div
        className={cn(
          "text-base font-semibold",
          tone === "good"
            ? "text-emerald-800"
            : tone === "bad"
              ? "text-rose-800"
              : tone === "unknown"
                ? "text-amber-800"
                : "text-ink-800",
        )}
      >
        {value}
      </div>
      {note && <div className="text-[11px] text-ink-400">{note}</div>}
    </div>
  );
}

export function CampaignsAnalysis() {
  const campaigns = useAppConfigStore((s) => s.campaigns);
  const loadReport = useAppConfigStore((s) => s.loadCampaignReport);
  const baseCurrency = useAppConfigStore((s) => s.pricingSettings.baseCurrency);
  const openMarketingTab = useAdminTab((s) => s.openMarketingTab);

  const [days, setDays] = useState(30);
  // Bumped by Refresh. The window alone can't drive a re-fetch, because refreshing
  // without changing it has to still hit the server.
  const [nonce, setNonce] = useState(0);
  const [reports, setReports] = useState<Record<string, CampaignReport>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  // The public projection only carries running campaigns, which is exactly the set
  // worth reporting on — an ended campaign's numbers are history, not a dashboard.
  const running = useMemo(() => campaigns.campaigns, [campaigns]);
  const ids = useMemo(() => running.map((c) => c.id).join(","), [running]);

  useEffect(() => {
    if (running.length === 0) {
      setReports({});
      return;
    }
    let live = true;
    setLoading(true);
    setError(null);
    const to = Date.now();
    const from = to - days * 86_400_000;
    void Promise.all(
      running.map(async (c) => [c.id, await loadReport(c.id, from, to)] as const),
    )
      .then((entries) => {
        if (!live) return;
        setReports(Object.fromEntries(entries));
        setLastUpdated(Date.now());
      })
      .catch((err) => live && setError(err instanceof Error ? err.message : "Could not load campaign results."))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the id list, not the objects
  }, [ids, days, nonce, loadReport]);

  const openConfig = () => {
    openMarketingTab("campaigns");
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
            onClick={() => setNonce((n) => n + 1)}
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

      {running.length === 0 && (
        <div className="rounded-2xl bg-white px-4 py-5 ring-1 ring-ink-100 shadow-soft">
          <p className="text-sm text-ink-500">No campaign is running.</p>
          <button
            type="button"
            onClick={openConfig}
            className="mt-1 flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline"
          >
            Set one up in Marketing → Campaigns <ArrowRight className="size-3.5" />
          </button>
        </div>
      )}

      {running.length > 0 && loading && Object.keys(reports).length === 0 && (
        <div className="flex items-center justify-center py-20 text-ink-400">
          <Loader2 className="size-6 animate-spin" />
        </div>
      )}

      {running.map((campaign) => {
        const report = reports[campaign.id];
        if (!report) return null;
        const { totals, rates } = report;
        const treated = Math.max(0, totals.enrollments - totals.holdouts);
        const measurable = rates.holdoutConversionPct !== null;
        const liftTone = !measurable ? "unknown" : (rates.liftPoints ?? 0) > 0 ? "good" : "bad";

        return (
          <div key={campaign.id} className="rounded-2xl bg-white ring-1 ring-ink-100 shadow-soft">
            <CardHeader className="py-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-sm">{campaign.name}</CardTitle>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                    campaign.status === "active"
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-amber-100 text-amber-800",
                  )}
                >
                  {campaign.status}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-ink-400">{campaignTeaser(campaign)}</p>
            </CardHeader>
            <CardBody className="space-y-3 pt-2">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard
                  label="Lift vs holdout"
                  tone={liftTone}
                  value={
                    measurable
                      ? `${(rates.liftPoints ?? 0) > 0 ? "+" : ""}${rates.liftPoints} pts`
                      : "Unmeasurable"
                  }
                  note={
                    measurable
                      ? `${rates.conversionPct}% treated vs ${rates.holdoutConversionPct}% held back`
                      : "No holdout configured — set one to find out what this caused."
                  }
                />
                <StatCard
                  label="Paid out"
                  value={money(totals.cost, baseCurrency)}
                  note={totals.sparks > 0 ? `${fmtNumber(totals.sparks)} ✦ granted` : undefined}
                />
                <StatCard
                  label="Cost per purchase"
                  value={totals.purchases > 0 ? money(rates.costPerPurchase, baseCurrency) : "—"}
                  note={`${fmtNumber(totals.purchases)} purchase${totals.purchases === 1 ? "" : "s"} from ${fmtNumber(treated)} treated`}
                />
                <StatCard
                  label="Return on spend"
                  tone={rates.returnOnSpend === null ? "plain" : rates.returnOnSpend >= 1 ? "good" : "bad"}
                  value={rates.returnOnSpend === null ? "—" : `${rates.returnOnSpend}×`}
                  note={
                    rates.returnOnSpend === null
                      ? "nothing paid out yet"
                      : `${money(totals.revenue, baseCurrency)} revenue against payouts`
                  }
                />
              </div>

              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard label="Enrolled" value={fmtNumber(totals.enrollments)} note={`${fmtNumber(totals.holdouts)} held back`} />
                <StatCard label="Redemptions" value={fmtNumber(totals.redemptions)} />
                <StatCard
                  label="Held for review"
                  tone={totals.held > 0 ? "unknown" : "plain"}
                  value={fmtNumber(totals.held)}
                  note={totals.held > 0 ? "waiting on a decision" : undefined}
                />
                <StatCard
                  label="Clawed back"
                  value={fmtNumber(totals.clawbacks)}
                  note={totals.clawbacks > 0 ? "refunded purchases reversed the payout" : undefined}
                />
              </div>

              {!measurable && totals.cost > 0 && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] leading-relaxed text-amber-800">
                  This campaign has paid out {money(totals.cost, baseCurrency)} and there is no way to tell how much of
                  it changed anything. A holdout of even 5% would make every number above answerable.
                </p>
              )}

              {totals.held > 0 && (
                <button
                  type="button"
                  onClick={openConfig}
                  className="flex items-center gap-1 text-xs font-semibold text-amber-800 hover:underline"
                >
                  {totals.held} payout{totals.held === 1 ? "" : "s"} waiting in Marketing → Campaigns{" "}
                  <ArrowRight className="size-3.5" />
                </button>
              )}
            </CardBody>
          </div>
        );
      })}
    </div>
  );
}
