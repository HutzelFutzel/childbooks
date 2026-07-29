"use client";

/**
 * Admin editor for the **referral program** (`appConfig/referral`).
 *
 * Three panels:
 *   1. Program config — master switch, reward rules, limits, eligibility, copy.
 *   2. Business impact — worst-case cost of the whole ladder, using the same
 *      engines as the rest of the admin (grantLiabilityUsd + discountImpact).
 *   3. Held payouts — rewards a limit or a failed delivery stopped, waiting on
 *      a human. Live funnel stats (invites → accept → purchase) moved to
 *      Analysis → Referrals, since they're a metrics view, not a setting.
 *
 * Saving is refused when the impact engine raises a `block` warning (e.g. a
 * Spark reward on a pre-payment trigger, or a free-month rule without the
 * subscriber gate). Soft warnings still save, but they're loud.
 */
import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, AlertTriangle, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../components/Button";
import { Field, Input, Textarea } from "../../components/Input";
import { Select } from "../../components/Select";
import { Toggle } from "../../components/Toggle";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { useAdminTab } from "../adminTabStore";
import {
  MAX_REWARD_RULES,
  TRIGGERS,
  TRIGGER_META,
  createRewardRule,
  describeReward,
  freezeTerms,
  inviteTeaser,
  rewardAllowedForSide,
  rewardAllowedForTrigger,
  type DiscountReward,
  type FreeMonthsReward,
  type HeldRewardView,
  type ReferralConfig,
  type ReferralStatsSummary,
  type Reward,
  type RewardKind,
  type RewardRule,
  type RewardSide,
  type RewardTrigger,
  type SparksReward,
} from "../../../core/config/referral";
import { impactBlocks, referralImpact } from "../../../core/config/referralImpact";
import type { DiscountItemType } from "../../../core/config/discountImpact";
import type { ProductDefinition } from "../../../core/config/products";
import { Grid, ImpactNote, NumberField, Section, TabIntro, fmtMoney } from "./products/parts";

const KIND_OPTIONS: { value: RewardKind | "none"; label: string }[] = [
  { value: "none", label: "Nothing" },
  { value: "sparks", label: "Sparks" },
  { value: "discount", label: "Discount %" },
  { value: "freeMonths", label: "Free months" },
];

const ITEM_OPTIONS: { value: DiscountItemType; label: string }[] = [
  { value: "print", label: "Printed books" },
  { value: "ebook", label: "Digital edition" },
  { value: "pack", label: "Spark packs" },
  { value: "plan", label: "Membership" },
];

/**
 * A switch with the visible label + one-line explanation the bare `Toggle`
 * doesn't render (its `label` is the accessible name only). Every switch on this
 * tab changes money or who can spend it, so none of them ship unlabelled.
 */
function SwitchField({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Toggle checked={checked} onChange={onChange} disabled={disabled} label={label} />
      <div className="min-w-0">
        <div className="text-sm font-medium text-ink-700">{label}</div>
        {hint && <p className="text-[11px] leading-relaxed text-ink-400">{hint}</p>}
      </div>
    </div>
  );
}

function defaultReward(kind: RewardKind): Reward {
  switch (kind) {
    case "sparks":
      return { kind: "sparks", sparks: 50 };
    case "discount":
      return { kind: "discount", percentOff: 15, appliesTo: ["print", "ebook", "pack", "plan"], expiresInDays: 60 };
    case "freeMonths":
      return { kind: "freeMonths", months: 1 };
  }
}

export function ReferralsTab() {
  const stored = useAppConfigStore((s) => s.referral);
  const loadReferralConfig = useAppConfigStore((s) => s.loadReferralConfig);
  const save = useAppConfigStore((s) => s.saveReferralConfig);
  const loadStats = useAppConfigStore((s) => s.loadReferralStats);
  const voidUnaccepted = useAppConfigStore((s) => s.voidUnacceptedInvitations);
  const sparks = useAppConfigStore((s) => s.sparks);
  const settings = useAppConfigStore((s) => s.pricingSettings);
  const plans = useAppConfigStore((s) => s.plans.plans);
  const loadAdminProducts = useAppConfigStore((s) => s.loadAdminProducts);
  const setConfigTab = useAdminTab((s) => s.setConfigTab);
  const openAnalysis = useAdminTab((s) => s.openAnalysis);

  const [draft, setDraft] = useState<ReferralConfig>(stored);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<ProductDefinition[]>([]);
  // Only held.length matters here — the full funnel view lives in Analysis → Referrals.
  const [stats, setStats] = useState<ReferralStatsSummary | null>(null);
  const [voiding, setVoiding] = useState(false);

  useEffect(() => {
    let live = true;
    void loadReferralConfig()
      .then((cfg) => {
        if (!live) return;
        if (!dirty) setDraft(cfg);
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : "Could not load referral config."))
      .finally(() => live && setLoading(false));
    void loadAdminProducts()
      .then((cfg) => live && setProducts(cfg.products))
      .catch(() => {
        /* impact panel skips print rows */
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount
  }, [loadReferralConfig, loadAdminProducts]);

  useEffect(() => {
    if (!dirty) setDraft(stored);
  }, [stored, dirty]);

  useEffect(() => {
    void loadStats()
      .then(setStats)
      .catch(() => setStats(null));
  }, [loadStats]);

  const set = (patch: Partial<ReferralConfig>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
  };

  const setRule = (id: string, patch: Partial<RewardRule>) => {
    setDraft((d) => ({
      ...d,
      rules: d.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }));
    setDirty(true);
  };

  const impact = useMemo(
    () =>
      referralImpact({
        referral: draft,
        sparks,
        settings,
        products,
        plans,
      }),
    [draft, sparks, settings, products, plans],
  );
  const blockers = impactBlocks(impact);
  const terms = freezeTerms(draft);

  const onSave = async () => {
    if (blockers.length > 0) {
      toast.error(blockers[0].message);
      return;
    }
    setSaving(true);
    try {
      await save(draft);
      setDirty(false);
      toast.success("Referral program saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  const onVoidUnaccepted = async () => {
    if (
      !window.confirm(
        "Void every still-unaccepted invitation? Accepted invitations stay honored. This cannot be undone.",
      )
    ) {
      return;
    }
    setVoiding(true);
    try {
      const n = await voidUnaccepted("voided by admin from Referrals tab");
      toast.success(n === 0 ? "No pending invitations to void." : `Voided ${n} invitation${n === 1 ? "" : "s"}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not void invitations.");
    } finally {
      setVoiding(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-ink-400">Loading referral program…</p>;
  }

  return (
    <div className="space-y-4">
      <TabIntro
        elsewhere={
          <>
            Reward economics depend on the Sparks peg and the catalog&apos;s margins — those live under Sparks economy
            and Discount planner.
          </>
        }
        links={[
          { label: "Sparks economy", onClick: () => setConfigTab("sparks") },
          { label: "Discount planner", onClick: () => setConfigTab("discounts") },
        ]}
      >
        Configure who gets what, and when, for inviting a friend. Terms freeze onto each invitation when it&apos;s sent,
        so changing this later never rewrites a promise already made. Cash-equivalent rewards (Sparks, free months) are
        only available after the invited person has paid — otherwise throwaway accounts farm the program.
      </TabIntro>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <SwitchField
          checked={draft.enabled}
          onChange={(v) => set({ enabled: v })}
          label="Referral program enabled"
          hint="Whether people can send new invitations at all."
        />
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" loading={voiding} onClick={() => void onVoidUnaccepted()}>
            Void unaccepted invites
          </Button>
          <Button type="button" size="sm" loading={saving} disabled={!dirty || blockers.length > 0} onClick={() => void onSave()}>
            Save
          </Button>
        </div>
      </div>

      {!draft.enabled && (
        <ImpactNote>
          The program is <span className="font-semibold">off</span>. No new invitations will be created; invitations
          already accepted still pay out under their frozen terms.
        </ImpactNote>
      )}

      {!sparks.enabled && draft.enabled && (
        <ImpactNote>
          The Sparks economy is disabled, so Spark rewards can&apos;t be granted — they&apos;ll pile up under Held
          payouts until it&apos;s back on. Turn it on under{" "}
          <button type="button" className="font-semibold underline" onClick={() => setConfigTab("sparks")}>
            Sparks economy
          </button>{" "}
          before enabling referrals that grant Sparks.
        </ImpactNote>
      )}

      <Section
        title="What people see"
        hint="Headline and subline on the invite screen. The benefit line itself is derived from the rules below so the promise can't drift from the payout."
      >
        <div className="space-y-2.5">
          <Field label="Headline">
            <Input
              value={draft.presentation.headline}
              maxLength={120}
              onChange={(e) =>
                set({ presentation: { ...draft.presentation, headline: e.target.value } })
              }
            />
          </Field>
          <Field label="Subline">
            <Textarea
              value={draft.presentation.subline}
              maxLength={300}
              rows={2}
              onChange={(e) =>
                set({ presentation: { ...draft.presentation, subline: e.target.value } })
              }
            />
          </Field>
        </div>
        <p className="text-[11px] text-ink-500">
          Live teaser: <span className="font-medium text-ink-700">{inviteTeaser(terms)}</span>
          {terms.referrerSummary || terms.referredSummary ? (
            <>
              {" "}
              · They get <span className="font-medium">{terms.referredSummary || "—"}</span>
              {" · "}
              You get <span className="font-medium">{terms.referrerSummary || "—"}</span>
            </>
          ) : null}
        </p>
      </Section>

      <Section
        title="Reward schedule"
        hint="Each rule fires once per invitation when its trigger happens. Pre-payment triggers can only award discounts. Free months are referrer-only and require an active subscription."
        action={
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={draft.rules.length >= MAX_REWARD_RULES}
            onClick={() => set({ rules: [...draft.rules, createRewardRule()] })}
          >
            <Plus className="size-3.5" /> Add rule
          </Button>
        }
      >
        <div className="space-y-3">
          {draft.rules.map((rule) => (
            <RuleEditor
              key={rule.id}
              rule={rule}
              onChange={(patch) => setRule(rule.id, patch)}
              onRemove={() => {
                set({ rules: draft.rules.filter((r) => r.id !== rule.id) });
              }}
            />
          ))}
          {draft.rules.length === 0 && (
            <p className="text-xs text-ink-400">No rules yet — add one to define what both sides earn.</p>
          )}
        </div>
      </Section>

      <Section title="Who may invite" hint="The strongest anti-farming switch is requiring the sender to have paid at least once.">
        <div className="grid gap-2.5 sm:grid-cols-2">
          <SwitchField
            checked={draft.eligibility.senderMustBeVerified}
            onChange={(v) => set({ eligibility: { ...draft.eligibility, senderMustBeVerified: v } })}
            label="Sender must verify email"
            hint="Unverified accounts can't send invitations — their personal link still works."
          />
          <SwitchField
            checked={draft.eligibility.senderMustHavePurchased}
            onChange={(v) => set({ eligibility: { ...draft.eligibility, senderMustHavePurchased: v } })}
            label="Sender must have purchased"
            hint="Only paying customers may invite. The strongest anti-farming gate, at the cost of reach."
          />
        </div>
      </Section>

      <Section title="Limits & expiry" hint="Caps and clocks that keep the liability bounded. The daily budget pauses payouts and alerts when crossed.">
        <Grid cols={3}>
          <NumberField
            label="Invites / user / day"
            value={draft.limits.invitesPerUserPerDay}
            step="1"
            onChange={(n) => set({ limits: { ...draft.limits, invitesPerUserPerDay: Math.max(1, n) } })}
          />
          <NumberField
            label="Invites / user / month"
            value={draft.limits.invitesPerUserPerMonth}
            step="1"
            onChange={(n) => set({ limits: { ...draft.limits, invitesPerUserPerMonth: Math.max(1, n) } })}
          />
          <NumberField
            label="Max rewarded referrals / user"
            value={draft.limits.maxRewardedReferralsPerUser}
            step="1"
            onChange={(n) => set({ limits: { ...draft.limits, maxRewardedReferralsPerUser: Math.max(1, n) } })}
          />
          <NumberField
            label="Email invite expiry (days)"
            value={draft.limits.invitationExpiryDays}
            step="1"
            onChange={(n) => set({ limits: { ...draft.limits, invitationExpiryDays: Math.max(1, n) } })}
          />
          <NumberField
            label="Share-link expiry (days)"
            value={draft.limits.linkExpiryDays}
            step="1"
            onChange={(n) => set({ limits: { ...draft.limits, linkExpiryDays: Math.max(1, n) } })}
          />
          <NumberField
            label={`Daily payout budget (${settings.baseCurrency})`}
            value={draft.limits.dailyBudgetAmount}
            step="10"
            suffix={settings.baseCurrency}
            onChange={(n) => set({ limits: { ...draft.limits, dailyBudgetAmount: Math.max(0, n) } })}
          />
        </Grid>
      </Section>

      <ImpactPanel impact={impact} baseCurrency={settings.baseCurrency} />

      <HeldRewardsPanel
        held={stats?.held ?? []}
        baseCurrency={settings.baseCurrency}
        onResolved={() => void loadStats().then(setStats).catch(() => {})}
      />

      <ImpactNote>
        Looking for invite funnel numbers (sent → accepted → purchased) or the top-inviters leaderboard? They moved to{" "}
        <button
          type="button"
          className="font-semibold underline"
          onClick={() => openAnalysis("referrals")}
        >
          Analysis → Referrals
        </button>
        .
      </ImpactNote>
    </div>
  );
}

// ---- Rule editor ------------------------------------------------------------

function RuleEditor({
  rule,
  onChange,
  onRemove,
}: {
  rule: RewardRule;
  onChange: (patch: Partial<RewardRule>) => void;
  onRemove: () => void;
}) {
  const meta = TRIGGER_META[rule.trigger];
  return (
    <div className="space-y-2.5 rounded-lg bg-white p-3 ring-1 ring-inset ring-ink-100">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Toggle checked={rule.enabled} onChange={(v) => onChange({ enabled: v })} label="Rule enabled" />
          <span className="text-sm text-ink-600">{rule.enabled ? "Active" : "Paused"}</span>
          <Select
            value={rule.trigger}
            options={TRIGGERS.map((t) => ({ value: t.id, label: t.label }))}
            onChange={(e) => {
              const trigger = e.target.value as RewardTrigger;
              // Drop rewards the new trigger can't issue.
              const scrub = (reward: Reward | null, side: RewardSide): Reward | null => {
                if (!reward) return null;
                if (!rewardAllowedForTrigger(trigger, reward.kind)) return null;
                if (!rewardAllowedForSide(side, reward.kind)) return null;
                return reward;
              };
              onChange({
                trigger,
                referrer: scrub(rule.referrer, "referrer"),
                referred: scrub(rule.referred, "referred"),
              });
            }}
            className="min-w-48"
          />
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="rounded p-1 text-ink-400 transition hover:bg-ink-50 hover:text-ink-700"
          title="Remove rule"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
      <p className="text-[11px] text-ink-400">{meta.description}</p>
      {meta.prePayment && (
        <p className="flex items-start gap-1.5 text-[11px] text-amber-700">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" />
          Pre-payment trigger — only discounts are allowed (no Sparks or free months).
        </p>
      )}

      <Grid cols={2}>
        <SideRewardEditor
          label="Referrer gets"
          side="referrer"
          trigger={rule.trigger}
          reward={rule.referrer}
          onChange={(reward) =>
            onChange({
              referrer: reward,
              // Free months are only ever safe for someone already paying us, and
              // the impact engine refuses to save without that gate — so picking
              // the reward turns it on rather than leaving an unsavable rule.
              ...(reward?.kind === "freeMonths"
                ? { conditions: { ...rule.conditions, referrerMustBeSubscriber: true } }
                : {}),
            })
          }
        />
        <SideRewardEditor
          label="Referred person gets"
          side="referred"
          trigger={rule.trigger}
          reward={rule.referred}
          onChange={(reward) => onChange({ referred: reward })}
        />
      </Grid>

      <div className="space-y-2.5 border-t border-ink-100 pt-2">
        <div className="flex flex-wrap gap-3">
          {(rule.trigger === "first_purchase" ||
            rule.trigger === "subscription_started" ||
            rule.trigger === "subscription_renewed") && (
            <NumberField
              label="Min purchase amount"
              value={rule.conditions.minPurchaseAmount}
              step="1"
              onChange={(n) =>
                onChange({ conditions: { ...rule.conditions, minPurchaseAmount: Math.max(0, n) } })
              }
            />
          )}
          {rule.trigger === "subscription_renewed" && (
            <NumberField
              label="Which invoice #"
              value={rule.conditions.nthInvoice}
              step="1"
              onChange={(n) =>
                onChange({ conditions: { ...rule.conditions, nthInvoice: Math.max(2, Math.round(n)) } })
              }
            />
          )}
        </div>
        <div className="grid gap-2.5 sm:grid-cols-2">
          <SwitchField
            checked={rule.conditions.referredMustBeVerified}
            onChange={(v) => onChange({ conditions: { ...rule.conditions, referredMustBeVerified: v } })}
            label="Referred must be verified"
            hint="Hold this rule's payout until the invited person has confirmed their email."
          />
          <SwitchField
            checked={rule.conditions.referrerMustBeSubscriber}
            onChange={(v) => onChange({ conditions: { ...rule.conditions, referrerMustBeSubscriber: v } })}
            label="Referrer must be a member"
            disabled={rule.referrer?.kind === "freeMonths"}
            hint={
              rule.referrer?.kind === "freeMonths"
                ? "Required for free months — there's no invoice to discount otherwise."
                : "Only pay the inviter while they have an active membership."
            }
          />
        </div>
      </div>
    </div>
  );
}

function SideRewardEditor({
  label,
  side,
  trigger,
  reward,
  onChange,
}: {
  label: string;
  side: RewardSide;
  trigger: RewardTrigger;
  reward: Reward | null;
  onChange: (reward: Reward | null) => void;
}) {
  const kind = (reward?.kind ?? "none") as RewardKind | "none";
  const allowed = KIND_OPTIONS.filter(
    (o) =>
      o.value === "none" ||
      (rewardAllowedForTrigger(trigger, o.value) && rewardAllowedForSide(side, o.value)),
  );

  return (
    <div className="space-y-2 rounded-md bg-ink-50/60 p-2.5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">{label}</div>
      <Select
        value={kind}
        options={allowed}
        onChange={(e) => {
          const next = e.target.value as RewardKind | "none";
          onChange(next === "none" ? null : defaultReward(next));
        }}
      />
      {reward?.kind === "sparks" && (
        <NumberField
          label="Sparks"
          value={(reward as SparksReward).sparks}
          step="10"
          suffix="✦"
          onChange={(n) => onChange({ kind: "sparks", sparks: Math.max(0, n) })}
        />
      )}
      {reward?.kind === "discount" && (
        <>
          <NumberField
            label="Percent off"
            value={(reward as DiscountReward).percentOff}
            step="1"
            suffix="%"
            onChange={(n) =>
              onChange({
                ...(reward as DiscountReward),
                percentOff: Math.min(100, Math.max(1, n)),
              })
            }
          />
          <NumberField
            label="Expires in (days)"
            value={(reward as DiscountReward).expiresInDays}
            step="1"
            onChange={(n) =>
              onChange({
                ...(reward as DiscountReward),
                expiresInDays: Math.max(1, Math.round(n)),
              })
            }
          />
          <div className="flex flex-wrap gap-2">
            {ITEM_OPTIONS.map((item) => {
              const on = (reward as DiscountReward).appliesTo.includes(item.value);
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => {
                    const cur = (reward as DiscountReward).appliesTo;
                    const next = on ? cur.filter((t) => t !== item.value) : [...cur, item.value];
                    onChange({
                      ...(reward as DiscountReward),
                      appliesTo: next.length > 0 ? next : [item.value],
                    });
                  }}
                  className={
                    on
                      ? "rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-semibold text-brand-800"
                      : "rounded-full bg-white px-2 py-0.5 text-[11px] text-ink-500 ring-1 ring-inset ring-ink-200"
                  }
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </>
      )}
      {reward?.kind === "freeMonths" && (
        <NumberField
          label="Months"
          value={(reward as FreeMonthsReward).months}
          step="1"
          onChange={(n) => onChange({ kind: "freeMonths", months: Math.min(12, Math.max(1, Math.round(n))) })}
        />
      )}
      {reward && (
        <p className="text-[11px] text-ink-500">{describeReward(reward, { plain: true })}</p>
      )}
    </div>
  );
}

// ---- Impact -----------------------------------------------------------------

function ImpactPanel({
  impact,
  baseCurrency,
}: {
  impact: ReturnType<typeof referralImpact>;
  baseCurrency: string;
}) {
  return (
    <Section
      title="Business impact"
      hint="Worst-case cost of ONE fully-completed referral (every enabled rule, both sides), using the same economics engines as plans and the discount planner."
    >
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Per completed referral" value={fmtMoney(impact.perReferralCost, baseCurrency)} />
        <StatCard label="Referrer side" value={fmtMoney(impact.referrerCost, baseCurrency)} />
        <StatCard label="Referred side" value={fmtMoney(impact.referredCost, baseCurrency)} />
        <StatCard
          label="Max per user (lifetime)"
          value={fmtMoney(impact.maxPerUserCost, baseCurrency)}
          note={
            impact.referralsPerDailyBudget > 0
              ? `${impact.referralsPerDailyBudget} fit in today's budget`
              : undefined
          }
        />
      </div>

      {impact.payback && (
        <p className="text-[11px] text-ink-500">
          Payback: a referred customer must buy ~{impact.payback.salesPerReferral}× of your best sale (
          {impact.payback.itemLabel}, {fmtMoney(impact.payback.netProfit, baseCurrency)} net) before the referral
          pays for itself.
        </p>
      )}

      {impact.rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg ring-1 ring-inset ring-ink-100">
          <table className="w-full text-left text-xs">
            <thead className="bg-ink-50 text-[11px] uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-2.5 py-1.5 font-semibold">Trigger</th>
                <th className="px-2.5 py-1.5 font-semibold">Side</th>
                <th className="px-2.5 py-1.5 font-semibold">Reward</th>
                <th className="px-2.5 py-1.5 font-semibold">Worst-case cost</th>
                <th className="px-2.5 py-1.5 font-semibold">Note</th>
              </tr>
            </thead>
            <tbody>
              {impact.rows.map((row) => (
                <tr key={`${row.ruleId}-${row.side}`} className="border-t border-ink-100">
                  <td className="px-2.5 py-1.5 text-ink-700">{row.triggerLabel}</td>
                  <td className="px-2.5 py-1.5 capitalize text-ink-600">{row.side}</td>
                  <td className="px-2.5 py-1.5 text-ink-700">{row.description}</td>
                  <td className="px-2.5 py-1.5 font-medium text-ink-800">
                    {fmtMoney(row.cost, baseCurrency)}
                  </td>
                  <td className="px-2.5 py-1.5 text-ink-400">{row.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {impact.warnings.map((w, i) => (
        <div
          key={`${w.severity}-${i}`}
          className={
            w.severity === "block"
              ? "flex gap-2 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-2 text-[11px] text-rose-800"
              : "flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800"
          }
        >
          {w.severity === "block" ? (
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          )}
          <span>{w.message}</span>
        </div>
      ))}
    </Section>
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

// ---- Held payouts -----------------------------------------------------------

/**
 * The decision queue. A reward the lifetime cap or the daily budget stopped is
 * waiting on a human, and so is one that couldn't be delivered (a free month for
 * a membership that has since been cancelled) — this is where both get resolved.
 */
function HeldRewardsPanel({
  held,
  baseCurrency,
  onResolved,
}: {
  held: HeldRewardView[];
  baseCurrency: string;
  onResolved: () => void;
}) {
  const resolveHeld = useAppConfigStore((s) => s.resolveHeldReward);
  const [busy, setBusy] = useState<string | null>(null);

  if (held.length === 0) return null;

  const act = async (id: string, verdict: "release" | "decline") => {
    if (
      verdict === "decline" &&
      !window.confirm("Decline this reward? It will never be paid. This cannot be undone.")
    ) {
      return;
    }
    setBusy(id);
    try {
      await resolveHeld(id, verdict);
      toast.success(verdict === "release" ? "Reward paid out." : "Reward declined.");
      onResolved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update this reward.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section
      title={`Held payouts (${held.length})`}
      hint="Rewards stopped by the lifetime cap, the daily budget, or a failed delivery. Releasing pays regardless of the limit that held it — the limits exist to make you look, not to decide for you."
    >
      <div className="space-y-2">
        {held.map((row) => (
          <div
            key={row.id}
            className="flex flex-wrap items-start justify-between gap-3 rounded-lg bg-amber-50/60 px-3 py-2.5 ring-1 ring-inset ring-amber-100"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm text-ink-800">
                <span className="font-semibold">{row.summary}</span> to the {row.side}{" "}
                <span className="text-ink-500">({row.email ?? row.uid.slice(0, 8)})</span>
              </p>
              <p className="text-[11px] text-ink-500">
                {row.unlocks} · {fmtMoney(row.cost, baseCurrency)} ·{" "}
                {new Date(row.at).toLocaleDateString()}
              </p>
              {row.note && <p className="mt-0.5 text-[11px] text-amber-800">{row.note}</p>}
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                type="button"
                size="sm"
                loading={busy === row.id}
                onClick={() => void act(row.id, "release")}
              >
                Pay out
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy === row.id}
                onClick={() => void act(row.id, "decline")}
              >
                Decline
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

