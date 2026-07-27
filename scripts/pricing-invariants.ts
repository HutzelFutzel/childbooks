/**
 * Pricing invariants — the properties that must hold for any product we sell,
 * checked against the real math rather than a restatement of it.
 *
 * These are the failures that cost money quietly. A margin that reads fine at
 * the display page count and goes negative at 400 pages, a variant that gets
 * cheaper as the book gets longer, a shipping fallback that charges the same
 * for one copy as for ten — none of them throw, none of them show up in a
 * typecheck, and all of them are only visible if you evaluate the pricing
 * functions at more than one point.
 *
 * Run by `yarn check:pricing`, which bundles this with esbuild first: the math
 * lives in the Next workspace as TypeScript, and re-implementing it in a plain
 * .mjs check would mean the check could pass while the shipped code was wrong.
 */
import {
  SUPPORTED_MARKETS,
  createDefaultPricingSettings,
  findPublicProductBySlug,
  formatSlug,
  normalizeProduct,
  seedProductsFromCatalog,
  type PricingSettings,
  type ProductDefinition,
} from "../books-frontend/src/core/config/products";
import {
  allowedMarketsFor,
  computeMargin,
  computeRetailPrice,
  defaultShippingMethod,
  estimateShippingCost,
  hasUsableShippingCost,
  isDestinationAllowed,
  perPageCostFor,
  publicUnitPrice,
  simulatePublicOrder,
  suggestTierPrice,
  suggestVariantDeltas,
  toPublicProduct,
  worstBreakEvenDiscountPct,
} from "../books-frontend/src/core/config/productMath";
import {
  costVariantKey,
  enumerateVariants,
  variantKey,
  variantPriceDelta,
} from "../books-frontend/src/core/config/variants";
import { saveBlockingIssues, validateProduct } from "../books-frontend/src/core/config/productValidation";
import { variantFromSku } from "../books-frontend/src/core/fulfillment/lulu/skuAxes";

const failures: string[] = [];
const checks: string[] = [];

function check(name: string, ok: boolean, detail?: string): void {
  if (ok) checks.push(name);
  else failures.push(`${name}${detail ? `: ${detail}` : ""}`);
}

/**
 * A product with a plausible measured cost model. The NUMBERS are arbitrary —
 * these are property tests, not a claim about what the printer charges. What
 * matters is the SHAPE: a shared base, per-page rates that differ by variant,
 * and a shipping matrix with an unavailable cell in it.
 */
function fixture(): { product: ProductDefinition; settings: PricingSettings } {
  const seed = seedProductsFromCatalog().find((p) => p.spec.binding === "casewrap");
  if (!seed) throw new Error("No casewrap format in the seed catalog.");
  const base = variantFromSku(seed.provider.sku);
  if (!base) throw new Error("Seeded SKU has no recognisable base variant.");

  const variantPerPage: Record<string, number> = {};
  for (const variant of enumerateVariants(seed.variants)) {
    const key = costVariantKey(variant);
    if (key in variantPerPage) continue;
    // Colour costs more per page than black & white, and coated more than
    // uncoated — the ordering is what the checks below rely on.
    const ink = variant.print.includes("colour") ? 0.16 : 0.03;
    const premium = variant.print.startsWith("premium") ? 0.055 : 0;
    const stock = variant.paper === "80-coated-white" ? 0.012 : 0;
    variantPerPage[key] = Number((ink + premium + stock).toFixed(5));
  }

  const product = normalizeProduct({
    ...seed,
    status: "active",
    cost: {
      ...seed.cost,
      source: "table",
      currency: "USD",
      table: { basePerUnit: 2.16, perPage: variantPerPage[costVariantKey(base)], quantityBreaks: [] },
      variantPerPage,
      measurement: {
        at: Date.now(),
        env: "sandbox",
        destination: "US/10001",
        variantsMeasured: Object.keys(variantPerPage).length,
        variantsOffered: Object.keys(variantPerPage).length,
      },
    },
    shipping: {
      ...seed.shipping,
      fallback: [
        { country: "US", method: "StandardPlus", available: true, base: 4.99, perCopy: 1.5 },
        { country: "US", method: "Standard", available: false, base: 0, perCopy: 0 },
        { country: "GB", method: "StandardPlus", available: true, base: 9.99, perCopy: 2.25 },
        { country: "GB", method: "Standard", available: false, base: 0, perCopy: 0 },
      ],
      pricing: { mode: "passthrough", fallbackCost: 12.24 },
    },
  });
  return { product, settings: createDefaultPricingSettings() };
}

const { product, settings } = fixture();
const currency = settings.baseCurrency;
const { min, max } = product.conditions.pages;
const lengths = [min, Math.round((min + max) / 2), max];

// ---- Cost scales with the variant, and the base is the costliest -----------

{
  const base = variantFromSku(product.provider.sku)!;
  const baseRate = perPageCostFor(product.cost, base);
  const dearer = enumerateVariants(product.variants).filter(
    (v) => perPageCostFor(product.cost, v) > baseRate + 1e-9,
  );
  check(
    "base variant is the costliest per page",
    dearer.length === 0,
    dearer.length > 0 ? `${dearer.length} variants cost more than the base` : undefined,
  );

  // The whole point of the per-variant table: an unmeasured variant must fall
  // back to something, and it has to be the base rate rather than zero.
  const unknown = perPageCostFor({ ...product.cost, variantPerPage: {} }, base);
  check("unmeasured variants fall back to the base rate", unknown === product.cost.table.perPage);
}

// ---- Suggested prices actually earn the margin they claim, at every length --

for (const target of [25, 45]) {
  for (const pages of lengths) {
    const suggested = suggestTierPrice(product, { currency, pages, copies: 1 }, settings, target);
    if (suggested == null) {
      check(`suggested price exists at ${pages}pp / ${target}%`, false, "no price could be derived");
      continue;
    }
    const priced = normalizeProduct({
      ...product,
      pricing: { ...product.pricing, tiers: [{ minPages: 0, maxPages: 100000, prices: { [currency]: suggested } }] },
    });
    const margin = computeMargin(priced, { currency, pages, copies: 1 }, settings);
    // Within a cent per rounding step: the suggestion is rounded to a charm
    // price, so it can't land exactly on target and shouldn't pretend to.
    const off = Math.abs(margin.marginPct - target);
    check(
      `suggested price earns ~${target}% at ${pages} pages`,
      off < 3,
      `got ${margin.marginPct.toFixed(1)}% (off by ${off.toFixed(1)})`,
    );
  }
}

// ---- Variant deltas priced from cost keep every variant profitable ---------

{
  const target = 35;
  const withDeltas = normalizeProduct({
    ...product,
    variants: suggestVariantDeltas(product, settings, target) ?? product.variants,
  });
  check("variant deltas can be derived from measured cost", withDeltas.variants !== product.variants);

  for (const pages of lengths) {
    const tierPrice = suggestTierPrice(withDeltas, { currency, pages, copies: 1 }, settings, target);
    if (tierPrice == null) continue;
    const priced = normalizeProduct({
      ...withDeltas,
      pricing: { ...withDeltas.pricing, tiers: [{ minPages: 0, maxPages: 100000, prices: { [currency]: tierPrice } }] },
    });
    let worst = Number.POSITIVE_INFINITY;
    let worstVariant = "";
    for (const variant of enumerateVariants(priced.variants)) {
      const margin = computeMargin(priced, { currency, pages, copies: 1, variant }, settings);
      if (margin.marginPct < worst) {
        worst = margin.marginPct;
        worstVariant = costVariantKey(variant);
      }
    }
    // This is the invariant a flat per-copy delta could not hold: with deltas
    // derived per page, no variant collapses as the book gets longer.
    check(
      `every variant stays profitable at ${pages} pages`,
      worst > 0,
      `worst is ${worstVariant} at ${worst.toFixed(1)}%`,
    );
  }
}

// ---- Upgrades cost more on longer books ------------------------------------

{
  const withDeltas = suggestVariantDeltas(product, settings, 35) ?? product.variants;
  const base = variantFromSku(product.provider.sku)!;
  const cheapVariant = enumerateVariants(withDeltas).find(
    (v) => perPageCostFor(product.cost, v) < perPageCostFor(product.cost, base) - 1e-9,
  );
  if (cheapVariant) {
    const short = variantPriceDelta(withDeltas, cheapVariant, currency, min);
    const long = variantPriceDelta(withDeltas, cheapVariant, currency, max);
    // A cheaper interior saves more on a long book than a short one, because
    // the saving is per page. A flat delta would report these as equal.
    check(
      "a cheaper variant saves more on a longer book",
      long < short,
      `${short.toFixed(2)} at ${min}pp vs ${long.toFixed(2)} at ${max}pp`,
    );
  }
}

// ---- Shipping: scales with copies, and knows where it can't go -------------

{
  const one = estimateShippingCost(product.shipping, {
    destinationCountry: "US",
    shippingMethod: "StandardPlus",
    copies: 1,
  });
  const ten = estimateShippingCost(product.shipping, {
    destinationCountry: "US",
    shippingMethod: "StandardPlus",
    copies: 10,
  });
  check("measured shipping scales with copies", ten > one, `${one} for 1, ${ten} for 10`);

  const gb = estimateShippingCost(product.shipping, {
    destinationCountry: "GB",
    shippingMethod: "StandardPlus",
    copies: 1,
  });
  check("measured shipping differs by destination", gb !== one, `US ${one}, GB ${gb}`);

  // An unmeasured route must still price, or the order is refused outright.
  const unmeasured = estimateShippingCost(product.shipping, {
    destinationCountry: "JP",
    shippingMethod: "StandardPlus",
    copies: 1,
  });
  check("an unmeasured destination falls back to the scalar", unmeasured > 0, `got ${unmeasured}`);
  check(
    "shipping is priceable everywhere with a fallback set",
    hasUsableShippingCost(product.shipping, undefined, { destinationCountry: "JP", copies: 1 }),
  );

  // The scalar, not some other country's measured rate. Substituting one
  // destination's rate for another's is how a UK buyer gets billed a Canadian
  // shipping cost — and it stays plausible-looking, so nothing catches it.
  const scalar = product.shipping.pricing.fallbackCost ?? 0;
  check(
    "an unmeasured destination is not billed another country's measured rate",
    unmeasured === scalar,
    `JP quoted ${unmeasured}, scalar is ${scalar}`,
  );

  // Likewise across tiers: a route measured for one speed says nothing about
  // what the provider charges for another.
  const unmeasuredTier = estimateShippingCost(product.shipping, {
    destinationCountry: "US",
    shippingMethod: "Overnight",
    copies: 1,
  });
  check(
    "an unmeasured tier is not billed a cheaper tier's measured rate",
    unmeasuredTier !== one,
    `Overnight quoted ${unmeasuredTier}, StandardPlus is ${one}`,
  );

  // Passthrough with nothing measured and nothing configured must NOT price:
  // charging zero while we still pay the printer is the failure this guards.
  const bare = normalizeProduct({
    ...product,
    shipping: { ...product.shipping, fallback: undefined, pricing: { mode: "passthrough" } },
  });
  check(
    "passthrough with no fallback refuses to price",
    !hasUsableShippingCost(bare.shipping, undefined, { destinationCountry: "US", copies: 1 }),
  );
}

// ---- An unmeasured speed is not an unavailable one -------------------------

// The failure this guards is a save-blocking error invented out of a network
// blip: a speed we never got an answer for, treated as one the printer refuses.
{
  const enabledOnly: ShippingMethod[] = ["StandardPlus"];
  const withMethods = (p: ProductDefinition, enabled: ShippingMethod[]) =>
    normalizeProduct({
      ...p,
      shipping: {
        ...p.shipping,
        methods: p.shipping.methods.map((m) => ({ ...m, enabled: enabled.includes(m.method) })),
      },
    });

  // AU has rows for other speeds but none for the enabled one: unknown, not
  // refused. Nothing here justifies blocking a save.
  const unknownInAu = withMethods(
    normalizeProduct({
      ...product,
      shipping: {
        ...product.shipping,
        fallback: [
          ...(product.shipping.fallback ?? []),
          { country: "AU", method: "Budget", available: true, base: 14.99, perCopy: 3 },
        ],
      },
    }),
    enabledOnly,
  );
  check(
    "an unmeasured speed does not strand a country",
    !saveBlockingIssues(validateProduct(unknownInAu, settings)).some((i) =>
      i.message.includes("No enabled shipping speed reaches"),
    ),
  );

  // Same shape, but now the printer actually refused it. That IS a finding.
  const refusedInAu = withMethods(
    normalizeProduct({
      ...product,
      shipping: {
        ...product.shipping,
        fallback: [
          ...(product.shipping.fallback ?? []),
          { country: "AU", method: "Budget", available: true, base: 14.99, perCopy: 3 },
          { country: "AU", method: "StandardPlus", available: false, base: 0, perCopy: 0 },
        ],
      },
    }),
    enabledOnly,
  );
  const stranding = validateProduct(refusedInAu, settings).find((i) =>
    i.message.includes("No enabled shipping speed reaches"),
  );
  check("a refused speed does strand a country", stranding != null);
  // Naming the working speed is the difference between a dead end and a fix.
  check(
    "the stranding error names a speed that works there",
    stranding?.message.includes("Budget") === true,
    stranding?.message,
  );

  // The same product with Australia deselected. Measurements outlive the markets
  // they were taken for, so a withdrawn market's rows are still stored — and
  // reading the country list off the rows alone kept reporting it as broken with
  // no way to clear it short of a full re-measure.
  const withoutAu = normalizeProduct({
    ...refusedInAu,
    shipping: {
      ...refusedInAu.shipping,
      destinations: { mode: "allowlist", countries: ["US", "GB", "DE", "CA"], regions: {} },
    },
  });
  check(
    "deselecting a market clears its stranding error without re-measuring",
    !validateProduct(withoutAu, settings).some((i) => i.message.includes("AU")),
    validateProduct(withoutAu, settings)
      .filter((i) => i.message.includes("AU"))
      .map((i) => i.message)
      .join(" | "),
  );
  // Kept, not deleted: re-adding the market must not silently lose what we
  // measured for it.
  check(
    "the withdrawn market's measurements are retained",
    withoutAu.shipping.fallback?.some((r) => r.country === "AU") === true,
  );
}

// ---- Every seeded product offers a tier that reaches our markets -----------

{
  // `Standard` is the provider's GROUND service, which it does not run to the
  // US or the UK. A seed offering only that cannot be ordered in either.
  const stranded = seedProductsFromCatalog().filter(
    (p) => defaultShippingMethod(p) === "Standard",
  );
  check(
    "no seeded product defaults to a tier that misses the US and UK",
    stranded.length === 0,
    stranded.length > 0 ? `${stranded.length} seeds default to Standard (GROUND)` : undefined,
  );

  const noTier = seedProductsFromCatalog().filter((p) => !p.shipping.methods.some((m) => m.enabled));
  check("every seeded product enables a shipping tier", noTier.length === 0);
}

// ---- Markets are a ceiling, not a suggestion -------------------------------

// The property that makes SUPPORTED_MARKETS trustworthy: a product cannot widen
// it. If this can be broken, every caller has to remember a second check, and
// one of them eventually won't — which is exactly how reorder shipped without a
// destination check at all.
{
  const worldwide = normalizeProduct({
    ...product,
    shipping: {
      ...product.shipping,
      destinations: { mode: "all", countries: [], regions: {} },
    },
  });
  const escapes = ["FR", "ES", "IT", "NL", "JP", "BR"].filter((c) =>
    isDestinationAllowed(worldwide.shipping.destinations, { country: c }),
  );
  check(
    "a product claiming worldwide shipping still can't leave our markets",
    escapes.length === 0,
    escapes.join(", "),
  );

  // A stored "ship anywhere" is rewritten on read, so existing products are
  // restricted without anyone re-saving them.
  check(
    "a stored ship-anywhere policy is normalized to our markets",
    worldwide.shipping.destinations.mode === "allowlist" &&
      worldwide.shipping.destinations.countries.length === SUPPORTED_MARKETS.length,
    `${worldwide.shipping.destinations.mode} / ${worldwide.shipping.destinations.countries.join(",")}`,
  );

  // A blocklist may subtract from the markets but never add to them.
  const blocking = normalizeProduct({
    ...product,
    shipping: {
      ...product.shipping,
      destinations: { mode: "blocklist", countries: ["AU", "FR"], regions: {} },
    },
  });
  const viaBlocklist = allowedMarketsFor(blocking.shipping.destinations);
  check(
    "a blocklist subtracts markets and adds none",
    !viaBlocklist.includes("AU") && viaBlocklist.every((c) => SUPPORTED_MARKETS.includes(c)),
    viaBlocklist.join(", "),
  );

  // The checkout picker is built from this function, so an empty result would
  // mean a product nobody can order — worth failing loudly rather than shipping
  // a country dropdown with nothing in it.
  const seeds = seedProductsFromCatalog().filter(
    (p) => allowedMarketsFor(p.shipping.destinations).length === 0,
  );
  check("every seeded product can be ordered to at least one market", seeds.length === 0);

  // An unsupported country is refused even when the product explicitly names it:
  // otherwise "allowlist" would be a way to opt back out of the ceiling.
  const optimistic = normalizeProduct({
    ...product,
    shipping: {
      ...product.shipping,
      destinations: { mode: "allowlist", countries: ["US", "FR"], regions: {} },
    },
  });
  check(
    "naming an unsupported country in an allowlist doesn't enable it",
    !isDestinationAllowed(optimistic.shipping.destinations, { country: "FR" }) &&
      isDestinationAllowed(optimistic.shipping.destinations, { country: "US" }),
  );
}

// ---- A fresh seed is editable, and says what's left to do ------------------

{
  // Seeds deliberately ship without a cost table — nobody can know what the
  // printer charges without asking it. What they must NOT do is present that as
  // something to fix before saving: the remaining errors are cleared by running
  // Verify and Measure, and you have to save a product before you can measure
  // it, so treating them as save blockers would deadlock every new product.
  const blocked: string[] = [];
  const unclear: string[] = [];
  for (const seed of seedProductsFromCatalog()) {
    const issues = validateProduct(seed, settings, { env: "sandbox" });
    if (saveBlockingIssues(issues).length > 0) blocked.push(seed.presentation.name);
    const missingFix = issues.filter((i) => i.level === "error" && i.actionable && !i.fix);
    if (missingFix.length > 0) unclear.push(`${seed.presentation.name} (${missingFix[0].field})`);
  }
  check(
    "a freshly seeded product can be saved",
    blocked.length === 0,
    blocked.length > 0 ? `${blocked.length} seeds report save-blocking errors` : undefined,
  );
  check(
    "every actionable error names the tool that clears it",
    unclear.length === 0,
    unclear[0],
  );
}

// ---- The public projection tells customers the truth ------------------------

// The price simulator is a public promise: it shows a guest a number and says
// that number is what checkout charges. It can only make that promise because it
// recomputes the SAME arithmetic from the projection instead of approximating it,
// and nothing but a check at more than one point can keep the two in step — a
// projection that drops variant deltas, or rounds before the floor, agrees on the
// display page count and diverges everywhere else.
{
  // Priced upgrades first. The seed catalog ships every option at a zero delta
  // (nobody can price an upgrade before measuring what it costs), and against
  // zeroes the equality below would hold even for a projection that dropped
  // variant pricing entirely — passing while the simulator quietly undercharged
  // for premium colour on every book.
  const priced = normalizeProduct({
    ...product,
    variants: suggestVariantDeltas(product, settings, 35) ?? product.variants,
  });
  const deltas = enumerateVariants(priced.variants).map((v) =>
    variantPriceDelta(priced.variants, v, currency, max),
  );
  check(
    "the projection check is exercising non-zero variant deltas",
    deltas.some((d) => Math.abs(d) > 0.01),
  );

  const publicProduct = toPublicProduct(priced, settings, {
    offerable: true,
    plans: [
      { id: "storyteller", printDiscountPct: 10 },
      { id: "dream-weaver", printDiscountPct: 20 },
    ],
  });

  const priceMismatches: string[] = [];
  for (const cur of settings.currencies) {
    for (const pages of lengths) {
      for (const variant of enumerateVariants(priced.variants)) {
        const server = computeRetailPrice(priced, { currency: cur, pages, copies: 1, variant }, settings);
        const shown = publicUnitPrice(publicProduct, settings, { currency: cur, pages, variant });
        if (Math.abs(server - shown) > 1e-9) {
          priceMismatches.push(`${cur} ${pages}p ${variantKey(variant)}: ${shown} vs ${server}`);
        }
      }
    }
  }
  check(
    "the simulated book price equals the price checkout charges",
    priceMismatches.length === 0,
    priceMismatches[0],
  );

  // Shipping is quoted live at checkout, so this can't be exact — but it has to
  // be the same MODEL, scaling with copies off the same measured row. A published
  // rate that ignored `perCopy` would quote one copy correctly and undercharge
  // every larger order, which is exactly the failure the two-term shape exists
  // to prevent.
  const shippingMismatches: string[] = [];
  for (const cur of settings.currencies) {
    for (const country of allowedMarketsFor(product.shipping.destinations)) {
      for (const copies of [1, 3, 10]) {
        const method = defaultShippingMethod(product);
        const quote = simulatePublicOrder(publicProduct, settings, {
          currency: cur,
          pages: min,
          copies,
          destinationCountry: country,
          shippingMethod: method,
        });
        const server = computeMargin(
          product,
          { currency: cur, pages: min, copies, destinationCountry: country, shippingMethod: method },
          settings,
        ).shippingCharged;
        if (quote.shipping == null || Math.abs(quote.shipping - server) > 0.02) {
          shippingMismatches.push(
            `${cur} ${country} ×${copies}: ${quote.shipping ?? "none"} vs ${server}`,
          );
        }
      }
    }
  }
  check(
    "published shipping matches what checkout charges, at every quantity",
    shippingMismatches.length === 0,
    shippingMismatches[0],
  );

  // A refusal the provider gave us must reach the customer as a refusal. Read as
  // "free" (the other way a zero could be interpreted) it would sell an order to
  // a country the carrier won't serve.
  const refused = publicProduct.shipping.rates.find(
    (r) => r.country === "US" && r.method === "Standard",
  );
  check(
    "a measured refusal is published as unavailable, not as free",
    refused == null || refused.available === false,
  );

  // The whole point of a derived projection: it can be world-readable because
  // there is nothing in it we mind being read. Checked against the serialized
  // document rather than the type, since a stray spread is exactly how a cost
  // field reaches Firestore while still typechecking.
  //
  // The key names are cost-table-only on purpose. `perPage` is deliberately NOT
  // among them: it names a field on the cost table AND a field on a variant PRICE
  // delta, which is public by necessity — the storefront can't price an upgrade
  // without it. The cost table is caught structurally instead.
  const serialized = JSON.stringify(publicProduct);
  const leaked = [
    "cost",
    "fallbackCost",
    "markupPct",
    "basePerUnit",
    "quantityBreaks",
    "variantPerPage",
    "measurement",
  ].filter((key) => serialized.includes(`"${key}":`));
  check("the public projection carries no cost internals", leaked.length === 0, leaked.join(", "));

  // Plan discounts are published already clamped, so the storefront can multiply
  // naively and still never advertise more than the price can carry.
  const headroom = worstBreakEvenDiscountPct(product, settings, 1);
  const overpromised = Object.entries(publicProduct.planPrintDiscountPct).filter(
    ([, pct]) => pct > headroom + 1e-9,
  );
  check(
    "no published plan discount exceeds the product's break-even headroom",
    overpromised.length === 0,
    overpromised.map(([id, pct]) => `${id} at ${pct}% vs ${headroom}%`).join(", "),
  );

  // And the clamp must not be silent: an admin who sets a perk the price can't
  // pay for gets told, rather than discovering it from a support ticket.
  const greedy = validateProduct(product, settings, {
    plans: [{ id: "greedy", name: "Greedy", printDiscountPct: 99 }],
  });
  check(
    "an unhonourable plan discount is reported to the admin",
    greedy.some((i) => i.level === "warning" && i.message.includes("headroom")),
  );
}

// ---- Public format URLs are stable and unambiguous --------------------------

{
  // The slug is derived from trim × binding because those identify a product and
  // an id or a name does not. That only holds while the catalog really has one
  // product per combination — if it ever doesn't, two formats silently share a
  // URL and one of them becomes unreachable.
  const slugs = seedProductsFromCatalog().map((p) => formatSlug(p.spec));
  check(
    "every seeded format has its own public URL",
    new Set(slugs).size === slugs.length,
    `${slugs.length - new Set(slugs).size} collisions`,
  );

  const publicProducts = seedProductsFromCatalog().map((p) =>
    toPublicProduct(p, settings, { offerable: true }),
  );
  const roundTripped = publicProducts.every(
    (p) => findPublicProductBySlug(publicProducts, formatSlug(p.spec))?.sku === p.sku,
  );
  check("a format URL resolves back to the format it names", roundTripped);
}

// ---- Report ----------------------------------------------------------------

for (const name of checks) console.log(`  ok   ${name}`);
for (const failure of failures) console.error(`  FAIL ${failure}`);
console.log(
  `\n${checks.length} passed, ${failures.length} failed (${product.presentation.name}, ${min}–${max} pages).`,
);
process.exit(failures.length > 0 ? 1 : 0);
