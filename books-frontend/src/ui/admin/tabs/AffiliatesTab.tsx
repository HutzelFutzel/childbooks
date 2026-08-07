"use client";

/**
 * Admin editor for the **affiliate program** (Rewardful).
 *
 * Deliberately small, because almost nothing about an affiliate program belongs
 * here. Rates, caps, refund windows, payouts and the affiliate accounts
 * themselves live in Rewardful, and a second set of controls for them would just
 * be a second source of truth. This tab owns exactly two things:
 *
 *   1. **The master switch.** Off means we never stamp attribution onto a Stripe
 *      customer, so no commission can be created at all.
 *   2. **The scope map** — which purchase kinds each campaign (or a named
 *      affiliate) may earn on. Rewardful has one rate per campaign and no notion
 *      of our catalog, so this is the one rule it can't express: a printed book
 *      carries production and shipping cost, a digital edition is nearly pure
 *      margin, and Sparks are metered AI spend.
 *
 * Everything else on the page is read-only: the campaign terms as Rewardful
 * reports them, and a setup checklist. Live commission numbers are in
 * Analysis → Affiliates.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, ExternalLink, Loader2, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../components/Button";
import { Toggle } from "../../components/Toggle";
import { useAppConfigStore } from "../../../state/appConfigStore";
import {
  COMMISSIONABLE_KINDS,
  KIND_LABELS,
  rewardfulCampaignUrl,
  scopeFor,
  type AffiliateCampaign,
  type AffiliateConfig,
  type AffiliateOverview,
  type CommissionableKind,
} from "../../../core/config/affiliates";
import { fmtMoney, fmtRelative } from "../analysis/format";
import { Section, TabIntro } from "./products/parts";
import { cn } from "../../lib/cn";
import { useReadOnly } from "../../components/ReadOnlyContext";

function KindChecks({
  selected,
  onChange,
  disabled,
}: {
  selected: CommissionableKind[];
  onChange: (kinds: CommissionableKind[]) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {COMMISSIONABLE_KINDS.map((kind) => {
        const on = selected.includes(kind);
        return (
          <button
            key={kind}
            type="button"
            disabled={disabled}
            onClick={() => onChange(on ? selected.filter((k) => k !== kind) : [...selected, kind])}
            className={cn(
              "rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset transition-colors",
              on
                ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                : "bg-white text-ink-400 ring-ink-200 hover:text-ink-600",
              disabled && "cursor-not-allowed opacity-50",
            )}
          >
            {KIND_LABELS[kind]}
          </button>
        );
      })}
    </div>
  );
}

/** One line of the setup checklist. */
function CheckLine({ ok, label, hint }: { ok: boolean; label: string; hint?: string }) {
  return (
    <div className="flex items-start gap-2">
      {ok ? (
        <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
      ) : (
        <X className="mt-0.5 size-3.5 shrink-0 text-rose-500" />
      )}
      <div className="min-w-0">
        <div className={cn("text-xs font-medium", ok ? "text-ink-700" : "text-ink-500")}>{label}</div>
        {hint && <p className="text-[11px] leading-relaxed text-ink-400">{hint}</p>}
      </div>
    </div>
  );
}

/** The campaign's own terms, as Rewardful reports them — read-only on purpose. */
function campaignTerms(c: AffiliateOverview["campaigns"][number]): string {
  const rate =
    c.rewardType === "amount"
      ? fmtMoney((c.commissionAmountCents ?? 0) / 100, c.commissionAmountCurrency)
      : `${c.commissionPercent ?? 0}%`;
  const parts = [`${rate} per sale`];
  if (c.maxCommissions) parts.push(`first ${c.maxCommissions} payment(s)`);
  else if (c.maxCommissionPeriodMonths) parts.push(`${c.maxCommissionPeriodMonths} months`);
  else parts.push("recurring, uncapped");
  if (c.daysUntilCommissionsAreDue != null) parts.push(`${c.daysUntilCommissionsAreDue}d hold`);
  if (c.minimumPayoutCents) {
    parts.push(`min payout ${fmtMoney(c.minimumPayoutCents / 100, c.minimumPayoutCurrency)}`);
  }
  return parts.join(" · ");
}

export function AffiliatesTab() {
  const readOnly = useReadOnly();
  const loadOverview = useAppConfigStore((s) => s.loadAffiliateOverview);
  const saveConfig = useAppConfigStore((s) => s.saveAffiliateConfig);
  const sync = useAppConfigStore((s) => s.syncAffiliates);

  const [overview, setOverview] = useState<AffiliateOverview | null>(null);
  const [draft, setDraft] = useState<AffiliateConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(
    async (ping = false) => {
      setLoading(true);
      try {
        const next = await loadOverview(ping);
        setOverview(next);
        setDraft(next.config);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not load the affiliate program.");
      } finally {
        setLoading(false);
      }
    },
    [loadOverview],
  );

  useEffect(() => {
    void refresh(true);
  }, [refresh]);

  if (loading && !draft) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-ink-400">
        <Loader2 className="size-4 animate-spin" /> Loading affiliate program…
      </div>
    );
  }
  if (!draft || !overview) return null;

  const readiness = overview.readiness;
  const dirty = JSON.stringify(draft) !== JSON.stringify(overview.config);
  // Campaigns we've scoped that Rewardful no longer reports — usually a campaign
  // renamed/recreated upstream, which would silently earn nothing.
  const orphanScopes = draft.campaigns.filter((c) => !overview.campaigns.some((m) => m.id === c.id));

  function setCampaignKinds(id: string, label: string, kinds: CommissionableKind[]) {
    setDraft((prev) => {
      if (!prev) return prev;
      const existing = prev.campaigns.find((c) => c.id === id);
      const campaigns: AffiliateCampaign[] = existing
        ? prev.campaigns.map((c) => (c.id === id ? { ...c, label, kinds } : c))
        : [...prev.campaigns, { id, label, kinds }];
      return { ...prev, campaigns };
    });
  }

  function setOverrideKinds(affiliateId: string, kinds: CommissionableKind[] | null) {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = { ...prev.affiliateOverrides };
      if (kinds === null) delete next[affiliateId];
      else next[affiliateId] = kinds;
      return { ...prev, affiliateOverrides: next };
    });
  }

  async function onSave() {
    setBusy(true);
    try {
      await saveConfig(draft!);
      await refresh();
      toast.success("Affiliate program saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  async function onSync() {
    setSyncing(true);
    try {
      const status = await sync();
      toast.success(
        `Synced ${status.commissions} commission(s) across ${status.partners} affiliate(s).`,
      );
      await refresh(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-4">
      <TabIntro
        elsewhere="Commission rates, refund windows, payout thresholds and the affiliates themselves are managed in Rewardful — this tab only decides what each campaign is allowed to earn on. Live numbers are under Analysis → Affiliates."
      >
        Affiliates are paid by Rewardful out of Stripe charges. Rewardful applies one rate per campaign
        and knows nothing about our catalog, so the scope map below is what keeps a print campaign from
        earning on Spark packs: anything out of scope is stamped as non-commissionable before the charge.
      </TabIntro>

      <Section
        title="Setup"
        hint="Every line has to pass before a single commission can be created."
        action={
          readOnly ? undefined : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void onSync()}
              disabled={syncing || !readiness.apiConfigured}
            >
              {syncing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              Sync now
            </Button>
          )
        }
      >
        <div className="grid gap-2.5 sm:grid-cols-2">
          <CheckLine
            ok={readiness.apiConfigured}
            label="API secret configured"
            hint="REWARDFUL_API_SECRET in Secret Manager (yarn setSecrets)."
          />
          <CheckLine
            ok={readiness.apiReachable !== false && readiness.apiConfigured}
            label="Rewardful reachable"
            hint={readiness.apiError ?? "Verified against the campaigns endpoint on load."}
          />
          <CheckLine
            ok={readiness.webhookConfigured}
            label="Webhook token set"
            hint={
              overview.webhook.configured
                ? `Register: ${overview.webhook.url}`
                : "REWARDFUL_WEBHOOK_TOKEN is unset — the webhook endpoint refuses every delivery."
            }
          />
          <CheckLine
            ok={readiness.liveEnv}
            label="Stripe in live mode"
            hint="Rewardful ignores Stripe test-mode events, so attribution is inert in sandbox."
          />
        </div>
        <div className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2.5 ring-1 ring-inset ring-ink-100">
          <div className="min-w-0">
            <div className="text-sm font-medium text-ink-700">Program enabled</div>
            <p className="text-[11px] leading-relaxed text-ink-400">
              Off means no referral is ever written onto a Stripe customer, so nothing can earn —
              the safest way to pause the program without touching Rewardful.
            </p>
          </div>
          <Toggle
            checked={draft.enabled}
            onChange={(enabled) => setDraft({ ...draft, enabled })}
            label="Program enabled"
          />
        </div>
        <p className="text-[11px] text-ink-400">
          Last sync {fmtRelative(overview.sync.lastOkAt)}
          {overview.sync.lastError ? ` · last error: ${overview.sync.lastError}` : ""}
        </p>
      </Section>

      <Section
        title="Campaign scope"
        hint="What each Rewardful campaign may earn a commission on. A campaign with nothing selected earns nothing."
      >
        {overview.campaigns.length === 0 ? (
          <p className="text-xs text-ink-400">
            No campaigns mirrored yet. Create them in Rewardful, then press “Sync now”.
          </p>
        ) : (
          <div className="space-y-2.5">
            {overview.campaigns.map((c) => {
              const kinds = draft.campaigns.find((x) => x.id === c.id)?.kinds ?? [];
              return (
                <div key={c.id} className="space-y-2 rounded-lg bg-white p-3 ring-1 ring-inset ring-ink-100">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-sm font-medium text-ink-800">
                        {c.name || c.id}
                        {c.isDefault && (
                          <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[10px] text-ink-500">
                            default
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-ink-400">{campaignTerms(c)}</p>
                    </div>
                    <a
                      href={rewardfulCampaignUrl(c.id)}
                      target="_blank"
                      rel="noreferrer"
                      className="flex shrink-0 items-center gap-1 text-[11px] text-brand-600 hover:underline"
                    >
                      Rewardful <ExternalLink className="size-3" />
                    </a>
                  </div>
                  <KindChecks
                    selected={kinds}
                    onChange={(next) => setCampaignKinds(c.id, c.name, next)}
                    disabled={readOnly}
                  />
                  {kinds.length === 0 && (
                    <p className="text-[11px] text-amber-700">
                      Nothing selected — affiliates in this campaign earn nothing.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {orphanScopes.length > 0 && (
          <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] leading-relaxed text-amber-800">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <div>
              {orphanScopes.length} scoped campaign(s) no longer exist in Rewardful (
              {orphanScopes.map((c) => c.label || c.id).join(", ")}). They can never match a referral —
              remove them by clearing their kinds, or re-sync if this looks wrong.
            </div>
          </div>
        )}
      </Section>

      <Section
        title="Per-affiliate exceptions"
        hint="Overrides one affiliate's scope instead of their campaign's — for the one-off deal that shouldn't need a whole new campaign."
      >
        {overview.partners.length === 0 ? (
          <p className="text-xs text-ink-400">No affiliates yet.</p>
        ) : (
          <div className="space-y-2">
            {overview.partners.map((p) => {
              const override = draft.affiliateOverrides[p.id];
              const effective = scopeFor(draft, { affiliateId: p.id, campaignId: p.campaignId });
              return (
                <div
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 ring-1 ring-inset ring-ink-100"
                >
                  <div className="min-w-0">
                    <div className="text-sm text-ink-800">{p.name || p.email || p.id}</div>
                    <p className="text-[11px] text-ink-400">
                      {p.campaignName ?? "no campaign"} ·{" "}
                      {override
                        ? "custom scope"
                        : `campaign scope (${effective.map((k) => KIND_LABELS[k]).join(", ") || "nothing"})`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {override && (
                      <KindChecks selected={override} onChange={(k) => setOverrideKinds(p.id, k)} disabled={readOnly} />
                    )}
                    {!readOnly && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setOverrideKinds(p.id, override ? null : effective)}
                      >
                        {override ? "Use campaign" : "Override"}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {!readOnly && (
        <div className="flex items-center gap-2">
          <Button onClick={() => void onSave()} disabled={busy || !dirty}>
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            Save affiliate program
          </Button>
          {dirty && <span className="text-[11px] text-amber-700">Unsaved changes</span>}
        </div>
      )}
    </div>
  );
}
