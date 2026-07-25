/**
 * Product configuration validation. A product can only be **offered** to
 * customers when it is `active` and has no blocking errors here. The admin UI
 * surfaces both errors (block save/activation) and warnings (advisory).
 *
 * Pricing checks need the catalog-wide {@link PricingSettings} (currencies, fees,
 * tax), so the settings are passed alongside the product.
 */
import type { PricingSettings, ProductDefinition, ProviderEnv } from "./products";
import { verificationCoversPages, verificationFor } from "./products";
import { computeMargin, costTableIsEmpty, hasReachableDestination } from "./productMath";
import { bookMediaKey, resolvedPhotosFor, type CatalogMediaConfig } from "./catalogMedia";
import { variantFromSku } from "../fulfillment/lulu/skuAxes";
import {
  VARIANT_AXES,
  cheapestVariant,
  enumerateVariants,
  offeredValues,
  sameVariant,
  variantAllowed,
  variantOptionDef,
  variantPriceDelta,
  variantSummary,
} from "./variants";

export type IssueLevel = "error" | "warning";

export interface ProductIssue {
  level: IssueLevel;
  field: string;
  message: string;
  /**
   * The fix is running an action (verify the SKU, calibrate cost) rather than
   * editing a value. These still block OFFERING the product, but must not block
   * saving it — you have to save a product before you can verify what you saved,
   * so treating them as save blockers would deadlock a new product.
   */
  actionable?: boolean;
}

/** Errors the admin can fix by editing — the ones that should block a save. */
export function saveBlockingIssues(issues: ProductIssue[]): ProductIssue[] {
  return issues.filter((i) => i.level === "error" && !i.actionable);
}

export interface ValidateOptions {
  /**
   * The provider environment the product must be sellable in — normally the
   * active one. SKU verification is per-environment, so without knowing which
   * one we can't say whether a product is safe to offer.
   */
  env?: ProviderEnv;
  /**
   * Catalog pictures, when the caller has them. Product photographs live
   * outside the product record, so without this we can't tell a book with no
   * pictures from one whose pictures we simply weren't handed — and inventing a
   * warning in that case would cry wolf on every server-side validation.
   */
  media?: CatalogMediaConfig;
}

/** Collect all configuration issues for a product. */
export function validateProduct(
  p: ProductDefinition,
  settings: PricingSettings,
  opts: ValidateOptions = {},
): ProductIssue[] {
  const issues: ProductIssue[] = [];
  const err = (field: string, message: string) => issues.push({ level: "error", field, message });
  /** An error whose fix is running a tool (Verify / Calibrate), not typing. */
  const action = (field: string, message: string) =>
    issues.push({ level: "error", field, message, actionable: true });
  const warn = (field: string, message: string) => issues.push({ level: "warning", field, message });

  // Presentation
  if (!p.presentation.name.trim()) err("presentation.name", "Product needs a name.");
  if (opts.media && resolvedPhotosFor(opts.media, bookMediaKey(p.id)).length === 0) {
    warn("pictures", "No pictures — set some under Product pictures, or upload a default set.");
  }
  if (!p.presentation.description.trim()) warn("presentation.description", "No description set.");

  // Provider
  if (!p.provider.sku.trim()) err("provider.sku", "A provider SKU is required to quote and order.");
  // Verification is per-environment and blocking: an unproven SKU fails at
  // print-job creation, which happens AFTER the customer has paid. Without a
  // target environment we can only say something weaker.
  if (p.provider.id === "lulu" && p.provider.sku.trim()) {
    const env = opts.env;
    const record = env ? verificationFor(p.provider, env) : undefined;
    if (!env) {
      if (!p.provider.verifiedIn || Object.keys(p.provider.verifiedIn).length === 0) {
        warn("provider.verifiedIn", "SKU has never been verified against the print provider.");
      }
    } else if (!record) {
      action("provider.verifiedIn", `SKU has not been verified against the ${env} print catalog. Run Verify.`);
    } else if (!record.ok) {
      err("provider.verifiedIn", `The ${env} print catalog rejected this SKU: ${record.error ?? "unknown reason"}.`);
    } else if (!verificationCoversPages(record, p.conditions.pages)) {
      action(
        "provider.verifiedIn",
        `Verified for ${record.pages.min}–${record.pages.max} pages, but this product allows ${p.conditions.pages.min}–${p.conditions.pages.max}. Re-run Verify.`,
      );
    }
  }
  if (!p.provider.printAreas.interior.trim()) err("provider.printAreas", "An interior print area is required.");

  // Conditions
  const { pages, copies } = p.conditions;
  if (pages.min > pages.max) err("conditions.pages", "Minimum pages exceed maximum pages.");
  if (pages.step < 1) err("conditions.pages.step", "Page step must be at least 1.");
  if (copies.min > copies.max) err("conditions.copies", "Minimum copies exceed maximum copies.");
  if (copies.min < 1) err("conditions.copies.min", "Minimum copies must be at least 1.");

  // Subscription access: limiting to specific plans with none selected locks
  // everyone out — almost certainly a misconfiguration.
  if (p.conditions.access?.mode === "plans" && p.conditions.access.planIds.length === 0) {
    warn(
      "conditions.access",
      "Access is limited to specific plans, but no plans are selected — no one can order this product.",
    );
  }

  // Cost — blocking, not advisory: with an empty table every margin and
  // break-even check below passes vacuously (zero cost reads as pure profit), and
  // checkout refuses to price an order that has no cost baseline at all. Required
  // for `providerLive` products too, since the table is the fallback whenever a
  // live quote fails.
  if (costTableIsEmpty(p.cost)) {
    action(
      "cost.table",
      "Set a production cost (base per unit + per page). Margin, break-even and discount limits are meaningless without it, and orders can't be priced if a live quote fails.",
    );
  }

  // Variants — the base SKU must stay orderable, its options must carry no
  // surcharge (the tier price IS that variant), and every offered value must be
  // one this build knows. The cost table is calibrated to the base, which should
  // be the most expensive combination so a table fallback never understates cost.
  const currencies = settings.currencies;
  const baseVariant = variantFromSku(p.provider.sku);
  if (p.provider.sku.trim() && !baseVariant) {
    warn(
      "variants",
      "This SKU's print/paper/finish aren't recognised as a variant — customers won't be able to choose alternatives.",
    );
  } else if (baseVariant) {
    if (!variantAllowed(p.variants, baseVariant)) {
      err("variants", "The product's own SKU variant must stay offered — otherwise nothing is orderable.");
    }
    for (const currency of currencies) {
      const delta = variantPriceDelta(p.variants, baseVariant, currency);
      if (delta !== 0) {
        err(
          "variants",
          `Base variant price delta for ${currency} must be 0 (the page-tier price is already that variant).`,
        );
        break;
      }
    }
    const baseRank = VARIANT_AXES.reduce(
      (sum, axis) => sum + (variantOptionDef(axis, baseVariant[axis])?.costRank ?? 0),
      0,
    );
    for (const other of enumerateVariants(p.variants)) {
      const rank = VARIANT_AXES.reduce(
        (sum, axis) => sum + (variantOptionDef(axis, other[axis])?.costRank ?? 0),
        0,
      );
      if (rank > baseRank) {
        warn(
          "variants",
          `Base variant isn't the costliest offered (${variantSummary(other)} ranks higher). The cost-table fallback may understate what a live quote would charge.`,
        );
        break;
      }
    }
    for (const axis of VARIANT_AXES) {
      if (!offeredValues(p.variants, axis).includes(baseVariant[axis])) {
        err("variants", `Offer the base ${axis} value (${baseVariant[axis]}) or change the SKU.`);
      }
    }
  }

  // Pricing — page tiers: shape, coverage, and a price for every currency.
  const tiers = p.pricing.tiers;
  if (tiers.length === 0) err("pricing.tiers", "Add at least one price row.");
  for (const [i, t] of tiers.entries()) {
    if (t.minPages > t.maxPages) err(`pricing.tiers.${i}`, `Row ${i + 1}: "from" pages exceed "to" pages.`);
    for (const c of currencies) {
      if (!(t.prices[c] > 0)) {
        err(`pricing.tiers.${i}`, `Row ${i + 1} (${t.minPages}–${t.maxPages} pages) needs a ${c} price.`);
      }
    }
  }
  // Coverage: the configured page range should fall inside some tier.
  const covers = (pg: number) => tiers.some((t) => pg >= t.minPages && pg <= t.maxPages);
  if (tiers.length > 0 && (!covers(pages.min) || !covers(pages.max))) {
    warn("pricing.tiers", `Price rows don't fully cover the allowed range (${pages.min}–${pages.max} pages).`);
  }

  // Pricing — positive margin & discount guardrails. Check every tier (at its
  // lowest page count) per currency, at min copies, for the CHEAPEST variant the
  // product offers: the tier price buys the base variant, but an option priced
  // below it is a real order at less revenue and the same production cost, so
  // that's where a price first stops covering itself. With no negative deltas
  // the cheapest variant is the base and this checks exactly what it always did.
  const checkPoints =
    tiers.length > 0 ? tiers.map((t) => Math.max(pages.min, t.minPages)) : [pages.min];
  for (const currency of currencies) {
    const variant = cheapestVariant(p.variants, currency);
    const at =
      variant && baseVariant && !sameVariant(variant, baseVariant)
        ? ` on ${variantSummary(variant)}`
        : "";
    for (const pg of checkPoints) {
      let m;
      try {
        m = computeMargin(p, { currency, pages: pg, copies: Math.max(1, copies.min), variant }, settings);
      } catch {
        continue;
      }
      if (m.netProfit <= 0) {
        err("pricing", `Price for ${currency} doesn't cover cost + fees at ${pg} pages${at} (net ${m.netProfit}).`);
      } else if (m.marginPct < 10) {
        warn("pricing", `Thin margin for ${currency}: ${m.marginPct}% at ${pg} pages${at}.`);
      }
      if (m.underwaterAtMaxDiscount) {
        err(
          "pricing",
          `Max discount ${m.maxDiscountPct}% exceeds break-even ${m.breakEvenDiscountPct}% for ${currency}${at}.`,
        );
      }
    }
  }

  // Shipping
  if (!p.shipping.methods.some((s) => s.enabled)) err("shipping.methods", "Enable at least one shipping method.");
  if (!hasReachableDestination(p.shipping.destinations)) {
    err("shipping.destinations", "No destinations are reachable with this geo policy.");
  }
  // Passthrough shipping charges whatever the provider quotes, so it needs a
  // stand-in for the times a quote can't be fetched — otherwise checkout has to
  // refuse the order rather than ship at our expense.
  if (p.shipping.pricing.mode === "passthrough" && !((p.shipping.pricing.fallbackCost ?? 0) > 0)) {
    action(
      "shipping.pricing",
      "Set a fallback shipping cost. It's charged (plus your markup) when a live shipping quote can't be fetched; without it those orders can't be placed at all.",
    );
  }

  return issues;
}

export function productErrors(p: ProductDefinition, settings: PricingSettings): ProductIssue[] {
  return validateProduct(p, settings).filter((i) => i.level === "error");
}

/** A product can be offered to customers only when active and error-free. */
export function isOfferable(p: ProductDefinition, settings: PricingSettings): boolean {
  return p.status === "active" && productErrors(p, settings).length === 0;
}
