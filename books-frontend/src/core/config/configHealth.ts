/**
 * **Config health** — cross-document economic validation. Single edits are
 * individually plausible but can combine into money-losing configurations
 * (e.g. raising the Sparks markup makes a pack fine, then a plan's 0.5×
 * render discount quietly sinks it again). This module runs the whole catalog
 * through the discount-impact engine across every currency and buyer context
 * and reports findings with an honest severity taxonomy:
 *
 *   - `error`   — an OUT-OF-POCKET LOSS: some sale, for some eligible buyer,
 *                 pays out more than it takes in. Always a mistake.
 *   - `warning` — a broken promise or thin ice: advertised discounts that get
 *                 clamped, margins below the configured floor, a planned max
 *                 discount the catalog can't absorb.
 *   - `info`    — deliberate foregone margin worth remembering (e.g. an ebook
 *                 included free with a plan) — a marketing choice, not a bug.
 *
 * Pure and synchronous; the admin UI runs it live against the subscribed
 * config docs, so a bad combination is visible seconds after saving any piece.
 */
import type { PublicPlan } from "./plans";
import type { PricingSettings, ProductDefinition } from "./products";
import type { SparksConfig } from "./sparks";
import { computeMargin } from "./productMath";
import {
  buyerContextsFromPublicPlans,
  catalogDiscountImpacts,
  eligibleBuyers,
  storewideSafeDiscount,
  DISCOUNT_ITEM_LABELS,
  type DiscountImpact,
} from "./discountImpact";

export type FindingSeverity = "error" | "warning" | "info";

export interface EconomicFinding {
  severity: FindingSeverity;
  /** Where to fix it (maps to an admin tab). */
  area: "print" | "ebook" | "pack" | "plan" | "discounts";
  title: string;
  detail: string;
}

export interface ConfigHealthArgs {
  settings: PricingSettings;
  sparks: SparksConfig;
  /** Full admin product definitions; empty ⇒ print checks are skipped. */
  products: ProductDefinition[];
  plans: PublicPlan[];
}

const AREA_BY_ITEM: Record<DiscountImpact["itemType"], EconomicFinding["area"]> = {
  print: "print",
  ebook: "ebook",
  pack: "pack",
  plan: "plan",
};

/** All findings, sorted errors → warnings → info. */
export function economicFindings(args: ConfigHealthArgs): EconomicFinding[] {
  const { settings, sparks, products, plans } = args;
  const findings: EconomicFinding[] = [];
  const buyers = buyerContextsFromPublicPlans(plans, settings);
  const base = settings.baseCurrency;

  // ---- Losses & thin margins: every currency, worst eligible buyer ---------
  // key = itemType:itemId → the currencies (and a sample buyer) where it loses money.
  const losses = new Map<string, { impact: DiscountImpact; currencies: string[] }>();
  for (const currency of settings.currencies) {
    const impacts = catalogDiscountImpacts({ settings, sparks, products, plans, currency });
    for (const impact of impacts) {
      if (!impact.underwaterAtList) continue;
      const key = `${impact.itemType}:${impact.itemId}`;
      const entry = losses.get(key) ?? { impact, currencies: [] };
      entry.currencies.push(currency);
      losses.set(key, entry);
    }
  }
  for (const { impact, currencies } of losses.values()) {
    const wf = impact.atDiscount(0);
    const buyerPart = impact.buyerPlanId ? ` when the buyer is a ${impact.buyerLabel}` : "";
    const clampPart =
      impact.itemType === "ebook"
        ? " Checkout clamps the automatic bundle discount so it can't create this loss on its own, but explicitly configured prices are honored as-is."
        : "";
    findings.push({
      severity: "error",
      area: AREA_BY_ITEM[impact.itemType],
      title: `${impact.itemLabel} sells at a loss`,
      detail: `${DISCOUNT_ITEM_LABELS[impact.itemType]} loses money at full price${buyerPart} in ${currencies.join(", ")} (e.g. ${wf.netProfit.toFixed(2)} ${impact.currency} per sale after cost, fees and tax).${clampPart}`,
    });
  }

  // ---- Base-currency checks (kept to one currency to avoid noise) ----------
  const baseImpacts = catalogDiscountImpacts({ settings, sparks, products, plans, currency: base });

  for (const impact of baseImpacts) {
    if (impact.underwaterAtList) continue; // already an error above
    const wf = impact.atDiscount(0);
    if (wf.marginPct < settings.minMarginPct) {
      findings.push({
        severity: "warning",
        area: AREA_BY_ITEM[impact.itemType],
        title: `${impact.itemLabel} is below your margin floor before any sale`,
        detail: `${wf.marginPct}% margin at full price (${impact.buyerLabel}, ${base}) vs the ${settings.minMarginPct}% floor — there is no room for a discount at all.`,
      });
    }
  }

  const storewide = storewideSafeDiscount(baseImpacts);
  if (storewide && settings.maxDiscountPct > storewide.pct) {
    findings.push({
      severity: "warning",
      area: "discounts",
      title: "Your planned max discount exceeds what the catalog can absorb",
      detail: `Financial settings plan for up to ${settings.maxDiscountPct}% off, but a storewide sale is only safe up to ${storewide.pct}% — limited by ${storewide.limitedBy.itemLabel}.`,
    });
  }

  // ---- Broken promises: advertised print discounts that get clamped --------
  for (const buyer of buyers) {
    if (buyer.printDiscountPct <= 0) continue;
    const clamped: string[] = [];
    for (const product of products) {
      if (product.status !== "active") continue;
      if (eligibleBuyers(product.conditions.access, [buyer]).length === 0) continue;
      try {
        // The thinnest-margin page count bounds the real break-even.
        const be = Math.min(
          ...[product.conditions.pages.min, product.conditions.pages.max].map(
            (pages) =>
              computeMargin(product, { currency: base, pages, copies: 1 }, settings)
                .breakEvenDiscountPct,
          ),
        );
        if (buyer.printDiscountPct > be) {
          clamped.push(`${product.presentation.name} (break-even ${Math.round(be * 10) / 10}%)`);
        }
      } catch {
        /* malformed product — skipped */
      }
    }
    if (clamped.length > 0) {
      findings.push({
        severity: "warning",
        area: "plan",
        title: `${buyer.planName}'s ${buyer.printDiscountPct}% print discount can't be honored on every book`,
        detail: `Checkout clamps it to break-even on ${clamped.join(", ")} — members will see less than the advertised discount. Raise those retail prices or lower the plan discount.`,
      });
    }
  }

  // ---- Unreachable products -------------------------------------------------
  for (const product of products) {
    if (product.status !== "active") continue;
    if (eligibleBuyers(product.conditions.access, buyers).length === 0) {
      findings.push({
        severity: "warning",
        area: "print",
        title: `${product.presentation.name} can't be bought by anyone`,
        detail:
          "Its access policy doesn't match any active plan — it's live in the catalog but no buyer qualifies.",
      });
    }
  }

  // ---- Deliberate giveaways (foregone margin, not losses) -------------------
  for (const plan of plans) {
    if (plan.status !== "active" || plan.isFree) continue;
    const overrides = settings.ebook.planPrices[plan.id];
    if (!overrides) continue;
    const freeIn = Object.entries(overrides)
      .filter(([c, v]) => v === 0 && (settings.ebook.prices[c] ?? 0) > 0)
      .map(([c]) => c);
    if (settings.ebook.enabled && freeIn.length > 0) {
      findings.push({
        severity: "info",
        area: "plan",
        title: `${plan.name} includes the digital edition free (${freeIn.join(", ")})`,
        detail:
          "Nearly costless out of pocket (no provider cost, and no Stripe fee since it's granted without checkout) — it only forgoes the ebook revenue those members might have paid.",
      });
    }
  }

  const order: FindingSeverity[] = ["error", "warning", "info"];
  return findings.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
}
