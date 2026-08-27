/**
 * **Campaign business-impact engine** — "what does this campaign do to my
 * business?", answered with the same math the rest of the admin already trusts.
 *
 * Nothing here is new economics. Spark grants and refunds are costed with
 * {@link grantLiabilityUsd} (peg ÷ markup, inflated by the most generous plan's
 * action multiplier) exactly like plan grants and referral rewards. Purchase
 * discounts are costed and validated against the catalog-wide discount engine in
 * `discountImpact.ts`, which already knows every item's break-even and its safe
 * maximum depth for its worst eligible buyer. Price overrides are costed as the
 * provider spend that no longer has a Spark behind it.
 *
 * What's new is the aggregation, because that's where campaigns actually go
 * wrong. Three numbers matter and none of them is visible from a single rule:
 *
 *   1. **Per account.** Every enabled rule can fire up to its own per-account
 *      cap, so one customer's exposure is a sum of products, not a single payout.
 *   2. **Total.** Per-account cost times the redemption cap — and where there is
 *      no cap, the honest answer is "unbounded", which is why an uncapped
 *      campaign with a cash effect blocks rather than warns.
 *   3. **Per day.** The daily budget divided by per-account cost is the number of
 *      customers a single day can serve before the breaker trips. An admin who
 *      knows that number will not be surprised by it at 3am.
 *
 * Amounts are in the pricing base currency. Spark liabilities are provider USD;
 * as everywhere else in the admin economics screens, the two are read as one unit
 * — a distinction that only matters if the base currency drifts far from the
 * dollar the providers bill in.
 *
 * Pure functions, no I/O. Advisory, except that the admin editor refuses to save
 * a campaign carrying a `block` warning.
 */
import { grantLiabilityUsd, worstActionMultiplier } from "./economics";
import {
  catalogDiscountImpacts,
  type DiscountImpact,
  type DiscountItemType,
} from "./discountImpact";
import type { PublicPlan } from "./plans";
import type { CurrencyCode, PricingSettings, ProductDefinition } from "./products";
import type { ShippingSettings } from "./shipping";
import { packTotalSparks, type SparksConfig } from "./sparks";
import { IMAGE_TIERS, type ImageTier } from "./modelConfig";
import { ALL_IMAGE_ACTION_IDS } from "../ai/actions";
import {
  TRIGGER_META,
  describeEffect,
  type Campaign,
  type CampaignEffect,
  type CampaignRule,
  type EffectKind,
} from "./campaigns";
// The same two severities the referral engine uses, so the admin's warning
// treatments (and the refusal to save on a `block`) behave identically here.
import type { ImpactSeverity } from "./referralImpact";

/** One rule's worst-case cost, as a row in the admin's impact table. */
export interface EffectCostRow {
  ruleId: string;
  triggerLabel: string;
  kind: EffectKind;
  /** e.g. "240 Sparks" or "15% off printed books". */
  description: string;
  /** Worst-case cost of this rule firing once, in the base currency. */
  cost: number;
  /** Times this rule may fire for one account (0 ⇒ unlimited). */
  maxPerAccount: number;
  /** Worst-case cost of this rule across one account's whole life. */
  lifetimeCost: number;
  /** How the cost was derived, in plain language. */
  note: string;
  /** True when the cost has no ceiling the config can express. */
  unbounded: boolean;
}

export interface CampaignWarning {
  severity: ImpactSeverity;
  /** The rule at fault, or null for a campaign-level problem. */
  ruleId: string | null;
  message: string;
}

export interface CampaignImpact {
  currency: CurrencyCode;
  rows: EffectCostRow[];
  /** Worst-case cost of ONE account taking everything the campaign offers. */
  perAccountCost: number;
  /** Per-account cost across the redemption cap, or null when uncapped. */
  totalExposure: number | null;
  /** How many accounts one day's budget absorbs (0 ⇒ no budget set). */
  accountsPerDailyBudget: number;
  /** Days the lifetime budget lasts at the daily budget (null ⇒ no cap). */
  daysOfLifetimeBudget: number | null;
  /**
   * The item with the most profit per sale, and how many such sales one account's
   * payout consumes — the plainest statement of whether the campaign can pay for
   * itself.
   */
  payback: { itemLabel: string; netProfit: number; salesPerAccount: number } | null;
  warnings: CampaignWarning[];
}

export interface CampaignImpactArgs {
  campaign: Campaign;
  sparks: SparksConfig;
  settings: PricingSettings;
  /** Full admin product definitions. Empty ⇒ discount rows can't be modeled. */
  products: ProductDefinition[];
  plans: PublicPlan[];
  /** Defaults to the pricing base currency. */
  currency?: CurrencyCode;
  /** Catalog-wide shipping policy — part of every print row's margin. */
  shipping: ShippingSettings;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The most generous action multiplier any active plan grants. The account taking
 * the offer might well be (or become) a member of the most discounted plan, and a
 * discounted Spark buys MORE provider work — so this is the multiplier a
 * worst-case Spark liability has to assume.
 */
function worstMultiplierAcrossPlans(plans: PublicPlan[]): number {
  const active = plans.filter((p) => p.status === "active");
  if (active.length === 0) return 1;
  return Math.min(1, ...active.map((p) => worstActionMultiplier(p.actionMultipliers)));
}

/** Impacts for the item types a discount may be redeemed against. */
function eligibleImpacts(all: DiscountImpact[], appliesTo: DiscountItemType[]): DiscountImpact[] {
  const scope = appliesTo.length > 0 ? appliesTo : (["print", "ebook", "pack", "plan"] as DiscountItemType[]);
  return all.filter((i) => scope.includes(i.itemType));
}

/** The Sparks in the smallest active pack — the SKU a Spark payout competes with. */
function smallestPackSparks(sparks: SparksConfig): number | null {
  const active = sparks.packs.filter((p) => p.active && packTotalSparks(p) > 0);
  if (active.length === 0) return null;
  return Math.min(...active.map(packTotalSparks));
}

/**
 * The Spark price of the most expensive action a price override covers. A price
 * break's cost is per render and therefore per USE, not per account — so the
 * per-action figure is the only honest unit to quote, and the caller says so.
 */
function dearestCoveredAction(
  sparks: SparksConfig,
  actions: string[],
  tiers: ImageTier[],
): { actionId: string; sparks: number } | null {
  const scope = actions.length > 0 ? actions : ALL_IMAGE_ACTION_IDS;
  // Tiers don't change the configured Spark price (that's a runtime multiplier),
  // so a tier-scoped override is costed at the same per-render price — narrowing
  // to a tier reduces how OFTEN it fires, not what each firing costs.
  void tiers;
  let best: { actionId: string; sparks: number } | null = null;
  for (const id of scope) {
    const pricing = sparks.actions[id];
    if (!pricing) continue;
    const price = pricing.mode === "free" ? 0 : Math.max(pricing.fixedSparks, pricing.estimatedSparks);
    if (price > (best?.sparks ?? -1)) best = { actionId: id, sparks: price };
  }
  return best;
}

/** The worst-case Sparks a single spend refund can hand back. */
function refundCeilingSparks(
  effect: Extract<CampaignEffect, { kind: "spendRefund" }>,
  sparks: SparksConfig,
): { ceiling: number | null; basis: string } {
  if (effect.maxRefundSparks > 0) {
    return { ceiling: effect.maxRefundSparks, basis: `the ${effect.maxRefundSparks}-Spark ceiling` };
  }
  if (effect.maxPctOfPurchase > 0) {
    // Without a Spark ceiling the exposure is set by the purchase, which the
    // config can't know — so it's quoted per unit of purchase value instead.
    const perUnit = sparks.sparkValueUsd > 0 ? effect.maxPctOfPurchase / 100 : 0;
    return {
      ceiling: null,
      basis: `${effect.maxPctOfPurchase}% of whatever was bought (${round2(perUnit)} per unit of order value)`,
    };
  }
  return { ceiling: null, basis: "nothing at all" };
}

/**
 * Cost every enabled rule, aggregate the campaign, and raise the cross-relation
 * warnings a single-rule view can't see.
 */
export function campaignImpact(args: CampaignImpactArgs): CampaignImpact {
  const { campaign, sparks, settings, products, plans, shipping } = args;
  const currency = args.currency ?? settings.baseCurrency;
  const rows: EffectCostRow[] = [];
  const warnings: CampaignWarning[] = [];

  let impacts: DiscountImpact[] = [];
  try {
    impacts = catalogDiscountImpacts({ settings, sparks, products, plans, currency, shipping });
  } catch {
    // A half-configured catalog must not break the panel — discount rules simply
    // report as unmodelable below.
  }

  const planMultiplier = worstMultiplierAcrossPlans(plans);
  const packSparks = smallestPackSparks(sparks);
  const enabled = campaign.rules.filter((r) => r.enabled);
  const cashRules = enabled.filter((r) => r.effect.kind === "sparks" || r.effect.kind === "spendRefund");

  const addRule = (rule: CampaignRule): void => {
    const effect = rule.effect;
    const base = {
      ruleId: rule.id,
      triggerLabel: TRIGGER_META[rule.trigger].label,
      kind: effect.kind,
      description: describeEffect(effect, { plain: true }),
      maxPerAccount: rule.maxPerAccount,
    };
    const push = (cost: number, note: string, unbounded = false): void => {
      rows.push({
        ...base,
        cost: round2(cost),
        // A per-account cap of 0 means unlimited, which makes the lifetime figure
        // meaningless rather than large — so it's reported as unbounded.
        lifetimeCost: rule.maxPerAccount > 0 ? round2(cost * rule.maxPerAccount) : round2(cost),
        note,
        unbounded: unbounded || rule.maxPerAccount === 0,
      });
    };

    switch (effect.kind) {
      case "sparks": {
        const cost = grantLiabilityUsd(sparks, effect.sparks, planMultiplier);
        push(
          cost,
          `Provider spend if all ${effect.sparks} Sparks are used` +
            (planMultiplier < 1 ? ` by a member with ${planMultiplier}× action pricing.` : "."),
        );
        if (packSparks != null && effect.sparks >= packSparks) {
          warnings.push({
            severity: "warn",
            ruleId: rule.id,
            message:
              `This ${effect.sparks} ✦ grant is at least as big as your smallest Spark pack (${packSparks} ✦), ` +
              `so you're giving away something people can buy. Consider keeping grants below one pack.`,
          });
        }
        if (effect.expiresInDays === 0) {
          warnings.push({
            severity: "warn",
            ruleId: rule.id,
            message:
              "These Sparks never expire, so the liability stays on your books forever. Give promotional Sparks a life " +
              "and the exposure ends with the campaign.",
          });
        }
        return;
      }

      case "spendRefund": {
        const { ceiling, basis } = refundCeilingSparks(effect, sparks);
        if (ceiling === null) {
          push(
            0,
            `Capped by ${basis}, so the worst case depends on the order rather than the campaign.`,
            true,
          );
          if (effect.maxPctOfPurchase === 0) {
            warnings.push({
              severity: "block",
              ruleId: rule.id,
              message:
                "This refund has no ceiling. Spent Sparks are provider work you have already paid for in cash, so an " +
                "uncapped refund is unbounded exposure — a customer can burn Sparks deliberately and claim them back " +
                "against your cheapest product. Set a Spark cap, a share-of-purchase cap, or both.",
            });
          }
        } else {
          push(
            grantLiabilityUsd(sparks, ceiling, planMultiplier),
            `Worst case is ${basis}, valued as the provider spend those Sparks already consumed.`,
          );
        }
        if (effect.scope.funding === "all") {
          warnings.push({
            severity: "warn",
            ruleId: rule.id,
            message:
              "This refunds Sparks that were given away as well as ones that were bought, so it hands back provider " +
              "capacity you were never paid for. Restrict it to purchased Sparks unless the giveaway is the point.",
          });
        }
        if (!effect.scope.sinceEnrollment && effect.scope.projects === "any") {
          warnings.push({
            severity: "warn",
            ruleId: rule.id,
            message:
              "This looks back over an account's entire history, so a long-standing customer qualifies on day one for " +
              "spend that predates the offer. Limiting it to this book, or to spend since the offer started, ties the " +
              "cost to behaviour the campaign actually caused.",
          });
        }
        return;
      }

      case "actionPricing": {
        const dearest = dearestCoveredAction(sparks, effect.actions, effect.tiers);
        const share = effect.mode === "free" ? 1 : 1 - Math.min(1, Math.max(0, effect.multiplier));
        if (!dearest || dearest.sparks === 0 || share === 0) {
          push(0, "No priced action matches this override, so it costs nothing to run.");
          return;
        }
        const perRender = grantLiabilityUsd(sparks, dearest.sparks * share, planMultiplier);
        push(
          perRender,
          `Per render: ${Math.round(dearest.sparks * share)} Sparks of provider spend with no Spark behind it ` +
            `(${dearest.actionId} is the dearest action covered). This repeats for every render, not once per account.`,
          true,
        );
        warnings.push({
          severity: "warn",
          ruleId: rule.id,
          message:
            `A price break costs you per render, so its total is set by usage rather than by a redemption cap. ` +
            `The daily budget does not hold it back${
              effect.tiers.length === 0 || effect.tiers.length >= IMAGE_TIERS.length
                ? " and it covers every image tier"
                : ""
            } — keep it short, and watch Analysis → Costs while it runs.`,
        });
        return;
      }

      case "purchaseDiscount": {
        const eligible = eligibleImpacts(impacts, effect.appliesTo);
        if (eligible.length === 0) {
          push(0, "No priced items match this discount yet, so its cost can't be modeled.");
          return;
        }
        // Worst case: redeemed against the most expensive thing it's valid for, by
        // the buyer who already pays the least for it.
        let worst = eligible[0];
        let worstGiveUp = 0;
        for (const impact of eligible) {
          const giveUp = (impact.listPrice * effect.percentOff) / 100;
          if (giveUp > worstGiveUp) {
            worstGiveUp = giveUp;
            worst = impact;
          }
        }
        let limiting = eligible[0];
        for (const impact of eligible) {
          if (impact.safeMaxDiscountPct < limiting.safeMaxDiscountPct) limiting = impact;
        }
        push(
          worstGiveUp,
          `Revenue given up if redeemed on ${worst.itemLabel} (${worst.buyerLabel}).` +
            (effect.recurring ? " Charged against every renewal, not just the first." : ""),
        );
        if (effect.percentOff > limiting.breakEvenDiscountPct) {
          warnings.push({
            severity: "block",
            ruleId: rule.id,
            message:
              `${effect.percentOff}% off is past break-even on ${limiting.itemLabel} (break-even is ` +
              `${limiting.breakEvenDiscountPct}%). Every redemption on that item would lose money after costs, fees ` +
              `and tax.`,
          });
        } else if (effect.percentOff > limiting.safeMaxDiscountPct) {
          warnings.push({
            severity: "warn",
            ruleId: rule.id,
            message:
              `${effect.percentOff}% off drops ${limiting.itemLabel} below your ${settings.minMarginPct}% margin floor ` +
              `(safe maximum there is ${limiting.safeMaxDiscountPct}%). It still earns something, just less than ` +
              `you've decided is acceptable.`,
          });
        }
        if (effect.recurring) {
          warnings.push({
            severity: "warn",
            ruleId: rule.id,
            message:
              "A recurring discount is a permanent haircut on that subscriber's lifetime value — it applies to every " +
              "renewal for as long as they stay. A first-invoice discount buys the same signup for one month's cost.",
          });
        }
        return;
      }
    }
  };

  for (const rule of enabled) addRule(rule);

  if (enabled.length === 0) {
    warnings.push({
      severity: campaign.status === "active" ? "block" : "warn",
      ruleId: null,
      message: "No rule is enabled, so this campaign does nothing at all.",
    });
  }

  const perAccountCost = round2(rows.reduce((sum, r) => sum + r.lifetimeCost, 0));
  const anyUnbounded = rows.some((r) => r.unbounded);

  // The best per-sale profit in the catalog: how much one sale actually earns, so
  // the payout can be read as "N sales" rather than an abstract number.
  let payback: CampaignImpact["payback"] = null;
  for (const impact of impacts) {
    const netProfit = impact.atDiscount(0).netProfit;
    if (netProfit > (payback?.netProfit ?? 0)) {
      payback = {
        itemLabel: impact.itemLabel,
        netProfit: round2(netProfit),
        salesPerAccount: netProfit > 0 ? Math.round((perAccountCost / netProfit) * 10) / 10 : 0,
      };
    }
  }
  if (payback && perAccountCost > payback.netProfit && payback.netProfit > 0) {
    warnings.push({
      severity: "warn",
      ruleId: null,
      message:
        `One account can cost up to ${perAccountCost}, more than the ${payback.netProfit} you earn on your most ` +
        `profitable sale (${payback.itemLabel}). They have to buy ${payback.salesPerAccount}× before the campaign ` +
        `pays for itself.`,
    });
  }

  const { dailyBudget, lifetimeBudget, maxTotal } = campaign.limits;

  if (dailyBudget <= 0 && cashRules.length > 0) {
    warnings.push({
      severity: "block",
      ruleId: null,
      message:
        "This campaign hands over Sparks with no daily budget. That budget is the only circuit breaker between a " +
        "misconfigured rule and an unbounded payout — set one.",
    });
  }
  if (maxTotal <= 0 && anyUnbounded && cashRules.length > 0) {
    warnings.push({
      severity: "warn",
      ruleId: null,
      message:
        "There's no cap on total redemptions and at least one payout has no ceiling of its own, so the campaign's " +
        "total cost is genuinely unbounded. A total cap turns it into a number you can budget for.",
    });
  }
  if (campaign.holdoutPct === 0 && perAccountCost > 0) {
    warnings.push({
      severity: "warn",
      ruleId: null,
      message:
        "With no holdout group there's no way to tell a purchase this campaign caused from one that would have " +
        "happened anyway — you'll pay for both and won't be able to distinguish them. Even 5% held back makes the " +
        "report mean something.",
    });
  }
  if (campaign.audience.allowGuests && cashRules.length > 0) {
    warnings.push({
      severity: "block",
      ruleId: null,
      message:
        "Guest sessions cost nothing to create and have no payment relationship, so letting them earn Sparks is a " +
        "faucet. Require a real account for anything with cash value.",
    });
  }
  if (!campaign.audience.requireVerified && cashRules.length > 0) {
    warnings.push({
      severity: "warn",
      ruleId: null,
      message:
        "Without email verification, one person can take this offer as many times as they can make addresses. " +
        "Verification is the cheapest anti-farming gate there is.",
    });
  }
  if (!sparks.enabled && cashRules.length > 0) {
    warnings.push({
      severity: "warn",
      ruleId: null,
      message:
        "The Sparks economy is switched off, so Spark payouts can't be delivered — they'll pile up under Held payouts " +
        "until it's back on.",
    });
  }
  if (campaign.window.endsAt === 0 && campaign.status === "active") {
    warnings.push({
      severity: "warn",
      ruleId: null,
      message:
        "This campaign has no end date, so it runs until someone remembers to stop it. An end date makes it stop on " +
        "purpose instead.",
    });
  }

  return {
    currency,
    rows,
    perAccountCost,
    totalExposure: maxTotal > 0 && !anyUnbounded ? round2(perAccountCost * maxTotal) : null,
    accountsPerDailyBudget: dailyBudget > 0 && perAccountCost > 0 ? Math.floor(dailyBudget / perAccountCost) : 0,
    daysOfLifetimeBudget:
      lifetimeBudget > 0 && dailyBudget > 0 ? Math.floor(lifetimeBudget / dailyBudget) : null,
    payback,
    warnings,
  };
}

/** Everything that must be fixed before this campaign can be saved. */
export function campaignBlocks(impact: CampaignImpact): CampaignWarning[] {
  return impact.warnings.filter((w) => w.severity === "block");
}
