/**
 * Product configuration validation. A product can only be **offered** to
 * customers when it is `active` and has no blocking errors here. The admin UI
 * surfaces both errors (block save/activation) and warnings (advisory).
 *
 * Pricing checks need the catalog-wide {@link PricingSettings} (currencies, fees,
 * tax), so the settings are passed alongside the product.
 */
import type { PricingSettings, ProductDefinition } from "./products";
import { computeMargin, hasReachableDestination } from "./productMath";

export type IssueLevel = "error" | "warning";

export interface ProductIssue {
  level: IssueLevel;
  field: string;
  message: string;
}

/** Collect all configuration issues for a product. */
export function validateProduct(p: ProductDefinition, settings: PricingSettings): ProductIssue[] {
  const issues: ProductIssue[] = [];
  const err = (field: string, message: string) => issues.push({ level: "error", field, message });
  const warn = (field: string, message: string) => issues.push({ level: "warning", field, message });

  // Presentation
  if (!p.presentation.name.trim()) err("presentation.name", "Product needs a name.");
  if (!p.presentation.images.some((i) => i.role === "hero")) {
    warn("presentation.images", "No hero image — the product will show a placeholder.");
  }
  if (!p.presentation.description.trim()) warn("presentation.description", "No description set.");

  // Provider
  if (!p.provider.sku.trim()) err("provider.sku", "A provider SKU is required to quote and order.");
  if (p.provider.id === "lulu" && !p.provider.verified) {
    warn("provider.verified", "SKU is not verified against the live Lulu catalog yet.");
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

  // Cost — needed so margin info is meaningful; live quotes fill it in at order time.
  if (p.cost.table.basePerUnit === 0 && p.cost.table.perPage === 0) {
    warn("cost.table", "No cost estimate — margin will assume zero cost until a live quote is fetched.");
  }

  // Pricing — page tiers: shape, coverage, and a price for every currency.
  const currencies = settings.currencies;
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
  // lowest page count) per currency, at min copies.
  const checkPoints =
    tiers.length > 0 ? tiers.map((t) => Math.max(pages.min, t.minPages)) : [pages.min];
  for (const currency of currencies) {
    for (const pg of checkPoints) {
      let m;
      try {
        m = computeMargin(p, { currency, pages: pg, copies: Math.max(1, copies.min) }, settings);
      } catch {
        continue;
      }
      if (m.netProfit <= 0) {
        err("pricing", `Price for ${currency} doesn't cover cost + fees at ${pg} pages (net ${m.netProfit}).`);
      } else if (m.marginPct < 10) {
        warn("pricing", `Thin margin for ${currency}: ${m.marginPct}% at ${pg} pages.`);
      }
      if (m.underwaterAtMaxDiscount) {
        err(
          "pricing",
          `Max discount ${m.maxDiscountPct}% exceeds break-even ${m.breakEvenDiscountPct}% for ${currency}.`,
        );
      }
    }
  }

  // Shipping
  if (!p.shipping.methods.some((s) => s.enabled)) err("shipping.methods", "Enable at least one shipping method.");
  if (!hasReachableDestination(p.shipping.destinations)) {
    err("shipping.destinations", "No destinations are reachable with this geo policy.");
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
