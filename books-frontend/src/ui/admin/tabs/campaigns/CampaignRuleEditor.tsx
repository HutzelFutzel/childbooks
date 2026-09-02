"use client";

/**
 * The rule editor: one trigger, an AND-list of conditions, one effect.
 *
 * The shape of this UI is the shape of the data model, on purpose. A rule is
 * disjunctive normal form — one moment, a flat list of gates, one thing that
 * happens — so it renders as three stacked blocks read top to bottom, and "OR" is
 * a second rule rather than a nested widget. An admin who can read the sentence
 * under the rule understands the rule; there's nowhere for a contradiction to
 * hide.
 *
 * Two behaviours are worth knowing about:
 *
 *   - Changing the trigger SCRUBS whatever the new trigger can't carry (an item
 *     type on a signup, a price break on a purchase). The alternative — leaving
 *     an ignored condition visible — reads as a restriction that silently doesn't
 *     apply, which is how a campaign pays out more widely than its author thinks.
 *   - The approval switch is forced on wherever `ruleNeedsApproval` says so and
 *     rendered disabled with the reason, rather than being hidden. An operator
 *     needs to know the payout will wait for them.
 */
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { Button } from "../../../components/Button";
import { Field, Input } from "../../../components/Input";
import { Select } from "../../../components/Select";
import { Toggle } from "../../../components/Toggle";
import { useReadOnly } from "../../../components/ReadOnlyContext";
import {
  CONDITION_KINDS,
  CONDITION_LABELS,
  EFFECT_KINDS,
  EFFECT_LABELS,
  TRIGGERS,
  TRIGGER_META,
  conditionAllowedForTrigger,
  createCondition,
  createEffect,
  describeCondition,
  effectAllowedForTrigger,
  ruleNeedsApproval,
  summarizeRule,
  type ActionPricingEffect,
  type CampaignEffect,
  type CampaignRule,
  type CampaignTrigger,
  type EffectKind,
  type PurchaseDiscountEffect,
  type RuleCondition,
  type RuleConditionKind,
  type SparksEffect,
  type SpendRefundEffect,
} from "../../../../core/config/campaigns";
import {
  BUYER_ROLES,
  BUYER_ROLE_LABELS,
  type BuyerRole,
} from "../../../../core/config/buyerRoles";
import { DISCOUNT_ITEM_LABELS, type DiscountItemType } from "../../../../core/config/discountImpact";
import { IMAGE_TIERS, type ImageTier } from "../../../../core/config/modelConfig";
import { IMAGE_ACTIONS } from "../../../../core/ai/actions";
import { useAppConfigStore } from "../../../../state/appConfigStore";
import { Grid, NumberField } from "../products/parts";
import { Chips, SwitchField } from "./parts";

const ITEM_OPTIONS = (["print", "ebook", "pack", "plan"] as DiscountItemType[]).map((value) => ({
  value,
  label: DISCOUNT_ITEM_LABELS[value],
}));

const IMAGE_ACTION_OPTIONS = IMAGE_ACTIONS.map((a) => ({ value: a.id as string, label: a.label }));

function useImageTierOptions() {
  const labels = useAppConfigStore((s) => s.modelConfig.imageTierLabels);
  return IMAGE_TIERS.map((value) => ({ value, label: labels[value] }));
}

export function CampaignRuleEditor({
  rule,
  onChange,
  onRemove,
  currency,
}: {
  rule: CampaignRule;
  onChange: (rule: CampaignRule) => void;
  onRemove: () => void;
  currency: string;
}) {
  const readOnly = useReadOnly();
  const meta = TRIGGER_META[rule.trigger];
  const approvalForced = ruleNeedsApproval(rule.trigger, rule.effect.kind);
  const effectOptions = EFFECT_KINDS.filter((kind) => effectAllowedForTrigger(rule.trigger, kind)).map(
    (kind) => ({ value: kind, label: EFFECT_LABELS[kind] }),
  );
  const availableConditions = CONDITION_KINDS.filter(
    (kind) => conditionAllowedForTrigger(rule.trigger, kind) && !rule.conditions.some((c) => c.kind === kind),
  );

  /**
   * Edits are applied verbatim, deliberately. Running the config normalizer on
   * every keystroke would rewrite a half-typed value — clearing a percentage to
   * type a new one would drop the whole effect — so the draft is allowed to be
   * temporarily incoherent and the impact panel says what's wrong. Normalization
   * happens once, on save.
   *
   * Approval is the exception: it's re-derived on every edit, because whether a
   * payout can be automatic depends on the trigger and effect the admin just
   * picked, and a stale `false` there is the one mistake that costs money.
   */
  const patch = (next: Partial<CampaignRule>) => {
    const merged = { ...rule, ...next };
    return onChange({
      ...merged,
      requiresApproval: merged.requiresApproval || ruleNeedsApproval(merged.trigger, merged.effect.kind),
    });
  };

  return (
    <div className="space-y-3 rounded-lg bg-white p-3 ring-1 ring-inset ring-ink-100">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Toggle checked={rule.enabled} onChange={(v) => patch({ enabled: v })} label="Rule enabled" />
          <span className="text-sm text-ink-600">{rule.enabled ? "Active" : "Paused"}</span>
          <Select
            value={rule.trigger}
            options={TRIGGERS.map((t) => ({ value: t.id, label: t.label }))}
            onChange={(e) => {
              const trigger = e.target.value as CampaignTrigger;
              patch({
                trigger,
                // Drop what the new trigger can't evaluate or can't deliver.
                conditions: rule.conditions.filter((c) => conditionAllowedForTrigger(trigger, c.kind)),
                effect: effectAllowedForTrigger(trigger, rule.effect.kind)
                  ? rule.effect
                  : createEffect(
                      EFFECT_KINDS.find((k) => effectAllowedForTrigger(trigger, k)) ?? "purchaseDiscount",
                    ),
              });
            }}
            className="min-w-56"
          />
        </div>
        {!readOnly && (
          <button
            type="button"
            onClick={onRemove}
            className="rounded p-1 text-ink-400 transition hover:bg-ink-50 hover:text-ink-700"
            title="Remove rule"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
      <p className="text-[11px] text-ink-400">{meta.description}</p>

      {meta.scheduled && (
        <NumberField
          label="Days after the event"
          value={rule.afterDays}
          step="1"
          min={1}
          className="w-40"
          onChange={(n) => patch({ afterDays: Math.max(1, Math.round(n)) })}
        />
      )}

      {/* ---- Conditions (ANDed) ---- */}
      <div className="space-y-2 border-t border-ink-100 pt-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
            Only when {rule.conditions.length === 0 && <span className="font-normal text-ink-400">(no extra conditions)</span>}
          </div>
          {availableConditions.length > 0 && (
            <Select
              value=""
              options={[
                { value: "", label: "Add condition…" },
                ...availableConditions.map((kind) => ({ value: kind, label: CONDITION_LABELS[kind] })),
              ]}
              onChange={(e) => {
                const kind = e.target.value as RuleConditionKind;
                if (!kind) return;
                patch({ conditions: [...rule.conditions, createCondition(kind)] });
              }}
              className="w-48"
            />
          )}
        </div>
        {rule.conditions.map((condition, i) => (
          <ConditionRow
            key={`${condition.kind}-${i}`}
            condition={condition}
            currency={currency}
            onChange={(next) =>
              patch({ conditions: rule.conditions.map((c, j) => (j === i ? next : c)) })
            }
            onRemove={() => patch({ conditions: rule.conditions.filter((_, j) => j !== i) })}
          />
        ))}
      </div>

      {/* ---- Effect ---- */}
      <div className="space-y-2 border-t border-ink-100 pt-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">They get</div>
          <Select
            value={rule.effect.kind}
            options={effectOptions}
            onChange={(e) => patch({ effect: createEffect(e.target.value as EffectKind) })}
            className="w-64"
          />
        </div>
        <EffectEditor effect={rule.effect} onChange={(effect) => patch({ effect })} currency={currency} />
      </div>

      {/* ---- Limits + approval ---- */}
      <div className="grid gap-2.5 border-t border-ink-100 pt-2.5 sm:grid-cols-2">
        <NumberField
          label="Times per account"
          value={rule.maxPerAccount}
          step="1"
          onChange={(n) => patch({ maxPerAccount: Math.max(0, Math.round(n)) })}
          hint={rule.maxPerAccount === 0 ? "0 means unlimited — the exposure has no ceiling." : undefined}
        />
        <SwitchField
          checked={rule.requiresApproval}
          onChange={(v) => patch({ requiresApproval: v })}
          disabled={approvalForced}
          label="Hold for approval"
          hint={
            approvalForced
              ? rule.trigger === "feedback_submitted"
                ? "Required: nothing can judge whether feedback was useful."
                : `Required: "${meta.label}" happens before any money has moved, so an automatic payout can be farmed.`
              : "Queue each payout for a human instead of delivering it."
          }
        />
      </div>

      <p className="rounded-md bg-ink-50 px-2.5 py-2 text-[11px] leading-relaxed text-ink-600">
        <span className="font-semibold text-ink-500">Reads as:</span> {summarizeRule(rule)}
        {rule.conditions.length > 0 && (
          <>
            {" — "}
            {rule.conditions.map(describeCondition).filter(Boolean).join(", ")}
          </>
        )}
        .
      </p>
    </div>
  );
}

// ---- Conditions -------------------------------------------------------------

function ConditionRow({
  condition,
  onChange,
  onRemove,
  currency,
}: {
  condition: RuleCondition;
  onChange: (condition: RuleCondition) => void;
  onRemove: () => void;
  currency: string;
}) {
  return (
    <div className="flex items-start gap-2 rounded-md bg-ink-50/60 p-2.5">
      <div className="min-w-0 flex-1 space-y-2">
        <div className="text-[11px] font-semibold text-ink-600">{CONDITION_LABELS[condition.kind]}</div>
        <ConditionFields condition={condition} onChange={onChange} currency={currency} />
      </div>
      {!useReadOnly() && (
        <button
          type="button"
          onClick={onRemove}
          className="rounded p-1 text-ink-400 transition hover:bg-white hover:text-ink-700"
          title="Remove condition"
        >
          <Trash2 className="size-3.5" />
        </button>
      )}
    </div>
  );
}

function ConditionFields({
  condition,
  onChange,
  currency,
}: {
  condition: RuleCondition;
  onChange: (condition: RuleCondition) => void;
  currency: string;
}) {
  switch (condition.kind) {
    case "itemType":
      return (
        <Chips
          options={ITEM_OPTIONS}
          selected={condition.items}
          onChange={(items) => onChange({ ...condition, items: items as DiscountItemType[] })}
          emptyHint="Nothing selected — this rule can never fire."
        />
      );
    case "firstPurchase":
    case "isSubscriber":
      return (
        <Select
          value={condition.value ? "yes" : "no"}
          options={
            condition.kind === "firstPurchase"
              ? [
                  { value: "yes", label: "Only their first purchase" },
                  { value: "no", label: "Only a repeat purchase" },
                ]
              : [
                  { value: "yes", label: "Only active members" },
                  { value: "no", label: "Only non-members" },
                ]
          }
          onChange={(e) => onChange({ ...condition, value: e.target.value === "yes" })}
          className="w-56"
        />
      );
    case "minAmount":
      return (
        <NumberField
          label={`Minimum order (${currency})`}
          value={condition.amount}
          step="1"
          className="w-48"
          onChange={(amount) => onChange({ ...condition, amount: Math.max(0, amount) })}
        />
      );
    case "emailVerified":
      return <p className="text-[11px] text-ink-400">No settings — the account&apos;s email must be confirmed.</p>;
    case "accountAge":
      return (
        <Grid cols={2}>
          <NumberField
            label="At least (days old)"
            value={condition.minDays}
            step="1"
            onChange={(minDays) => onChange({ ...condition, minDays: Math.max(0, Math.round(minDays)) })}
          />
          <NumberField
            label="At most (days old)"
            value={condition.maxDays}
            step="1"
            hint="0 means no upper bound."
            onChange={(maxDays) => onChange({ ...condition, maxDays: Math.max(0, Math.round(maxDays)) })}
          />
        </Grid>
      );
    case "hasPlan":
      return (
        <CommaList
          label="Plan ids"
          value={condition.planIds}
          placeholder="studio, family"
          onChange={(planIds) => onChange({ ...condition, planIds })}
        />
      );
    case "country":
      return (
        <CommaList
          label="Countries (ISO-2)"
          value={condition.countries}
          placeholder="US, GB, DE"
          onChange={(countries) =>
            onChange({ ...condition, countries: countries.map((c) => c.toUpperCase().slice(0, 2)) })
          }
        />
      );
    case "productId":
      return (
        <CommaList
          label="Product ids"
          value={condition.productIds}
          placeholder="square-hardcover-8x8"
          onChange={(productIds) => onChange({ ...condition, productIds })}
        />
      );
    case "nthInvoice":
      return (
        <NumberField
          label="From invoice number"
          value={condition.min}
          step="1"
          min={2}
          className="w-48"
          hint="2 is the first renewal."
          onChange={(min) => onChange({ ...condition, min: Math.max(2, Math.round(min)) })}
        />
      );
    case "surveyId":
      return (
        <Field label="Survey id" className="w-64">
          <Input
            value={condition.surveyId}
            placeholder="onboarding"
            onChange={(e) => onChange({ ...condition, surveyId: e.target.value.slice(0, 64) })}
          />
        </Field>
      );
    case "minSparksSpent":
      return (
        <NumberField
          label="Sparks already spent"
          value={condition.sparks}
          step="10"
          suffix="✦"
          className="w-48"
          onChange={(sparks) => onChange({ ...condition, sparks: Math.max(0, Math.round(sparks)) })}
        />
      );
    case "buyerRole":
      return (
        <div className="space-y-2">
          <Chips
            options={BUYER_ROLES.map((value) => ({ value, label: BUYER_ROLE_LABELS[value] }))}
            selected={condition.roles}
            onChange={(roles) => onChange({ ...condition, roles: roles as BuyerRole[] })}
            emptyHint="Nothing selected — this condition does nothing."
          />
          <Select
            value={condition.mode}
            options={[
              { value: "latest", label: "Who they're buying for now" },
              { value: "ever", label: "Anyone who has ever bought for them" },
            ]}
            onChange={(e) =>
              onChange({ ...condition, mode: e.target.value as "latest" | "ever" })
            }
            className="w-72"
          />
          {/* The distinction that makes the survey series worth collecting: "now"
              targets the order in front of them, "ever" targets a durable fact about
              the person. "Ever a parent" is what makes "a parent buying a gift"
              addressable at all. */}
          <p className="text-[11px] leading-relaxed text-ink-400">
            {condition.mode === "ever"
              ? "Sticky: someone who once bought for their own child still matches three orders later, when the book is a gift."
              : "Their most recent answer only. Nobody matches until they've answered a question that identifies a buyer."}
          </p>
        </div>
      );
    case "surveyAnswer":
      return (
        <div className="space-y-2">
          <Grid cols={2}>
            <Field label="Survey id">
              <Input
                value={condition.surveyId}
                placeholder="profile"
                onChange={(e) => onChange({ ...condition, surveyId: e.target.value.slice(0, 64) })}
              />
            </Field>
            <Field label="Question id">
              <Input
                value={condition.questionId}
                placeholder="occasion"
                onChange={(e) => onChange({ ...condition, questionId: e.target.value.slice(0, 64) })}
              />
            </Field>
          </Grid>
          <CommaList
            label="Any of these option ids"
            value={condition.optionIds}
            placeholder="birthday, new_baby"
            onChange={(optionIds) => onChange({ ...condition, optionIds })}
          />
          {/* Ids, not labels, and the copy says so: rewording an option is routine,
              and if this matched on labels a live campaign's audience would silently
              empty out the moment somebody fixed a typo. */}
          <p className="text-[11px] leading-relaxed text-ink-400">
            Ids as configured under Marketing → Surveys, not the wording the
            customer reads. Matches anyone who has ever given one of these answers.
          </p>
        </div>
      );
  }
}

/** A comma-separated list field, for the id/country lists that have no picker. */
function CommaList({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string[];
  placeholder?: string;
  onChange: (value: string[]) => void;
}) {
  return (
    <Field label={label} hint="Comma-separated. Empty means no restriction.">
      <Input
        value={value.join(", ")}
        placeholder={placeholder}
        onChange={(e) =>
          onChange(
            e.target.value
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          )
        }
      />
    </Field>
  );
}

// ---- Effects ----------------------------------------------------------------

function EffectEditor({
  effect,
  onChange,
  currency,
}: {
  effect: CampaignEffect;
  onChange: (effect: CampaignEffect) => void;
  currency: string;
}) {
  switch (effect.kind) {
    case "sparks":
      return <SparksEffectEditor effect={effect} onChange={onChange} />;
    case "spendRefund":
      return <RefundEffectEditor effect={effect} onChange={onChange} currency={currency} />;
    case "actionPricing":
      return <PricingEffectEditor effect={effect} onChange={onChange} />;
    case "purchaseDiscount":
      return <DiscountEffectEditor effect={effect} onChange={onChange} />;
  }
}

function SparksEffectEditor({
  effect,
  onChange,
}: {
  effect: SparksEffect;
  onChange: (effect: CampaignEffect) => void;
}) {
  return (
    <Grid cols={2}>
      <NumberField
        label="Sparks"
        value={effect.sparks}
        step="10"
        suffix="✦"
        onChange={(sparks) => onChange({ ...effect, sparks: Math.max(0, Math.round(sparks)) })}
      />
      <NumberField
        label="Valid for (days)"
        value={effect.expiresInDays}
        step="30"
        hint={
          effect.expiresInDays === 0
            ? "0 means they never expire — an open-ended liability."
            : "Promotional Sparks expire so the exposure ends with the campaign."
        }
        onChange={(expiresInDays) => onChange({ ...effect, expiresInDays: Math.max(0, Math.round(expiresInDays)) })}
      />
    </Grid>
  );
}

function RefundEffectEditor({
  effect,
  onChange,
  currency,
}: {
  effect: SpendRefundEffect;
  onChange: (effect: CampaignEffect) => void;
  currency: string;
}) {
  const tierOptions = useImageTierOptions();
  const scope = (patch: Partial<SpendRefundEffect["scope"]>) =>
    onChange({ ...effect, scope: { ...effect.scope, ...patch } });

  return (
    <div className="space-y-3">
      <Grid cols={3}>
        <NumberField
          label="Share to return"
          value={effect.percent}
          step="5"
          suffix="%"
          onChange={(percent) => onChange({ ...effect, percent: Math.min(100, Math.max(0, percent)) })}
        />
        <NumberField
          label="Ceiling (Sparks)"
          value={effect.maxRefundSparks}
          step="50"
          suffix="✦"
          hint="0 removes this ceiling."
          onChange={(n) => onChange({ ...effect, maxRefundSparks: Math.max(0, Math.round(n)) })}
        />
        <NumberField
          label="Ceiling (% of the order)"
          value={effect.maxPctOfPurchase}
          step="5"
          suffix="%"
          hint="Ties the refund to the size of the sale. The cap that actually keeps this safe."
          onChange={(n) => onChange({ ...effect, maxPctOfPurchase: Math.min(100, Math.max(0, n)) })}
        />
      </Grid>

      {effect.maxRefundSparks === 0 && effect.maxPctOfPurchase === 0 && (
        <p className="flex items-start gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-2 text-[11px] text-rose-800">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" />
          With no ceiling at all, a customer can burn Sparks deliberately and claim them back against your cheapest
          product. Set at least one cap.
        </p>
      )}

      <Grid cols={3}>
        <NumberField
          label="Minimum worth paying"
          value={effect.minRefundSparks}
          step="10"
          suffix="✦"
          onChange={(n) => onChange({ ...effect, minRefundSparks: Math.max(0, Math.round(n)) })}
        />
        <Field label="Below that minimum" hint="Top up rounds small refunds up; skip pays nothing.">
          <Select
            value={effect.minRefundMode}
            options={[
              { value: "skip", label: "Pay nothing" },
              { value: "topUp", label: "Top up to the minimum" },
            ]}
            onChange={(e) =>
              onChange({ ...effect, minRefundMode: e.target.value as SpendRefundEffect["minRefundMode"] })
            }
          />
        </Field>
        <Field label={`Order size is measured in ${currency}`}>
          <p className="pt-2 text-[11px] text-ink-400">
            The percentage ceiling converts through the Spark peg, so it stays right when the peg changes.
          </p>
        </Field>
      </Grid>

      <div className="space-y-2.5 rounded-md bg-ink-50/60 p-2.5">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">What counts as spend</div>
        <Grid cols={2}>
          <Field label="Which Sparks" hint="Refunding given-away Sparks hands back capacity you were never paid for.">
            <Select
              value={effect.scope.funding}
              options={[
                { value: "purchased", label: "Only Sparks they paid for" },
                { value: "all", label: "Every Spark they spent" },
              ]}
              onChange={(e) => scope({ funding: e.target.value as SpendRefundEffect["scope"]["funding"] })}
            />
          </Field>
          <Field label="Which books" hint="Per-book scales with the sale; whole-account does not.">
            <Select
              value={effect.scope.projects}
              options={[
                { value: "purchasedProject", label: "Only the book they bought" },
                { value: "any", label: "Anything on the account" },
              ]}
              onChange={(e) => scope({ projects: e.target.value as SpendRefundEffect["scope"]["projects"] })}
            />
          </Field>
        </Grid>
        <Field label="Only these actions" hint="Empty means every action.">
          <Chips
            options={IMAGE_ACTION_OPTIONS}
            selected={effect.scope.actions}
            onChange={(actions) => scope({ actions })}
            allowEmpty
          />
        </Field>
        <Field label="Only these image tiers" hint="Empty means every tier.">
          <Chips
            options={tierOptions}
            selected={effect.scope.tiers}
            onChange={(tiers) => scope({ tiers: tiers as ImageTier[] })}
            allowEmpty
          />
        </Field>
        <SwitchField
          checked={effect.scope.sinceEnrollment}
          onChange={(sinceEnrollment) => scope({ sinceEnrollment })}
          label="Only spend since the offer started"
          hint="Off means a long-standing customer qualifies on day one for spend that predates the offer."
        />
      </div>
    </div>
  );
}

function PricingEffectEditor({
  effect,
  onChange,
}: {
  effect: ActionPricingEffect;
  onChange: (effect: CampaignEffect) => void;
}) {
  const tierOptions = useImageTierOptions();
  return (
    <div className="space-y-2.5">
      <Grid cols={2}>
        <Field label="How">
          <Select
            value={effect.mode}
            options={[
              { value: "free", label: "Free" },
              { value: "multiplier", label: "Cheaper by a multiplier" },
            ]}
            onChange={(e) => onChange({ ...effect, mode: e.target.value as ActionPricingEffect["mode"] })}
          />
        </Field>
        {effect.mode === "multiplier" && (
          <NumberField
            label="Multiplier"
            value={effect.multiplier}
            step="0.05"
            hint="0.5 is half price. Must be under 1 — an override can never raise a price."
            onChange={(multiplier) => onChange({ ...effect, multiplier: Math.min(0.99, Math.max(0, multiplier)) })}
          />
        )}
      </Grid>
      <Field label="Which actions" hint="Empty means every image action.">
        <Chips
          options={IMAGE_ACTION_OPTIONS}
          selected={effect.actions}
          onChange={(actions) => onChange({ ...effect, actions })}
          allowEmpty
        />
      </Field>
      <Field label="Which image tiers" hint="Empty means every tier.">
        <Chips
          options={tierOptions}
          selected={effect.tiers}
          onChange={(tiers) => onChange({ ...effect, tiers: tiers as ImageTier[] })}
          allowEmpty
        />
      </Field>
      <p className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] leading-relaxed text-amber-800">
        A price break costs you on every render, so its total is set by usage rather than by a redemption cap — the
        daily budget can&apos;t hold it back. Keep it short and watch Analysis → Costs while it runs.
      </p>
    </div>
  );
}

function DiscountEffectEditor({
  effect,
  onChange,
}: {
  effect: PurchaseDiscountEffect;
  onChange: (effect: CampaignEffect) => void;
}) {
  return (
    <div className="space-y-2.5">
      <Grid cols={2}>
        <NumberField
          label="Percent off"
          value={effect.percentOff}
          step="5"
          suffix="%"
          onChange={(percentOff) => onChange({ ...effect, percentOff: Math.min(100, Math.max(0, percentOff)) })}
        />
        <NumberField
          label="Valid for (days)"
          value={effect.expiresInDays}
          step="15"
          hint="0 means it lasts until the campaign ends."
          onChange={(expiresInDays) => onChange({ ...effect, expiresInDays: Math.max(0, Math.round(expiresInDays)) })}
        />
      </Grid>
      <Field label="Redeemable against">
        <Chips
          options={ITEM_OPTIONS}
          selected={effect.appliesTo}
          onChange={(appliesTo) => onChange({ ...effect, appliesTo: appliesTo as DiscountItemType[] })}
          emptyHint="Nothing selected — this discount can't be redeemed anywhere."
        />
      </Field>
      {effect.appliesTo.includes("plan") && (
        <SwitchField
          checked={effect.recurring}
          onChange={(recurring) => onChange({ ...effect, recurring })}
          label="Applies to every renewal"
          hint="A permanent haircut on that subscriber's lifetime value. A first-invoice discount buys the same signup for one month's cost."
        />
      )}
    </div>
  );
}

/** Add-a-rule button, kept here so the shell doesn't import the effect defaults. */
export function AddRuleButton({ disabled, onAdd }: { disabled: boolean; onAdd: () => void }) {
  if (useReadOnly()) return null;
  return (
    <Button type="button" size="sm" variant="secondary" disabled={disabled} onClick={onAdd}>
      <Plus className="size-3.5" /> Add rule
    </Button>
  );
}
