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
import {
  allowedMarketsFor,
  computeMargin,
  costTableIsEmpty,
  destinationPolicyFor,
  hasReachableDestination,
  isDestinationAllowed,
  offeredMethodsFor,
  worstBreakEvenDiscountPct,
} from "./productMath";
import { bookMediaKey, resolvedPhotosFor, type CatalogMediaConfig } from "./catalogMedia";
import { availableMethodsFor, type MarketCapability } from "./marketCapability";
import { EMPTY_MARKET_REGISTRY, type MarketRegistry } from "./markets";
import { createDefaultShippingSettings, type ShippingSettings } from "./shipping";
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

/**
 * The tool that resolves an issue, so the message can carry its own fix button.
 * An error that says what's wrong but not which of two panels away fixes it is
 * only half an error message.
 */
export type IssueFix = "verify" | "measure";

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
  /** Which tool clears it, when one does. */
  fix?: IssueFix;
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
  /**
   * Active plans whose print discount this product has to be able to honour.
   *
   * Checkout clamps a plan discount to break-even, so an over-generous perk
   * never loses money — it just silently isn't delivered. Passing the plans in
   * turns that silence into a warning naming the product and the plan.
   */
  plans?: readonly { id: string; name: string; printDiscountPct: number }[];
  /**
   * The markets currently open for business.
   *
   * Defaults to {@link EMPTY_MARKET_REGISTRY}, which reports every product as
   * having no reachable destination. That's the loud failure mode on purpose:
   * a caller that forgot to load the registry sees "this product ships
   * nowhere" rather than a validation pass that silently ignored the ceiling.
   */
  registry?: MarketRegistry;
  /**
   * The catalog-wide shipping policy.
   *
   * Defaults to the seeded one (every speed, cost passed through at no markup),
   * which understates shipping revenue and so understates margin. That's the
   * conservative direction: a caller that forgot to pass the real policy gets
   * MORE "this price doesn't cover its costs" complaints, not fewer.
   */
  shipping?: ShippingSettings;
  /**
   * What the printer was measured to do FOR THIS FORMAT in each country.
   *
   * Omitted means "nobody has asked", and every check below treats that as
   * permission rather than refusal. That is the same fail-open rule the country
   * sweep uses, and it matters more here: a format is measured only after it
   * exists, so failing closed would make every newly-created product invalid
   * until a sweep had run — which an admin would reasonably read as a bug.
   */
  capability?: ReadonlyMap<string, MarketCapability>;
}

/** Collect all configuration issues for a product. */
export function validateProduct(
  p: ProductDefinition,
  settings: PricingSettings,
  opts: ValidateOptions = {},
): ProductIssue[] {
  const issues: ProductIssue[] = [];
  const shippingSettings = opts.shipping ?? createDefaultShippingSettings();
  const err = (field: string, message: string) => issues.push({ level: "error", field, message });
  /** An error whose fix is running a tool (Verify / Calibrate), not typing. */
  const action = (field: string, message: string, fix?: IssueFix) =>
    issues.push({ level: "error", field, message, actionable: true, ...(fix ? { fix } : {}) });
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
      action(
        "provider.verifiedIn",
        `SKU has not been verified against the ${env} print catalog. Run Verify.`,
        "verify",
      );
    } else if (!record.ok) {
      err("provider.verifiedIn", `The ${env} print catalog rejected this SKU: ${record.error ?? "unknown reason"}.`);
    } else if (!verificationCoversPages(record, p.conditions.pages)) {
      action(
        "provider.verifiedIn",
        `Verified for ${record.pages.min}–${record.pages.max} pages, but this product allows ${p.conditions.pages.min}–${p.conditions.pages.max}. Re-run Verify.`,
        "verify",
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
      "measure",
    );
  }

  // Variants — the base SKU must stay orderable, its options must carry no
  // surcharge (the tier price IS that variant), and every offered value must be
  // one this build knows. The cost table is calibrated to the base, which should
  // be the most expensive combination so a table fallback never understates cost.
  const currencies = settings.currencies;
  if (currencies.some((currency) => currency !== settings.baseCurrency)) {
    const fxAge = settings.fx.updatedAt ? Date.now() - settings.fx.updatedAt : Number.POSITIVE_INFINITY;
    if (fxAge > 30 * 24 * 60 * 60 * 1000) {
      warn(
        "pricing.fx",
        "FX rates have not been reviewed in the last 30 days. Cost math is applying an extra safety buffer until they are saved again.",
      );
    }
  }
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
    // Checked component by component rather than through variantPriceDelta at
    // some page count: a per-page delta on the base would be invisible at zero
    // pages and then quietly double-charge on every real book.
    for (const currency of currencies) {
      const nonZero = VARIANT_AXES.some((axis) => {
        const delta = p.variants.options[axis].find((o) => o.value === baseVariant[axis])?.priceDelta?.[currency];
        return delta != null && (delta.perCopy !== 0 || delta.perPage !== 0);
      });
      if (nonZero) {
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
    for (const pg of checkPoints) {
      // Re-picked per page count, not once per currency: with per-page deltas
      // the cheapest option can change with length, and a check that used one
      // tier's cheapest variant on another tier would be checking a price no
      // customer can pay.
      const variant = cheapestVariant(p.variants, currency, pg);
      const at =
        variant && baseVariant && !sameVariant(variant, baseVariant)
          ? ` on ${variantSummary(variant)}`
          : "";
      let m;
      try {
        m = computeMargin(
          p,
          { currency, pages: pg, copies: Math.max(1, copies.min), variant },
          settings,
          shippingSettings,
        );
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

  // Plan print discounts this price can't actually honour.
  //
  // A warning rather than an error, deliberately: nothing here is unsafe. Checkout
  // clamps the discount to break-even so the order still turns a profit, and the
  // public projection publishes the clamped figure so the storefront advertises
  // what it will charge. What's left is a promise the marketing makes and the
  // price quietly shaves — which is the admin's to fix by raising the price or
  // lowering the perk, and blocking the whole catalog over it would be worse than
  // the mismatch.
  const advertising = (opts.plans ?? []).filter((pl) => pl.printDiscountPct > 0);
  if (advertising.length > 0 && !costTableIsEmpty(p.cost)) {
    const headroom = worstBreakEvenDiscountPct(
      p,
      settings,
      shippingSettings,
      Math.max(1, copies.min),
    );
    for (const plan of advertising) {
      if (plan.printDiscountPct > headroom) {
        warn(
          "pricing",
          `${plan.name} advertises ${plan.printDiscountPct}% off print, but this product only has ${headroom}% of headroom before it stops covering its costs — members will be charged the clamped discount instead. Raise the price or lower the plan's discount.`,
        );
      }
    }
  }

  // Shipping.
  //
  // Most of what used to be checked here can no longer be misconfigured. Which
  // speeds we sell and how we price them are catalog-wide now, so "enable at
  // least one speed" and "set a markup" are questions about the shipping
  // settings, not about this product — reporting them on every product turned
  // one global mistake into a catalog full of red.
  //
  // What remains is genuinely per product: can this book reach the markets it
  // claims, and has it been measured well enough to price them.
  const registry = opts.registry ?? EMPTY_MARKET_REGISTRY;
  const policy = destinationPolicyFor(shippingSettings, p.shipping);
  if (!hasReachableDestination(registry, policy)) {
    err(
      "shipping.destinations",
      registry.enabled.size === 0
        ? "No markets are enabled — open one in Configuration → Markets before this product can be sold."
        : p.shipping.destinationsOverride
          ? "This product's destination override excludes every open market."
          : "No destinations are reachable with the catalog's shipping destinations.",
    );
  }

  // A market this product sells to that no speed can reach is broken there,
  // however well everything else is configured — the provider hard-refuses a
  // speed it doesn't run, which fails the order AFTER the customer has entered
  // their address.
  //
  // Only rows the provider actually REFUSED count. A speed we couldn't get an
  // answer for has no row at all, and must not read as unavailable: that turned
  // one throttled request into a permanent save-blocking claim about a country.
  //
  // And only countries we still SELL to. Measurements outlive the markets they
  // were taken for — deselecting a market doesn't delete its rows — so reading
  // the country list off the rows alone kept reporting a market as broken after
  // it had been withdrawn, with no way to clear it but a full re-measure.
  const measuredRows = p.shipping.fallback ?? [];
  const sellsToMeasured = [...new Set(measuredRows.map((r) => r.country))].filter((c) =>
    isDestinationAllowed(registry, policy, { country: c }),
  );
  if (measuredRows.length > 0) {
    const stranded = sellsToMeasured.filter(
      (country) => offeredMethodsFor(shippingSettings, undefined, p.shipping, country).length === 0,
    );
    if (stranded.length > 0) {
      err(
        "shipping.destinations",
        `The printer refuses every speed we sell to ${stranded.join(", ")} — orders there will fail at checkout. ` +
          `Either stop selling this book there, or offer a speed the printer does run under Configuration → Markets.`,
      );
    }
  }

  // Per-format coverage. The printer doesn't bind every format in every
  // facility, so where one isn't made locally it's imported — which changes
  // WHICH SPEEDS EXIST, not just the price. A landscape hardcover to Germany
  // loses Standard (GROUND) and gains Express; a hardcover to Australia loses
  // Standard Plus. Selling a speed the printer doesn't run for this book is a
  // hard refusal at order time, after payment.
  //
  // Counted only where the sweep reached a verdict, so an unswept format — or a
  // throttled cell — says nothing rather than blocking a save.
  //
  // A LOSS IN SOME MARKETS IS A WARNING, NOT AN ERROR, and the distinction is
  // load-bearing: an error makes the product non-offerable, which would pull a
  // hardcover from the whole storefront because Australia can't have it. The
  // projection already withholds the individual country (its rate rows come out
  // unavailable), so nobody can order the broken combination either way. The
  // warning exists so the gap is visible rather than silent. Only a format that
  // reaches NO market it sells to is genuinely unsellable, and that is the one
  // case worth blocking on. See `productCapability.ts`.
  if (opts.capability) {
    const sellsTo = allowedMarketsFor(registry, policy);
    const unreachable: string[] = [];
    let reachable = 0;
    for (const country of sellsTo) {
      const cell = opts.capability.get(country);
      if (!cell || cell.status === "unknown") continue;
      const sellable = offeredMethodsFor(shippingSettings, undefined, p.shipping, country);
      const runs = new Set(availableMethodsFor(cell));
      if (sellable.some((m) => runs.has(m))) reachable += 1;
      else unreachable.push(country);
    }
    if (unreachable.length > 0 && reachable === 0) {
      err(
        "shipping.destinations",
        `The printer runs no speed we sell for this format to any market it's sold in (${unreachable.join(", ")}) — every order would be refused after payment. ` +
          `Offer a speed it does run under Configuration → Markets, or retire this format.`,
      );
    } else if (unreachable.length > 0) {
      warn(
        "shipping.destinations",
        `The printer runs no speed we sell for this format to ${unreachable.join(", ")}, so it's withheld there — customers in those countries won't see it. ` +
          `Offer a speed it does run under Configuration → Markets, or exclude those countries under Destinations to make the gap deliberate.`,
      );
    }
  }

  // Unmeasured markets. Passthrough bills the provider's cost, so a route with
  // no measurement and no live quote can't be priced at all — the order is
  // refused rather than shipped at our expense. That's the safe direction, but
  // it's invisible until a customer hits it, so it's reported here as work to
  // do rather than left to be discovered.
  if (shippingSettings.pricing.mode === "passthrough" && !costTableIsEmpty(p.cost)) {
    const measured = new Set(measuredRows.map((r) => r.country));
    const unmeasured = allowedMarketsFor(registry, policy).filter((c) => !measured.has(c));
    if (unmeasured.length > 0) {
      action(
        "shipping.fallback",
        `No measured shipping rate for ${unmeasured.join(", ")}. Orders there are priced from a live quote and refused when one can't be fetched — measure the cost to fill them in.`,
        "measure",
      );
    }
  }

  // Cost coverage and provenance. An unmeasured variant falls back to the base
  // line, which overstates its cost — safe for the business, but it makes the
  // variant look less profitable than it is and misprices its delta.
  const measurement = p.cost.measurement;
  if (!costTableIsEmpty(p.cost)) {
    if (measurement && measurement.variantsMeasured < measurement.variantsOffered) {
      warn(
        "cost.table",
        `${measurement.variantsOffered - measurement.variantsMeasured} of ${measurement.variantsOffered} variants have no measured cost and fall back to the base (costliest) rate.`,
      );
    }
    if (opts.env && measurement && measurement.env !== opts.env) {
      warn(
        "cost.table",
        `Costs were measured against ${measurement.env}, but this catalog serves ${opts.env}. Re-measure to price against the right catalogue.`,
      );
    }
    if (measurement && Date.now() - measurement.at > STALE_COST_MS) {
      const days = Math.round((Date.now() - measurement.at) / 86_400_000);
      warn("cost.table", `Costs were last measured ${days} days ago; printer prices drift. Re-measure.`);
    }
    if (!measurement) {
      warn(
        "cost.table",
        "This cost table was entered by hand, not measured. Run Measure to price it from real provider quotes.",
      );
    }
  }

  return issues;
}

/** How long a measured cost table is trusted before it's worth re-checking. */
const STALE_COST_MS = 120 * 86_400_000;

export function productErrors(
  p: ProductDefinition,
  settings: PricingSettings,
  opts: ValidateOptions = {},
): ProductIssue[] {
  return validateProduct(p, settings, opts).filter((i) => i.level === "error");
}

/**
 * A product can be offered to customers only when active and error-free.
 *
 * Pass `opts.env` wherever the answer is acted on. Without it the SKU-verification
 * check softens to a warning, so an unproven SKU reads as offerable — which is
 * how an unverified product could reach the storefront and fail at print-job
 * creation, after the customer had paid.
 */
export function isOfferable(
  p: ProductDefinition,
  settings: PricingSettings,
  opts: ValidateOptions = {},
): boolean {
  return p.status === "active" && productErrors(p, settings, opts).length === 0;
}
