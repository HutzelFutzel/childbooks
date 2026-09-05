"use client";

/**
 * Admin editor for **coupons** (`adminSettings/coupons`; only the master switch
 * is published).
 *
 * A coupon is one mechanic, one issuance channel, and a pile of restrictions.
 * The screen is arranged in that order because that's the order the decisions
 * actually depend on each other: what it takes off, how it reaches someone, and
 * then who's allowed to use it.
 *
 * Four deliberate choices:
 *
 *   1. **Issuance is picked before anything else, and it changes the form.** A
 *      shared code needs a code field; a generated batch needs a mint button; an
 *      auto-grant needs an audience and has no code at all. Showing all of those
 *      at once is how an operator ends up with a "shared code" coupon whose
 *      audience they carefully filled in and which ignores it.
 *   2. **Codes are never listed in full.** The generated strings are shown ONCE,
 *      when they're minted, because that's the only moment they're needed. After
 *      that the list is masked — an operator has no routine reason to read an
 *      unredeemed code back out, and a screen showing ten thousand live codes is
 *      one screenshot from being a leak.
 *   3. **Saving is refused by the server, not silently corrected.** The schema's
 *      refusals (an active public code with no cap, a no-code coupon with no
 *      audience) are written for the person about to publish, so they're
 *      surfaced verbatim rather than replaced with "invalid".
 *   4. **The customer-facing sentence is generated.** The headline is an
 *      optional override; the default comes from the mechanic, so the promise
 *      can't drift from what actually comes off the price.
 *
 * Live results (redemptions, discount given, why codes are bouncing) are a
 * metrics view rather than a setting, so they live in Analysis → Coupons.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, KeyRound, Plus, ShieldOff, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../components/Button";
import { Field, Input, Textarea } from "../../components/Input";
import { Select } from "../../components/Select";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { useAdminTab } from "../adminTabStore";
import {
  COUPON_ISSUANCE_DESCRIPTIONS,
  COUPON_ISSUANCE_KINDS,
  COUPON_ISSUANCE_LABELS,
  COUPON_ITEM_TYPES,
  COUPON_STATUS_LABELS,
  MAX_COUPONS,
  couponSummary,
  createCoupon,
  describeRestrictions,
  formatCouponCode,
  issuanceUsesCodes,
  normalizeCouponCode,
  normalizeCouponsConfig,
  type Coupon,
  type CouponCodeRow,
  type CouponGrantRow,
  type CouponIssuanceKind,
  type CouponStatus,
  type CouponsConfig,
} from "../../../core/config/coupons";
import { DISCOUNT_ITEM_LABELS } from "../../../core/config/discountImpact";
import { Grid, ImpactNote, NumberField, Section, TabIntro } from "./products/parts";
import { Chips, DateField, SwitchField } from "./campaigns/parts";
import { useReadOnly } from "../../components/ReadOnlyContext";

const STATUS_OPTIONS = (["draft", "active", "paused", "ended"] as CouponStatus[]).map((value) => ({
  value,
  label: COUPON_STATUS_LABELS[value],
}));

const ISSUANCE_OPTIONS = COUPON_ISSUANCE_KINDS.map((value) => ({
  value,
  label: COUPON_ISSUANCE_LABELS[value],
}));

const ITEM_OPTIONS = COUPON_ITEM_TYPES.map((value) => ({
  value,
  label: DISCOUNT_ITEM_LABELS[value],
}));

const SUBSCRIBER_OPTIONS = [
  { value: "any", label: "Anyone" },
  { value: "subscribers", label: "Members only" },
  { value: "nonSubscribers", label: "Non-members only" },
];

const REFUND_OPTIONS = [
  { value: "restoreOnFullRefund", label: "Give the use back on a full refund" },
  { value: "restoreAlways", label: "Give the use back on any refund" },
  { value: "consume", label: "Keep it spent" },
];

export function CouponsTab() {
  const readOnly = useReadOnly();
  const load = useAppConfigStore((s) => s.loadCouponsConfig);
  const save = useAppConfigStore((s) => s.saveCouponsConfig);
  const settings = useAppConfigStore((s) => s.pricingSettings);
  const plans = useAppConfigStore((s) => s.plans.plans);
  const openConfigTab = useAdminTab((s) => s.openConfigTab);
  const openAnalysis = useAdminTab((s) => s.openAnalysis);
  const openMarketingTab = useAdminTab((s) => s.openMarketingTab);

  const [draft, setDraft] = useState<CouponsConfig | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    void load()
      .then((cfg) => {
        if (!live) return;
        setDraft(cfg);
        setSelectedId((id) => id ?? cfg.coupons[0]?.id ?? null);
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : "Could not load coupons."));
    return () => {
      live = false;
    };
  }, [load]);

  const selected = draft?.coupons.find((c) => c.id === selectedId) ?? null;

  if (!draft) return <p className="text-sm text-ink-400">Loading coupons…</p>;

  const setConfig = (patch: Partial<CouponsConfig>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setDirty(true);
  };

  const setCoupon = (id: string, patch: Partial<Coupon>) => {
    setDraft((d) =>
      d ? { ...d, coupons: d.coupons.map((c) => (c.id === id ? { ...c, ...patch } : c)) } : d,
    );
    setDirty(true);
  };

  const addCoupon = () => {
    const coupon = createCoupon({ name: `Coupon ${draft.coupons.length + 1}` });
    setConfig({ coupons: [...draft.coupons, coupon] });
    setSelectedId(coupon.id);
  };

  const duplicateCoupon = (source: Coupon) => {
    // A fresh id, and the shared code is deliberately NOT copied: two coupons
    // can't answer to one code, and silently clearing it here beats a save that
    // fails on a collision the operator didn't create.
    const { id: _id, createdAt: _createdAt, ...rest } = source;
    const copy = createCoupon({
      ...rest,
      name: `${source.name} (copy)`,
      status: "draft",
      sharedCode: "",
    });
    setConfig({ coupons: [...draft.coupons, copy] });
    setSelectedId(copy.id);
    toast.success("Copied as a new draft. Give it its own code.");
  };

  const removeCoupon = (coupon: Coupon) => {
    if (
      !window.confirm(
        coupon.status === "draft"
          ? `Delete "${coupon.name}"?`
          : `Delete "${coupon.name}"? Its codes stop working immediately and anyone holding one gets ` +
              `"that code isn't valid". Redemptions already settled are unaffected. Pausing it instead ` +
              `keeps the record and the report.`,
      )
    ) {
      return;
    }
    const remaining = draft.coupons.filter((c) => c.id !== coupon.id);
    setConfig({ coupons: remaining });
    setSelectedId(remaining[0]?.id ?? null);
  };

  const onSave = async () => {
    setSaving(true);
    try {
      // Normalized once, here: the editor lets a draft be temporarily incoherent
      // while it's being typed, and this is the moment that has to stop.
      const saved = await save(normalizeCouponsConfig(draft));
      setDraft(saved);
      setDirty(false);
      toast.success("Coupons saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  const activeAutoGrants = draft.coupons.filter(
    (c) => c.status === "active" && c.issuance === "autoGrant",
  );

  return (
    <div className="space-y-4">
      <TabIntro
        elsewhere={
          <>
            The ceiling on any single discount comes from the catalog&apos;s pricing settings, and live results
            (redemptions, discount given, why codes bounce) are a metrics view rather than a setting.
          </>
        }
        links={[
          { label: "Discount planner", onClick: () => openConfigTab("discounts") },
          { label: "QR codes", onClick: () => openMarketingTab("qrCodes") },
          { label: "Analysis → Coupons", onClick: () => openAnalysis("coupons") },
        ]}
      >
        Codes a customer types, and codes that apply themselves. A coupon is one mechanic (a percentage off), one way of
        reaching people (a shared code, a batch of one-time codes, or an automatic grant to everyone who arrived from a
        particular QR poster), and the restrictions that keep it bounded. Every code is validated on the server when
        it&apos;s entered, and every refusal comes back with a reason the customer can act on — a code that silently
        does nothing is the failure this whole screen exists to prevent.
      </TabIntro>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <SwitchField
          checked={draft.enabled}
          onChange={(v) => setConfig({ enabled: v })}
          label="Coupon engine enabled"
          hint="The master switch. Off means no code validates and nothing auto-grants, whatever each coupon says."
        />
        {!readOnly && (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={draft.coupons.length >= MAX_COUPONS}
              onClick={addCoupon}
            >
              <Plus className="size-3.5" /> New coupon
            </Button>
            <Button type="button" size="sm" loading={saving} disabled={!dirty} onClick={() => void onSave()}>
              Save
            </Button>
          </div>
        )}
      </div>

      {!draft.enabled && draft.coupons.some((c) => c.status === "active") && (
        <ImpactNote>
          The engine is <span className="font-semibold">off</span>, so the active coupons below aren&apos;t running. No
          code validates and nothing auto-grants until it&apos;s switched on.
        </ImpactNote>
      )}

      {activeAutoGrants.length > 0 && (
        <ImpactNote>
          {activeAutoGrants.length === 1 ? "One coupon applies" : `${activeAutoGrants.length} coupons apply`} itself
          with nothing to type. Those discount orders for everyone matching their audience, without the customer doing
          anything — worth re-reading the audience on each before a campaign goes out.
        </ImpactNote>
      )}

      {draft.coupons.length === 0 ? (
        <Section title="Coupons" hint="Nothing configured yet.">
          <p className="text-xs text-ink-400">
            No coupons. Add one to start — it opens as a draft, which never validates and never discounts anything, so
            there&apos;s no risk in building it out first.
          </p>
        </Section>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
          <CouponList coupons={draft.coupons} selectedId={selectedId} onSelect={setSelectedId} />
          {selected ? (
            <div className="min-w-0 space-y-3">
              <CouponEditor
                coupon={selected}
                currency={settings.baseCurrency}
                maxDiscountPct={settings.maxDiscountPct}
                planIds={plans.map((p) => p.id)}
                onChange={(patch) => setCoupon(selected.id, patch)}
                onDuplicate={() => duplicateCoupon(selected)}
                onRemove={() => removeCoupon(selected)}
              />
              <CodesPanel coupon={selected} saved={!dirty} />
              <GrantsPanel coupon={selected} saved={!dirty} />
            </div>
          ) : (
            <p className="text-sm text-ink-400">Pick a coupon to edit.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ---- List -------------------------------------------------------------------

const STATUS_DOT: Record<CouponStatus, string> = {
  draft: "bg-ink-300",
  active: "bg-emerald-500",
  paused: "bg-amber-500",
  ended: "bg-ink-200",
};

function CouponList({
  coupons,
  selectedId,
  onSelect,
}: {
  coupons: Coupon[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      {coupons.map((coupon) => {
        const on = coupon.id === selectedId;
        return (
          <button
            key={coupon.id}
            type="button"
            onClick={() => onSelect(coupon.id)}
            className={
              on
                ? "w-full rounded-lg bg-white px-3 py-2 text-left ring-2 ring-inset ring-brand-400"
                : "w-full rounded-lg bg-white px-3 py-2 text-left ring-1 ring-inset ring-ink-100 transition hover:ring-ink-200"
            }
          >
            <div className="flex items-center gap-1.5">
              <span className={`size-1.5 shrink-0 rounded-full ${STATUS_DOT[coupon.status]}`} />
              <span className="truncate text-sm font-medium text-ink-800">{coupon.name}</span>
            </div>
            <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-ink-400">
              {coupon.issuance === "sharedCode" && coupon.sharedCode
                ? `${formatCouponCode(coupon.sharedCode)} · ${couponSummary(coupon)}`
                : `${COUPON_ISSUANCE_LABELS[coupon.issuance]} · ${couponSummary(coupon)}`}
            </p>
          </button>
        );
      })}
    </div>
  );
}

// ---- Editor -----------------------------------------------------------------

function CouponEditor({
  coupon,
  currency,
  maxDiscountPct,
  planIds,
  onChange,
  onDuplicate,
  onRemove,
}: {
  coupon: Coupon;
  currency: string;
  maxDiscountPct: number;
  planIds: string[];
  onChange: (patch: Partial<Coupon>) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const readOnly = useReadOnly();
  const r = coupon.restrictions;
  const notes = useMemo(() => describeRestrictions(r), [r]);
  const setRestrictions = (patch: Partial<Coupon["restrictions"]>) =>
    onChange({ restrictions: { ...r, ...patch } });

  const percentOff = coupon.mechanic.percentOff;
  // Advisory, not enforced here: the real clamp happens at checkout against the
  // catalog maximum AND the order's break-even headroom, so a coupon can be
  // saved above the ceiling and will simply be clamped. Saying so beats letting
  // an operator believe they published 40% when 25% is all anyone will get.
  const overCeiling = coupon.status === "active" && percentOff > maxDiscountPct;

  return (
    <div className="space-y-3">
      <Section
        title="This coupon"
        action={
          readOnly ? undefined : (
            <div className="flex gap-1.5">
              <Button type="button" size="sm" variant="secondary" onClick={onDuplicate}>
                <Copy className="size-3.5" /> Duplicate
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={onRemove}>
                <Trash2 className="size-3.5" /> Delete
              </Button>
            </div>
          )
        }
      >
        <Grid cols={2}>
          <Field label="Name" hint="Admin-facing only. Customers never see it.">
            <Input value={coupon.name} maxLength={120} onChange={(e) => onChange({ name: e.target.value })} />
          </Field>
          <Field
            label="Status"
            hint="Draft never validates. Paused refuses new redemptions but keeps existing grants readable."
          >
            <Select
              value={coupon.status}
              options={STATUS_OPTIONS}
              onChange={(e) => onChange({ status: e.target.value as CouponStatus })}
            />
          </Field>
        </Grid>
        <Field label="Notes" hint="Why this exists, where it's printed, who asked for it.">
          <Textarea
            value={coupon.notes}
            rows={2}
            maxLength={2000}
            onChange={(e) => onChange({ notes: e.target.value })}
          />
        </Field>
      </Section>

      <Section title="What it takes off" hint="Percentages only — see the note below.">
        <Grid cols={2}>
          <NumberField
            label="Percentage off"
            value={percentOff}
            step="1"
            suffix="%"
            onChange={(v) =>
              onChange({
                mechanic: { ...coupon.mechanic, percentOff: Math.max(0, Math.min(100, Math.round(v))) },
              })
            }
          />
          <NumberField
            label="Cap the amount taken off"
            value={coupon.mechanic.maxDiscountAmount}
            step="1"
            suffix={currency}
            hint="0 = no cap. This is what makes a public percentage safe to print without knowing what people will buy."
            onChange={(v) =>
              onChange({ mechanic: { ...coupon.mechanic, maxDiscountAmount: Math.max(0, v) } })
            }
          />
        </Grid>
        {overCeiling && (
          <ImpactNote>
            {percentOff}% is above the catalog ceiling of {maxDiscountPct}%, so checkout will clamp it — and clamp it
            further on any order that&apos;s close to break-even. Nobody will receive more than the ceiling however
            this is set.
          </ImpactNote>
        )}
        <p className="text-[11px] leading-relaxed text-ink-400">
          Fixed-amount coupons and free shipping aren&apos;t available yet, and that&apos;s deliberate rather than
          missing: every guardrail in the pricing engine is a percentage, a fixed amount can exceed the item price and
          has to respect the price floor per currency, and free shipping isn&apos;t a price discount at all — shipping
          revenue offsets shipping cost in the margin model. Both need their own cost model first.
        </p>
      </Section>

      <Section title="How people get it">
        <Field label="Issuance" hint={COUPON_ISSUANCE_DESCRIPTIONS[coupon.issuance]}>
          <Select
            value={coupon.issuance}
            options={ISSUANCE_OPTIONS}
            onChange={(e) => onChange({ issuance: e.target.value as CouponIssuanceKind })}
          />
        </Field>

        {coupon.issuance === "sharedCode" && (
          <Field
            label="The code"
            hint="Upper-cased and stripped of punctuation, so WELCOME20, welcome-20 and 'welcome 20' are all the same code."
          >
            <Input
              value={coupon.sharedCode}
              maxLength={32}
              placeholder="WELCOME20"
              onChange={(e) => onChange({ sharedCode: normalizeCouponCode(e.target.value) })}
            />
          </Field>
        )}

        {!issuanceUsesCodes(coupon.issuance) && (
          <div className="space-y-3">
            <Field
              label="Arrived via"
              hint="Arrival tokens, comma-separated: a QR id as qr:berlin-window, a whole channel as just qr, or a campaign link as utm:newsletter. Empty means any arrival — which for an automatic coupon means everyone."
            >
              <Input
                value={coupon.audience.arrivedVia.join(", ")}
                placeholder="qr:berlin-window, utm:spring-mailer"
                onChange={(e) =>
                  onChange({
                    audience: {
                      ...coupon.audience,
                      arrivedVia: e.target.value
                        .split(",")
                        .map((t) => t.trim().toLowerCase())
                        .filter(Boolean)
                        .slice(0, 100),
                    },
                  })
                }
              />
            </Field>
            <Grid cols={2}>
              <DateField
                label="Signed up after"
                value={coupon.audience.signedUpFrom}
                hint="Empty means any account age."
                onChange={(signedUpFrom) => onChange({ audience: { ...coupon.audience, signedUpFrom } })}
              />
              <DateField
                label="Signed up before"
                value={coupon.audience.signedUpTo}
                hint="Empty means no upper bound."
                onChange={(signedUpTo) => onChange({ audience: { ...coupon.audience, signedUpTo } })}
              />
            </Grid>
            <Field
              label="Only these accounts"
              hint="User ids, comma-separated. A second gate on top of the grant, for a pilot you want held to a named list — leave it empty unless you mean it, because anyone granted this coupon who isn't listed here is refused at checkout."
            >
              <Textarea
                value={coupon.audience.allowlistUids.join(", ")}
                rows={2}
                onChange={(e) =>
                  onChange({
                    audience: {
                      ...coupon.audience,
                      allowlistUids: e.target.value
                        .split(",")
                        .map((t) => t.trim())
                        .filter(Boolean)
                        .slice(0, 500),
                    },
                  })
                }
              />
            </Field>
          </div>
        )}
      </Section>

      <Section title="Where it applies">
        <Field label="Item types" hint="Nothing selected means it applies to everything you sell.">
          <Chips
            options={ITEM_OPTIONS}
            selected={r.itemTypes}
            allowEmpty
            onChange={(itemTypes) => setRestrictions({ itemTypes: itemTypes as typeof r.itemTypes })}
          />
        </Field>
        {/* Empty counts: no selection means "everything", which includes
            memberships — the case an earlier version of this note missed. */}
        {(r.itemTypes.length === 0 || r.itemTypes.includes("plan")) && (
          <ImpactNote>
            On a membership this comes off the <span className="font-semibold">first invoice only</span>.
            Stripe raises those invoices, so the discount reaches it as a one-off coupon attached at
            checkout, and the renewal a month or a year later bills the full price. Nothing to
            configure — but it&apos;s the difference between &ldquo;{percentOff}% off membership&rdquo; and
            &ldquo;{percentOff}% off your first month&rdquo;, and only one of those is true.
          </ImpactNote>
        )}
        <Grid cols={2}>
          <NumberField
            label="Minimum order"
            value={r.minSubtotal}
            step="1"
            suffix={currency}
            hint="0 = no minimum."
            onChange={(minSubtotal) => setRestrictions({ minSubtotal: Math.max(0, minSubtotal) })}
          />
          <Field label="Countries" hint="ISO-2 codes, comma-separated. Empty means anywhere. An unknown country FAILS a country-gated coupon.">
            <Input
              value={r.countries.join(", ")}
              placeholder="DE, AT, CH"
              onChange={(e) =>
                setRestrictions({
                  countries: splitCodes(e.target.value, 2),
                })
              }
            />
          </Field>
        </Grid>
        <Grid cols={2}>
          <Field label="Currencies" hint="ISO-4217 codes, comma-separated. Empty means all.">
            <Input
              value={r.currencies.join(", ")}
              placeholder="EUR, USD"
              onChange={(e) => setRestrictions({ currencies: splitCodes(e.target.value, 3) })}
            />
          </Field>
          <Field
            label="Specific products"
            hint="Catalog ids, comma-separated — a book format, a Sparks pack or a plan. Empty means all."
          >
            <Input
              value={r.productIds.join(", ")}
              onChange={(e) =>
                setRestrictions({
                  productIds: e.target.value
                    .split(",")
                    .map((v) => v.trim())
                    .filter(Boolean)
                    .slice(0, 200),
                })
              }
            />
          </Field>
        </Grid>
        <Grid cols={2}>
          <DateField
            label="Starts"
            value={r.startsAt}
            hint="Empty means as soon as it goes active."
            onChange={(startsAt) => setRestrictions({ startsAt })}
          />
          <DateField
            label="Ends"
            value={r.endsAt}
            hint="Empty means it runs until someone stops it."
            onChange={(endsAt) => setRestrictions({ endsAt })}
          />
        </Grid>
      </Section>

      <Section
        title="Who can use it, and how often"
        hint="An active coupon needs at least one cap and at least one budget — the server refuses to save one without."
      >
        <Grid cols={3}>
          <NumberField
            label="Uses per account"
            value={r.maxPerAccount}
            step="1"
            hint="0 = unlimited."
            onChange={(maxPerAccount) => setRestrictions({ maxPerAccount: Math.max(0, Math.round(maxPerAccount)) })}
          />
          <NumberField
            label="Uses in total"
            value={r.maxRedemptions}
            step="1"
            hint="0 = unlimited. The 'first 100 customers' cap."
            onChange={(maxRedemptions) =>
              setRestrictions({ maxRedemptions: Math.max(0, Math.round(maxRedemptions)) })
            }
          />
          <NumberField
            label="Uses per code"
            value={r.maxPerCode}
            step="1"
            hint="0 = unlimited. Set 1 for single-use codes."
            onChange={(maxPerCode) => setRestrictions({ maxPerCode: Math.max(0, Math.round(maxPerCode)) })}
          />
        </Grid>
        <Grid cols={2}>
          <NumberField
            label="Daily budget"
            value={r.dailyBudget}
            step="10"
            suffix={currency}
            hint="Discount given away per day. The circuit breaker between a mispriced coupon and an unbounded bill."
            onChange={(dailyBudget) => setRestrictions({ dailyBudget: Math.max(0, dailyBudget) })}
          />
          <NumberField
            label="Lifetime budget"
            value={r.lifetimeBudget}
            step="10"
            suffix={currency}
            hint="0 = unlimited."
            onChange={(lifetimeBudget) => setRestrictions({ lifetimeBudget: Math.max(0, lifetimeBudget) })}
          />
        </Grid>
        <Grid cols={2}>
          <Field label="Membership" hint="Restrict to members, or to people who aren't members yet.">
            <Select
              value={r.subscriberScope}
              options={SUBSCRIBER_OPTIONS}
              onChange={(e) =>
                setRestrictions({ subscriberScope: e.target.value as typeof r.subscriberScope })
              }
            />
          </Field>
          <Field
            label="Only members on these plans"
            hint="The plan someone is already on — not the one they're buying. To discount one particular membership, name its id under Specific products instead."
          >
            <Chips
              options={planIds.map((id) => ({ value: id, label: id }))}
              selected={r.planIds}
              allowEmpty
              onChange={(planIds) => setRestrictions({ planIds })}
            />
          </Field>
        </Grid>
        <Grid cols={2}>
          <NumberField
            label="Account at least this old"
            value={r.minAccountAgeDays}
            step="1"
            suffix="days"
            hint="0 = no minimum."
            onChange={(minAccountAgeDays) =>
              setRestrictions({ minAccountAgeDays: Math.max(0, Math.round(minAccountAgeDays)) })
            }
          />
          <NumberField
            label="Account at most this old"
            value={r.maxAccountAgeDays}
            step="1"
            suffix="days"
            hint="0 = no maximum. This is how a 'new customers only' coupon is expressed."
            onChange={(maxAccountAgeDays) =>
              setRestrictions({ maxAccountAgeDays: Math.max(0, Math.round(maxAccountAgeDays)) })
            }
          />
        </Grid>
        <div className="space-y-2.5">
          <SwitchField
            checked={r.firstPurchaseOnly}
            onChange={(firstPurchaseOnly) => setRestrictions({ firstPurchaseOnly })}
            label="First order only"
            hint="Refused for anyone who has bought before."
          />
          <SwitchField
            checked={r.requireVerified}
            onChange={(requireVerified) => setRestrictions({ requireVerified })}
            label="Require a confirmed email"
            hint="Strongly recommended. An unconfirmed address is an identity anybody can mint on demand."
          />
          <SwitchField
            checked={r.allowGuests}
            onChange={(allowGuests) => setRestrictions({ allowGuests })}
            label="Let guests use it"
            hint="Almost always wrong: a guest session costs nothing to create, so a discount open to guests is a discount open to everyone, repeatedly."
          />
          <SwitchField
            checked={r.stackable}
            onChange={(stackable) => setRestrictions({ stackable })}
            label="Can combine with another offer"
            hint="Off means checkout picks exactly one — this or their referral reward or their campaign offer, whichever is better for them. Stacking is how a promotion accidentally sells below cost."
          />
        </div>
        <Grid cols={2}>
          <NumberField
            label="Priority"
            value={r.priority}
            step="1"
            hint="Breaks ties when two offers of equal size collide. It never beats a bigger discount — a customer offered 20% and charged 10% experiences a bug, whatever this says."
            onChange={(priority) => setRestrictions({ priority: Math.round(priority) })}
          />
          <Field
            label="If the order is refunded"
            hint="A make-good coupon usually shouldn't come back when the refund it accompanied lands."
          >
            <Select
              value={r.refundPolicy}
              options={REFUND_OPTIONS}
              onChange={(e) => setRestrictions({ refundPolicy: e.target.value as typeof r.refundPolicy })}
            />
          </Field>
        </Grid>
      </Section>

      <Section
        title="What the customer reads"
        hint="Generated from the mechanic unless you override it, so the promise can't drift from what comes off the price."
      >
        <Grid cols={2}>
          <Field label="Headline override" hint="Leave empty to use the generated sentence.">
            <Input
              value={coupon.presentation.headline}
              maxLength={160}
              placeholder={couponSummary({ ...coupon, presentation: { headline: "", subline: "" } })}
              onChange={(e) =>
                onChange({ presentation: { ...coupon.presentation, headline: e.target.value } })
              }
            />
          </Field>
          <Field label="Supporting line" hint="Optional. One extra sentence of context.">
            <Input
              value={coupon.presentation.subline}
              maxLength={400}
              onChange={(e) =>
                onChange({ presentation: { ...coupon.presentation, subline: e.target.value } })
              }
            />
          </Field>
        </Grid>
        <div className="rounded-lg bg-ink-50 px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-ink-400">Preview</div>
          <div className="text-sm font-semibold text-ink-800">{couponSummary(coupon)}</div>
          {coupon.presentation.subline && (
            <p className="text-xs text-ink-500">{coupon.presentation.subline}</p>
          )}
          {notes.length > 0 && (
            <p className="mt-1 text-[11px] leading-relaxed text-ink-400">{notes.join(" · ")}</p>
          )}
        </div>
      </Section>
    </div>
  );
}

function splitCodes(value: string, length: number): string[] {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((v) => v.trim().toUpperCase().slice(0, length))
        .filter(Boolean),
    ),
  ).slice(0, 100);
}

// ---- Codes ------------------------------------------------------------------

/**
 * Minting, listing and revoking the actual redeemable strings.
 *
 * Only rendered for `generatedCodes` issuance, because that's the only channel
 * where codes are objects with their own lifecycle. A shared code is a field on
 * the coupon; an auto-grant has no code at all.
 *
 * Requires the coupon to be SAVED before minting. Generating codes against a
 * draft that's still being edited would attach real, un-unmintable strings to an
 * offer whose terms are about to change.
 */
function CodesPanel({ coupon, saved }: { coupon: Coupon; saved: boolean }) {
  const readOnly = useReadOnly();
  const generate = useAppConfigStore((s) => s.generateCouponCodes);
  const loadCodes = useAppConfigStore((s) => s.loadCouponCodes);
  const revoke = useAppConfigStore((s) => s.revokeCouponCodes);

  const [count, setCount] = useState(50);
  const [length, setLength] = useState(10);
  const [prefix, setPrefix] = useState("");
  const [busy, setBusy] = useState(false);
  const [minted, setMinted] = useState<{ batchId: string; codes: string[] } | null>(null);
  const [codes, setCodes] = useState<CouponCodeRow[] | null>(null);

  useEffect(() => {
    // Reset when the selection changes — showing one coupon's codes under
    // another's name is the kind of confusion that gets a batch revoked by
    // mistake.
    setMinted(null);
    setCodes(null);
  }, [coupon.id]);

  if (coupon.issuance !== "generatedCodes") return null;

  const onGenerate = async () => {
    setBusy(true);
    try {
      const result = await generate(coupon.id, { count, length, prefix: prefix || undefined });
      setMinted({ batchId: result.batchId, codes: result.codes });
      toast.success(`Minted ${result.created} codes. Copy them now — they're only shown once.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not generate codes.");
    } finally {
      setBusy(false);
    }
  };

  const onLoad = async () => {
    setBusy(true);
    try {
      setCodes(await loadCodes(coupon.id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load codes.");
    } finally {
      setBusy(false);
    }
  };

  const onRevoke = async (batchId?: string) => {
    if (
      !window.confirm(
        batchId
          ? `Revoke every code in batch ${batchId}? They stop working immediately.`
          : `Revoke EVERY code for "${coupon.name}"? Anyone holding one gets "that code isn't valid" from now on. ` +
              `Redemptions already settled are unaffected.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const revoked = await revoke(coupon.id, batchId);
      toast.success(`Revoked ${revoked} codes.`);
      setCodes(await loadCodes(coupon.id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not revoke these codes.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Codes"
      hint="Unguessable one-time strings. Shown in full once, when they're minted — after that only the last four."
    >
      {!saved ? (
        <p className="text-xs text-ink-400">
          Save this coupon before minting codes. A code attached to a draft that&apos;s still being edited is a real
          string on someone&apos;s voucher pointing at terms that are about to change.
        </p>
      ) : (
        <>
          {!readOnly && (
            <Grid cols={3}>
              <NumberField label="How many" value={count} step="10" onChange={(v) => setCount(Math.max(1, Math.min(5000, Math.round(v))))} />
              <NumberField
                label="Length"
                value={length}
                step="1"
                hint="Characters, from an alphabet with 0/O and 1/I removed."
                onChange={(v) => setLength(Math.max(6, Math.min(24, Math.round(v))))}
              />
              <Field label="Prefix" hint="Optional, e.g. XMAS.">
                <Input value={prefix} maxLength={8} onChange={(e) => setPrefix(e.target.value.toUpperCase())} />
              </Field>
            </Grid>
          )}
          <div className="flex flex-wrap gap-2">
            {!readOnly && (
              <Button type="button" size="sm" loading={busy} onClick={() => void onGenerate()}>
                <KeyRound className="size-3.5" /> Mint {count} codes
              </Button>
            )}
            <Button type="button" size="sm" variant="secondary" loading={busy} onClick={() => void onLoad()}>
              Show existing codes
            </Button>
            {!readOnly && (
              <Button type="button" size="sm" variant="secondary" loading={busy} onClick={() => void onRevoke()}>
                <ShieldOff className="size-3.5" /> Revoke all
              </Button>
            )}
          </div>

          {minted && (
            <div className="space-y-1.5 rounded-lg bg-amber-50 px-3 py-2 ring-1 ring-inset ring-amber-200">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">
                Batch {minted.batchId} — copy these now
              </div>
              <Textarea value={minted.codes.join("\n")} rows={6} readOnly />
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    void navigator.clipboard.writeText(minted.codes.join("\n"));
                    toast.success("Copied.");
                  }}
                >
                  <Copy className="size-3.5" /> Copy all
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => void onRevoke(minted.batchId)}>
                  <ShieldOff className="size-3.5" /> Revoke this batch
                </Button>
              </div>
              <p className="text-[11px] leading-relaxed text-amber-800">
                This is the only time these are shown in full. They go into a print run or a mail merge from here;
                afterwards the list below shows only the last four of each, because a screen full of live codes is one
                screenshot from being a leak.
              </p>
            </div>
          )}

          {codes && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-ink-400">
                    <th className="py-1 pr-3 font-medium">Code</th>
                    <th className="py-1 pr-3 font-medium">Batch</th>
                    <th className="py-1 pr-3 font-medium">Used</th>
                    <th className="py-1 pr-3 font-medium">Held</th>
                    <th className="py-1 font-medium">State</th>
                  </tr>
                </thead>
                <tbody>
                  {codes.map((row) => (
                    <tr key={`${row.batchId}-${row.code}-${row.createdAt}`} className="border-t border-ink-100">
                      <td className="py-1 pr-3 font-mono text-ink-700">{row.code}</td>
                      <td className="py-1 pr-3 text-ink-400">{row.batchId ?? "—"}</td>
                      <td className="py-1 pr-3 text-ink-700">{row.redeemedCount}</td>
                      <td className="py-1 pr-3 text-ink-700">{row.reservedCount}</td>
                      <td className="py-1 text-ink-500">
                        {row.revoked ? "Revoked" : row.redeemedCount > 0 ? "Used" : "Live"}
                      </td>
                    </tr>
                  ))}
                  {codes.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-2 text-ink-400">
                        No codes minted yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Section>
  );
}

// ---- Grants -----------------------------------------------------------------

/**
 * Who holds a no-code coupon, and the way to hand one to somebody.
 *
 * The counterpart to `CodesPanel`: for a coupon with no code, a GRANT is the
 * thing that exists, and without one nothing validates — `validateCoupon`
 * refuses an auto/admin-granted coupon outright unless the account holds a live
 * grant. So this panel is the entire issuance channel for `adminGrant`, and the
 * make-good path for `autoGrant` (somebody who walked past the poster and
 * didn't scan it).
 *
 * Two decisions worth naming:
 *
 *   1. **Email or uid, one field.** An operator arrives here from a support
 *      ticket holding an email address. Resolution happens server-side against
 *      the auth directory, so a typo comes back as "nobody has signed up with
 *      that" rather than a grant quietly attached to a uid that doesn't exist.
 *   2. **Revoked grants stay listed.** A revocation an operator can't see is a
 *      revocation they perform twice, and the second one looks like it failed.
 */
function GrantsPanel({ coupon, saved }: { coupon: Coupon; saved: boolean }) {
  const readOnly = useReadOnly();
  const grant = useAppConfigStore((s) => s.grantCoupon);
  const loadGrants = useAppConfigStore((s) => s.loadCouponGrants);
  const revoke = useAppConfigStore((s) => s.revokeCouponGrant);

  const [account, setAccount] = useState("");
  const [busy, setBusy] = useState(false);
  const [grants, setGrants] = useState<CouponGrantRow[] | null>(null);

  const refresh = useCallback(async () => {
    try {
      setGrants(await loadGrants(coupon.id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load who holds this.");
    }
  }, [coupon.id, loadGrants]);

  useEffect(() => {
    setAccount("");
    setGrants(null);
  }, [coupon.id]);

  if (issuanceUsesCodes(coupon.issuance)) return null;

  const onGrant = async () => {
    const value = account.trim();
    if (!value) return;
    setBusy(true);
    try {
      const result = await grant(coupon.id, value.includes("@") ? { email: value } : { uid: value });
      if (result.granted) {
        toast.success(`Granted. They've been emailed: ${result.summary ?? couponSummary(coupon)}`);
        setAccount("");
      } else {
        // Not an error — the grant id is `{uid}__{couponId}` and creation is a
        // `create`, so a second attempt is a no-op rather than a duplicate.
        toast.info(result.message ?? "That account already has this coupon.");
      }
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not grant this coupon.");
    } finally {
      setBusy(false);
    }
  };

  const onRevoke = async (row: CouponGrantRow) => {
    const who = row.email ?? row.uid;
    if (
      !window.confirm(
        row.redeemedCount > 0
          ? `Take this coupon back off ${who}? They've already used it ${row.redeemedCount} time(s) — those ` +
              `redemptions stand; this only stops further use.`
          : `Take this coupon back off ${who}? It disappears from their wallet and stops validating.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await revoke(coupon.id, row.uid);
      toast.success("Grant revoked.");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not revoke this grant.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Who holds this"
      hint={
        coupon.issuance === "adminGrant"
          ? "This coupon reaches people only by being granted here — there's no code to type and nothing grants it automatically."
          : "Granted automatically to everyone matching the audience above. Add somebody by hand when they should have had it and didn't."
      }
    >
      {!saved ? (
        <p className="text-xs text-ink-400">
          Save this coupon first. A grant freezes the terms it was made under, so granting from a draft that&apos;s
          still being edited promises somebody something you&apos;re about to change.
        </p>
      ) : (
        <>
          {!readOnly && (
            <div className="flex flex-wrap items-end gap-2">
              <Field
                label="Account"
                hint="An email address or a user id."
                className="min-w-[16rem] flex-1"
              >
                <Input
                  value={account}
                  maxLength={320}
                  placeholder="someone@example.com"
                  onChange={(e) => setAccount(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void onGrant();
                  }}
                />
              </Field>
              <Button type="button" size="sm" loading={busy} disabled={!account.trim()} onClick={() => void onGrant()}>
                <UserPlus className="size-3.5" /> Grant
              </Button>
            </div>
          )}

          {coupon.status !== "active" && (
            <ImpactNote>
              This coupon is <span className="font-semibold">{COUPON_STATUS_LABELS[coupon.status].toLowerCase()}</span>,
              so anything granted now is refused at checkout — and the grant email promises a discount that
              doesn&apos;t work yet. Set it to active first, or warn whoever you&apos;re granting it to.
            </ImpactNote>
          )}

          {coupon.audience.allowlistUids.length > 0 && (
            <ImpactNote>
              This coupon also has an <span className="font-semibold">Only these accounts</span> list, which is checked
              on top of the grant. Anyone granted it who isn&apos;t on that list is refused at checkout — either add
              them there too, or clear the list and let the grant decide.
            </ImpactNote>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="secondary" loading={busy} onClick={() => void refresh()}>
              {grants ? "Refresh" : "Show holders"}
            </Button>
          </div>

          {grants && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-ink-400">
                    <th className="py-1 pr-3 font-medium">Account</th>
                    <th className="py-1 pr-3 font-medium">Granted</th>
                    <th className="py-1 pr-3 font-medium">How</th>
                    <th className="py-1 pr-3 font-medium">Used</th>
                    <th className="py-1 font-medium">State</th>
                    {!readOnly && <th className="py-1" />}
                  </tr>
                </thead>
                <tbody>
                  {grants.map((row) => (
                    <tr key={row.id} className="border-t border-ink-100">
                      <td className="py-1 pr-3 text-ink-700">
                        <span className="block max-w-[18rem] truncate">{row.email ?? row.uid}</span>
                        {row.email && <span className="block truncate font-mono text-[10px] text-ink-400">{row.uid}</span>}
                      </td>
                      <td className="py-1 pr-3 text-ink-500">
                        {row.grantedAt > 0 ? new Date(row.grantedAt).toLocaleDateString() : "—"}
                      </td>
                      <td className="py-1 pr-3 text-ink-400">
                        <span className="block max-w-48 truncate">{row.source || "—"}</span>
                      </td>
                      <td className="py-1 pr-3 text-ink-700">{row.redeemedCount}</td>
                      <td className="py-1 text-ink-500">{row.revoked ? "Revoked" : "Live"}</td>
                      {!readOnly && (
                        <td className="py-1 text-right">
                          {!row.revoked && (
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              disabled={busy}
                              onClick={() => void onRevoke(row)}
                            >
                              <ShieldOff className="size-3.5" /> Revoke
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                  {grants.length === 0 && (
                    <tr>
                      <td colSpan={readOnly ? 5 : 6} className="py-2 text-ink-400">
                        {coupon.issuance === "adminGrant"
                          ? "Nobody holds this yet, so nobody can use it."
                          : "Nobody holds this yet — nobody matching the audience has arrived."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Section>
  );
}
