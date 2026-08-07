"use client";

/**
 * Affiliate program metrics — what the program is costing, who's earning it, and
 * whether the money is going out on things it was supposed to.
 *
 * Read entirely from the local Rewardful mirror (refreshed by webhook and a
 * nightly reconcile), so opening this tab costs nothing against Rewardful's rate
 * limit and every commission is already joined to the payment it came from — the
 * one thing Rewardful's own dashboard can't show.
 *
 * Amounts are USD, converted once at mirror time with the admin FX table, so
 * multi-currency commissions add up to a single comparable number. The original
 * amount and currency stay on each row.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../components/Button";
import { CardBody, CardHeader, CardTitle } from "../../components/Card";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { useAdminTab } from "../adminTabStore";
import {
  KIND_LABELS,
  rewardfulAffiliateUrl,
  REWARDFUL_APP_URL,
  type AffiliateCommissionMirror,
  type AffiliateOverview,
} from "../../../core/config/affiliates";
import { fmtDateTime, fmtMoney, fmtNumber, fmtRelative, fmtUsd } from "./format";
import { cn } from "../../lib/cn";

/** The four commission states, in the order money moves through them. */
const STATES: { id: string; label: string; hint: string }[] = [
  { id: "pending", label: "Pending", hint: "Inside the refund window — not owed yet." },
  { id: "due", label: "Due", hint: "Survived the refund window; owed at the next payout." },
  { id: "paid", label: "Paid", hint: "Already paid out to the affiliate." },
  { id: "voided", label: "Voided", hint: "Cancelled (usually a refund) — costs nothing." },
];

function Kpi({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "warn" | "good";
}) {
  return (
    <div className="rounded-lg bg-white p-3 ring-1 ring-inset ring-ink-100">
      <div className="text-[11px] uppercase tracking-wide text-ink-400">{label}</div>
      <div
        className={cn(
          "mt-0.5 text-lg font-semibold tabular-nums",
          tone === "warn" ? "text-rose-600" : tone === "good" ? "text-emerald-600" : "text-ink-800",
        )}
      >
        {value}
      </div>
      {hint && <p className="mt-0.5 text-[11px] leading-relaxed text-ink-400">{hint}</p>}
    </div>
  );
}

function StateBadge({ state }: { state: string }) {
  const tone =
    state === "paid"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : state === "due"
        ? "bg-amber-50 text-amber-700 ring-amber-200"
        : state === "voided"
          ? "bg-ink-100 text-ink-500 ring-ink-200"
          : "bg-brand-50 text-brand-700 ring-brand-200";
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset", tone)}>
      {state}
    </span>
  );
}

function CommissionRows({ rows }: { rows: AffiliateCommissionMirror[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-ink-400">
            <th className="py-1.5 pr-3 font-medium">When</th>
            <th className="py-1.5 pr-3 font-medium">Affiliate</th>
            <th className="py-1.5 pr-3 font-medium">Bought</th>
            <th className="py-1.5 pr-3 text-right font-medium">Sale</th>
            <th className="py-1.5 pr-3 text-right font-medium">Commission</th>
            <th className="py-1.5 pr-3 font-medium">State</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="border-t border-ink-100">
              <td className="py-1.5 pr-3 whitespace-nowrap text-ink-500">
                {fmtDateTime(c.chargedAt ?? c.createdAt)}
              </td>
              <td className="py-1.5 pr-3">
                <div className="text-ink-800">{c.affiliateName ?? "—"}</div>
                <div className="text-[10px] text-ink-400">{c.campaignName ?? "—"}</div>
              </td>
              <td className="py-1.5 pr-3">
                {c.purchaseKind ? (
                  <span className={cn(c.inScope === false && "text-rose-600")}>
                    {KIND_LABELS[c.purchaseKind]}
                  </span>
                ) : (
                  <span className="text-ink-400" title="No matching payment on our side">
                    unmatched
                  </span>
                )}
              </td>
              <td className="py-1.5 pr-3 text-right tabular-nums text-ink-500">
                {c.saleAmountCents != null
                  ? fmtMoney(c.saleAmountCents / 100, c.saleCurrency ?? c.currency)
                  : "—"}
              </td>
              <td className="py-1.5 pr-3 text-right tabular-nums text-ink-800">
                {fmtMoney(c.amountCents / 100, c.currency)}
              </td>
              <td className="py-1.5 pr-3">
                <StateBadge state={c.state} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AffiliatesAnalysis() {
  const loadOverview = useAppConfigStore((s) => s.loadAffiliateOverview);
  const sync = useAppConfigStore((s) => s.syncAffiliates);
  const openMarketingTab = useAdminTab((s) => s.openMarketingTab);

  const [overview, setOverview] = useState<AffiliateOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setOverview(await loadOverview());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load affiliate metrics.");
    } finally {
      setLoading(false);
    }
  }, [loadOverview]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onSync() {
    setSyncing(true);
    try {
      const status = await sync();
      toast.success(`Synced ${status.commissions} commission(s).`);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  if (loading && !overview) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-ink-400">
        <Loader2 className="size-4 animate-spin" /> Loading affiliate metrics…
      </div>
    );
  }
  if (!overview) return null;

  const due = overview.byState.due?.usd ?? 0;
  const pending = overview.byState.pending?.usd ?? 0;
  const paid = overview.byState.paid?.usd ?? 0;
  const totalCommissions = STATES.reduce((sum, s) => sum + (overview.byState[s.id]?.count ?? 0), 0);
  const activePayouts = overview.payouts.filter((p) => p.state !== "paid");

  return (
    <div className="space-y-4">
      {!overview.readiness.enabled && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs leading-relaxed text-amber-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div>
            The affiliate program is switched off, so no new attribution is being recorded. Anything
            below is history.{" "}
            <button className="underline" onClick={() => openMarketingTab("affiliates")}>
              Open the program settings
            </button>
            .
          </div>
        </div>
      )}

      {overview.outOfScope.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-xs leading-relaxed text-rose-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div>
            <strong>{overview.outOfScope.length} commission(s) were created outside the scope map.</strong>{" "}
            Suppression should have prevented these, so either the scope map drifted from Rewardful or a
            checkout path isn't stamping. They're listed at the bottom of this page.
          </div>
        </div>
      )}

      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Due now" value={fmtUsd(due)} hint="Owed at the next payout run." tone="warn" />
        <Kpi label="Pending" value={fmtUsd(pending)} hint="Still inside the refund window." />
        <Kpi label="Paid to date" value={fmtUsd(paid)} hint="Already out the door." />
        <Kpi
          label="Commissions"
          value={fmtNumber(totalCommissions)}
          hint={`${overview.partners.filter((p) => p.state === "active").length} active affiliate(s)`}
        />
      </div>

      <div className="rounded-xl bg-white ring-1 ring-inset ring-ink-100">
        <CardHeader>
          <CardTitle>Affiliates</CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-ink-400">synced {fmtRelative(overview.sync.lastOkAt)}</span>
            <Button variant="ghost" size="sm" onClick={() => void onSync()} disabled={syncing}>
              {syncing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              Sync
            </Button>
            <a
              href={REWARDFUL_APP_URL}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-[11px] text-brand-600 hover:underline"
            >
              Rewardful <ExternalLink className="size-3" />
            </a>
          </div>
        </CardHeader>
        <CardBody>
          {overview.partners.length === 0 ? (
            <p className="text-xs text-ink-400">No affiliates yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-ink-400">
                    <th className="py-1.5 pr-3 font-medium">Affiliate</th>
                    <th className="py-1.5 pr-3 font-medium">Campaign</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Visitors</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Conversions</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Due</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Paid</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Sales</th>
                    <th className="py-1.5 pr-3" />
                  </tr>
                </thead>
                <tbody>
                  {overview.partners.map((p) => (
                    <tr key={p.id} className="border-t border-ink-100">
                      <td className="py-1.5 pr-3">
                        <div className={cn("text-ink-800", p.state !== "active" && "text-ink-400 line-through")}>
                          {p.name || p.email || p.id}
                        </div>
                        <div className="text-[10px] text-ink-400">
                          {p.links.map((l) => l.token).filter(Boolean).join(", ") || p.email}
                        </div>
                      </td>
                      <td className="py-1.5 pr-3 text-ink-500">{p.campaignName ?? "—"}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-ink-500">
                        {fmtNumber(p.visitors)}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-ink-500">
                        {fmtNumber(p.conversions)}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-amber-700">
                        {fmtUsd(p.totals.dueUsd)}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-ink-700">
                        {fmtUsd(p.totals.paidUsd)}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-ink-500">
                        {fmtUsd(p.totals.salesUsd)}
                      </td>
                      <td className="py-1.5 pr-3 text-right">
                        <a
                          href={rewardfulAffiliateUrl(p.id)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-brand-600 hover:underline"
                        >
                          open
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </div>

      <div className="rounded-xl bg-white ring-1 ring-inset ring-ink-100">
        <CardHeader>
          <CardTitle>Recent commissions</CardTitle>
          <span className="text-[11px] text-ink-400">
            joined to our payments — “unmatched” means no charge of ours could be found
          </span>
        </CardHeader>
        <CardBody>
          {overview.recentCommissions.length === 0 ? (
            <p className="text-xs text-ink-400">No commissions yet.</p>
          ) : (
            <CommissionRows rows={overview.recentCommissions} />
          )}
        </CardBody>
      </div>

      {activePayouts.length > 0 && (
        <div className="rounded-xl bg-white ring-1 ring-inset ring-ink-100">
          <CardHeader>
            <CardTitle>Open payouts</CardTitle>
            <span className="text-[11px] text-ink-400">paid from Rewardful, never from here</span>
          </CardHeader>
          <CardBody>
            <div className="space-y-1.5">
              {activePayouts.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-ink-700">{p.affiliateName ?? p.affiliateId ?? "—"}</span>
                  <span className="text-ink-400">
                    {p.commissionCount} commission(s) · <StateBadge state={p.state} />
                  </span>
                  <span className="tabular-nums text-ink-800">{fmtMoney(p.amountCents / 100, p.currency)}</span>
                </div>
              ))}
            </div>
          </CardBody>
        </div>
      )}

      {overview.outOfScope.length > 0 && (
        <div className="rounded-xl bg-white ring-1 ring-inset ring-rose-200">
          <CardHeader>
            <CardTitle>Out-of-scope commissions</CardTitle>
            <span className="text-[11px] text-rose-600">these should not exist</span>
          </CardHeader>
          <CardBody>
            <CommissionRows rows={overview.outOfScope} />
          </CardBody>
        </div>
      )}
    </div>
  );
}
