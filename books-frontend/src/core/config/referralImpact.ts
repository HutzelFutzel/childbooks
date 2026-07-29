/**
 * **Referral business-impact engine** — "what does this reward schedule do to my
 * business?", answered with the same math the rest of the admin already trusts.
 *
 * Nothing here is new economics. Sparks rewards are costed with
 * {@link grantLiabilityUsd} (peg ÷ markup, inflated by the most generous plan's
 * action multiplier, exactly like the plan grants). Discount rewards are costed
 * and validated against the catalog-wide discount engine in `discountImpact.ts`,
 * which already knows every item's break-even and safe-max depth for its worst
 * eligible buyer. Free months are costed as the invoice you don't collect PLUS
 * the Spark grant you still hand over.
 *
 * What's new is the aggregation, which is where referral programs actually go
 * wrong: the cost of a referral is the WHOLE ladder (every enabled rule, both
 * sides), not one event, and the exposure is that ladder times the lifetime cap
 * times your user base.
 *
 * Amounts are in the pricing base currency. Spark liabilities are provider USD;
 * as everywhere else in the admin economics screens, the two are read as one
 * unit — a distinction that only matters if the base currency drifts far from
 * the dollar the providers bill in.
 *
 * Pure functions, no I/O. Advisory, except that the admin editor refuses to save
 * a rule carrying a `block` warning.
 */
import { grantLiabilityUsd, worstActionMultiplier } from "./economics";
import {
  catalogDiscountImpacts,
  type DiscountImpact,
  type DiscountItemType,
} from "./discountImpact";
import type { PublicPlan } from "./plans";
import type { CurrencyCode, PricingSettings, ProductDefinition } from "./products";
import { packTotalSparks, type SparksConfig } from "./sparks";
import {
  TRIGGER_META,
  describeReward,
  type ReferralConfig,
  type Reward,
  type RewardKind,
  type RewardRule,
  type RewardSide,
} from "./referral";

/** One reward's worst-case cost, as a row in the admin's impact table. */
export interface RewardCostRow {
  ruleId: string;
  triggerLabel: string;
  side: RewardSide;
  kind: RewardKind;
  /** e.g. "100 ✦" or "15% off printed books". */
  description: string;
  /** Worst-case cost of paying this reward once, in the base currency. */
  cost: number;
  /** How the cost was derived, in plain language. */
  note: string;
}

export type ImpactSeverity = "block" | "warn";

export interface ImpactWarning {
  severity: ImpactSeverity;
  /** The rule at fault, or null for a program-level problem. */
  ruleId: string | null;
  message: string;
}

export interface ReferralImpact {
  currency: CurrencyCode;
  rows: RewardCostRow[];
  /** Worst-case cost of ONE fully-completed referral (all rules, both sides). */
  perReferralCost: number;
  referrerCost: number;
  referredCost: number;
  /** The most a single user can cost you, at the lifetime rewarded cap. */
  maxPerUserCost: number;
  /** How many completed referrals one day's budget absorbs (0 ⇒ uncapped). */
  referralsPerDailyBudget: number;
  /**
   * The item with the most profit per sale, and how many such sales one referral
   * payout consumes — the plainest statement of whether the program can pay for
   * itself.
   */
  payback: { itemLabel: string; netProfit: number; salesPerReferral: number } | null;
  warnings: ImpactWarning[];
}

export interface ReferralImpactArgs {
  referral: ReferralConfig;
  sparks: SparksConfig;
  settings: PricingSettings;
  /** Full admin product definitions. Empty ⇒ print rows can't be modeled. */
  products: ProductDefinition[];
  plans: PublicPlan[];
  /** Defaults to the pricing base currency. */
  currency?: CurrencyCode;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The most generous action multiplier any active plan grants. A referred user
 * might well be (or become) a member of the most discounted plan, and a
 * discounted Spark buys MORE provider work — so this is the multiplier a
 * worst-case Spark liability has to assume.
 */
function worstMultiplierAcrossPlans(plans: PublicPlan[]): number {
  const active = plans.filter((p) => p.status === "active");
  if (active.length === 0) return 1;
  return Math.min(1, ...active.map((p) => worstActionMultiplier(p.actionMultipliers)));
}

/** Impacts for the item types a discount reward may be redeemed against. */
function eligibleImpacts(all: DiscountImpact[], appliesTo: DiscountItemType[]): DiscountImpact[] {
  const scope = appliesTo.length > 0 ? appliesTo : (["print", "ebook", "pack", "plan"] as DiscountItemType[]);
  return all.filter((i) => scope.includes(i.itemType));
}

/** Cost + limits of one discount reward against the catalog. */
function discountCost(
  reward: Extract<Reward, { kind: "discount" }>,
  all: DiscountImpact[],
): { cost: number; note: string; safeMax: number | null; breakEven: number | null; limiting: string | null } {
  const eligible = eligibleImpacts(all, reward.appliesTo);
  if (eligible.length === 0) {
    return {
      cost: 0,
      note: "No priced items match this discount yet, so its cost can't be modeled.",
      safeMax: null,
      breakEven: null,
      limiting: null,
    };
  }
  // Worst case: redeemed against the most expensive thing it's valid for, by the
  // buyer who already pays the least for it.
  let worst = eligible[0];
  let worstGiveUp = 0;
  for (const impact of eligible) {
    const giveUp = (impact.listPrice * reward.percentOff) / 100;
    if (giveUp > worstGiveUp) {
      worstGiveUp = giveUp;
      worst = impact;
    }
  }
  let limiting = eligible[0];
  for (const impact of eligible) {
    if (impact.safeMaxDiscountPct < limiting.safeMaxDiscountPct) limiting = impact;
  }
  return {
    cost: round2(worstGiveUp),
    note: `Revenue given up if redeemed on ${worst.itemLabel} (${worst.buyerLabel}).`,
    safeMax: limiting.safeMaxDiscountPct,
    breakEven: limiting.breakEvenDiscountPct,
    limiting: limiting.itemLabel,
  };
}

/** Cost of gifting membership months: the invoices forgone plus the grants given. */
function freeMonthsCost(
  reward: Extract<Reward, { kind: "freeMonths" }>,
  sparks: SparksConfig,
  plans: PublicPlan[],
  currency: CurrencyCode,
): { cost: number; note: string; worstPlan: PublicPlan | null; grantLiability: number; monthlyPrice: number } {
  const paid = plans.filter((p) => p.status === "active" && !p.isFree);
  let worstPlan: PublicPlan | null = null;
  let worstCost = 0;
  let worstPrice = 0;
  let worstGrant = 0;
  for (const plan of paid) {
    const monthlyPrice = plan.prices[currency]?.month?.amount ?? 0;
    const grant = grantLiabilityUsd(sparks, plan.grant.monthlySparks, worstActionMultiplier(plan.actionMultipliers));
    const cost = (monthlyPrice + grant) * reward.months;
    if (cost > worstCost) {
      worstCost = cost;
      worstPlan = plan;
      worstPrice = monthlyPrice;
      worstGrant = grant;
    }
  }
  if (!worstPlan) {
    return {
      cost: 0,
      note: "No paid membership is configured, so this reward can't be delivered yet.",
      worstPlan: null,
      grantLiability: 0,
      monthlyPrice: 0,
    };
  }
  return {
    cost: round2(worstCost),
    note:
      `${reward.months} × (${worstPlan.name} invoice not collected + the Spark grant still delivered) — ` +
      `the grant alone is worth ${round2(worstGrant)}.`,
    worstPlan,
    grantLiability: round2(worstGrant),
    monthlyPrice: round2(worstPrice),
  };
}

/** The Sparks in the smallest active pack — the SKU a Spark reward competes with. */
function smallestPackSparks(sparks: SparksConfig): number | null {
  const active = sparks.packs.filter((p) => p.active && packTotalSparks(p) > 0);
  if (active.length === 0) return null;
  return Math.min(...active.map(packTotalSparks));
}

/**
 * Cost every enabled reward, aggregate the ladder, and raise the cross-relation
 * warnings that a single-reward view can't see.
 */
export function referralImpact(args: ReferralImpactArgs): ReferralImpact {
  const { referral, sparks, settings, products, plans } = args;
  const currency = args.currency ?? settings.baseCurrency;
  const rows: RewardCostRow[] = [];
  const warnings: ImpactWarning[] = [];

  let impacts: DiscountImpact[] = [];
  try {
    impacts = catalogDiscountImpacts({ settings, sparks, products, plans, currency });
  } catch {
    // A half-configured catalog must not break the panel — discount rewards
    // simply report as unmodelable below.
  }

  const planMultiplier = worstMultiplierAcrossPlans(plans);
  const packSparks = smallestPackSparks(sparks);
  const enabled = referral.rules.filter((r) => r.enabled);

  const addReward = (rule: RewardRule, side: RewardSide, reward: Reward): void => {
    const triggerLabel = TRIGGER_META[rule.trigger].label;
    const base = {
      ruleId: rule.id,
      triggerLabel,
      side,
      kind: reward.kind,
      description: describeReward(reward),
    };

    if (reward.kind === "sparks") {
      const cost = grantLiabilityUsd(sparks, reward.sparks, planMultiplier);
      rows.push({
        ...base,
        cost,
        note:
          `Provider spend if all ${reward.sparks} Sparks are used` +
          (planMultiplier < 1 ? ` by a member with ${planMultiplier}× action pricing.` : "."),
      });
      if (packSparks != null && reward.sparks >= packSparks) {
        warnings.push({
          severity: "warn",
          ruleId: rule.id,
          message:
            `This ${reward.sparks} ✦ reward is at least as big as your smallest Spark pack (${packSparks} ✦), ` +
            `so you're giving away something people can buy. Consider keeping rewards below one pack.`,
        });
      }
      if (!sparks.enabled) {
        warnings.push({
          severity: "warn",
          ruleId: rule.id,
          message:
            "The Sparks economy is switched off, so Spark rewards can't be granted — they'll be held for review " +
            "until it's back on.",
        });
      }
      return;
    }

    if (reward.kind === "discount") {
      const { cost, note, safeMax, breakEven, limiting } = discountCost(reward, impacts);
      rows.push({ ...base, cost, note });
      if (breakEven != null && reward.percentOff > breakEven) {
        warnings.push({
          severity: "block",
          ruleId: rule.id,
          message:
            `${reward.percentOff}% off is past break-even on ${limiting} (break-even is ${breakEven}%). ` +
            `Every redemption on that item would lose money after costs, fees and tax.`,
        });
      } else if (safeMax != null && reward.percentOff > safeMax) {
        warnings.push({
          severity: "warn",
          ruleId: rule.id,
          message:
            `${reward.percentOff}% off drops ${limiting} below your ${settings.minMarginPct}% margin floor ` +
            `(safe maximum there is ${safeMax}%). It still earns something, just less than you've decided is acceptable.`,
        });
      }
      return;
    }

    const { cost, note, worstPlan, grantLiability, monthlyPrice } = freeMonthsCost(reward, sparks, plans, currency);
    rows.push({ ...base, cost, note });
    if (worstPlan && grantLiability > monthlyPrice && monthlyPrice > 0) {
      warnings.push({
        severity: "warn",
        ruleId: rule.id,
        message:
          `A free month of ${worstPlan.name} hands over ${grantLiability} of Sparks against a ${monthlyPrice} invoice, ` +
          `so the gifted month costs you more than a sold one earns.`,
      });
    }
    if (!rule.conditions.referrerMustBeSubscriber) {
      warnings.push({
        severity: "block",
        ruleId: rule.id,
        message:
          "Free months must be limited to referrers who are already paying members — otherwise it's an acquisition " +
          "giveaway with no revenue behind it.",
      });
    }
  };

  for (const rule of enabled) {
    if (rule.referrer) addReward(rule, "referrer", rule.referrer);
    if (rule.referred) addReward(rule, "referred", rule.referred);
    if (!rule.referrer && !rule.referred) {
      warnings.push({
        severity: "warn",
        ruleId: rule.id,
        message: `"${TRIGGER_META[rule.trigger].label}" is enabled but rewards nobody — it will never do anything.`,
      });
    }
  }

  const referrerCost = round2(rows.filter((r) => r.side === "referrer").reduce((s, r) => s + r.cost, 0));
  const referredCost = round2(rows.filter((r) => r.side === "referred").reduce((s, r) => s + r.cost, 0));
  const perReferralCost = round2(referrerCost + referredCost);

  // The best per-sale profit in the catalog: how much one sale actually earns,
  // so the payout can be read as "N sales" rather than an abstract number.
  let payback: ReferralImpact["payback"] = null;
  for (const impact of impacts) {
    const netProfit = impact.atDiscount(0).netProfit;
    if (netProfit > (payback?.netProfit ?? 0)) {
      payback = {
        itemLabel: impact.itemLabel,
        netProfit: round2(netProfit),
        salesPerReferral: netProfit > 0 ? Math.round((perReferralCost / netProfit) * 10) / 10 : 0,
      };
    }
  }
  if (payback && perReferralCost > payback.netProfit && payback.netProfit > 0) {
    warnings.push({
      severity: "warn",
      ruleId: null,
      message:
        `One completed referral costs up to ${perReferralCost}, more than the ${payback.netProfit} you earn on your ` +
        `most profitable sale (${payback.itemLabel}). A referred customer has to buy ${payback.salesPerReferral}× ` +
        `before the referral pays for itself.`,
    });
  }

  const budget = referral.limits.dailyBudgetAmount;
  if (budget <= 0 && perReferralCost > 0) {
    warnings.push({
      severity: "warn",
      ruleId: null,
      message:
        "There's no daily payout budget, so a misconfiguration or a farming wave has nothing to stop it. " +
        "Set a budget to get an automatic pause plus an alert.",
    });
  }

  return {
    currency,
    rows,
    perReferralCost,
    referrerCost,
    referredCost,
    maxPerUserCost: round2(perReferralCost * referral.limits.maxRewardedReferralsPerUser),
    referralsPerDailyBudget: budget > 0 && perReferralCost > 0 ? Math.floor(budget / perReferralCost) : 0,
    payback,
    warnings,
  };
}

/** True when nothing blocks saving this configuration. */
export function impactBlocks(impact: ReferralImpact): ImpactWarning[] {
  return impact.warnings.filter((w) => w.severity === "block");
}
