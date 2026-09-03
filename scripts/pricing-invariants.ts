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
  availableCountries,
  createDefaultPricingSettings,
  findPublicProductBySlug,
  formatSlug,
  isAvailableIn,
  normalizeProduct,
  seedProductsFromCatalog,
  type GeoPolicy,
  type PricingSettings,
  type ProductDefinition,
} from "../books-frontend/src/core/config/products";
import {
  allowedMarketsFor,
  computeMargin,
  computeRetailPrice,
  convertCostAmount,
  defaultShippingMethod,
  destinationPolicyFor,
  estimateShippingCost,
  hasUsableShippingCost,
  isDestinationAllowed,
  offeredMethodsFor,
  perPageCostFor,
  publicUnitPrice,
  simulatePublicOrder,
  suggestTierPrice,
  suggestVariantDeltas,
  toPublicProduct,
  worstBreakEvenDiscountPct,
} from "../books-frontend/src/core/config/productMath";
import {
  createDefaultShippingSettings,
  SHIPPING_METHODS,
  shippingSettingsSchema,
  withPricingMode,
  type ShippingSettings,
} from "../books-frontend/src/core/config/shipping";
import { previewShippingChange } from "../books-frontend/src/core/config/shippingPreview";
import type { MarketCapability } from "../books-frontend/src/core/config/marketCapability";
import {
  coverageFor,
  normalizeProductCapability,
} from "../books-frontend/src/core/config/productCapability";
import {
  costVariantKey,
  enumerateVariants,
  offeredValues,
  simplifiedPrintVariant,
  variantKey,
  variantPriceDelta,
} from "../books-frontend/src/core/config/variants";
import { saveBlockingIssues, validateProduct } from "../books-frontend/src/core/config/productValidation";
import {
  createDefaultMarketsConfig,
  EMPTY_MARKET_REGISTRY,
  enabledMarkets,
  registryFrom,
  registryOf,
  SEED_MARKETS,
} from "../books-frontend/src/core/config/markets";
import {
  currencyForMarket,
  isMeasurable,
  PROBE_ADDRESS,
  PROBE_STATE,
  STATE_CODE_REQUIRED,
  TAX_ID_LABEL,
  TAX_ID_REQUIRED,
} from "../books-frontend/src/core/config/countries";
import { subdivisionsFor, SUBDIVISIONS } from "../books-frontend/src/core/config/subdivisions";
import { variantFromSku } from "../books-frontend/src/core/fulfillment/lulu/skuAxes";
import { mapAddressValidation } from "../books-frontend/src/core/fulfillment/lulu/wire";

/**
 * The seeded markets, standing in for whatever an admin has actually opened.
 *
 * These checks are about the SHAPE of the geo rule — that a product can only
 * narrow the open set, never widen it — so any non-empty registry proves it.
 * Using the seed rather than a hand-written list keeps the countries named in
 * the assertions below honest as the seed changes.
 */
const REGISTRY = registryFrom(createDefaultMarketsConfig());

const failures: string[] = [];
const checks: string[] = [];

function check(name: string, ok: boolean, detail?: string): void {
  if (ok) checks.push(name);
  else failures.push(`${name}${detail ? `: ${detail}` : ""}`);
}

check(
  "the first-run shipping policy validates before it is persisted",
  shippingSettingsSchema.safeParse(createDefaultShippingSettings()).success,
);

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
        {
          country: "US",
          method: "StandardPlus",
          available: true,
          base: 4.99,
          perCopy: 1.5,
          transitDaysMin: 3,
          transitDaysMax: 6,
        },
        { country: "US", method: "Standard", available: false, base: 0, perCopy: 0 },
        { country: "GB", method: "StandardPlus", available: true, base: 9.99, perCopy: 2.25 },
        { country: "GB", method: "Standard", available: false, base: 0, perCopy: 0 },
      ],
      fallbackCost: 12.24,
    },
  });
  return { product, settings: createDefaultPricingSettings() };
}

const { product, settings } = fixture();

/**
 * The catalog-wide shipping policy these checks run against: the seeded one,
 * which offers every speed and passes the provider's cost straight through.
 *
 * Deliberately the DEFAULT rather than a hand-tuned fixture. It's what a fresh
 * install sells under, so a property that only holds for some carefully chosen
 * markup is a property that doesn't hold in production.
 */
const SHIPPING = createDefaultShippingSettings();
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
    const suggested = suggestTierPrice(product, { currency, pages, copies: 1 }, settings, target, SHIPPING);
    if (suggested == null) {
      check(`suggested price exists at ${pages}pp / ${target}%`, false, "no price could be derived");
      continue;
    }
    const priced = normalizeProduct({
      ...product,
      pricing: { ...product.pricing, tiers: [{ minPages: 0, maxPages: 100000, prices: { [currency]: suggested } }] },
    });
    const margin = computeMargin(priced, { currency, pages, copies: 1 }, settings, SHIPPING);
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
    const tierPrice = suggestTierPrice(withDeltas, { currency, pages, copies: 1 }, settings, target, SHIPPING);
    if (tierPrice == null) continue;
    const priced = normalizeProduct({
      ...withDeltas,
      pricing: { ...withDeltas.pricing, tiers: [{ minPages: 0, maxPages: 100000, prices: { [currency]: tierPrice } }] },
    });
    let worst = Number.POSITIVE_INFINITY;
    let worstVariant = "";
    for (const variant of enumerateVariants(priced.variants)) {
      const margin = computeMargin(priced, { currency, pages, copies: 1, variant }, settings, SHIPPING);
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

  // A country the sweep never visited gets no estimate at all. The scalar
  // fallback was fitted to the routes it DID visit, so charging it here would
  // invent a shipping price for a continent nobody measured — and with markets
  // now openable by an admin, that's the common case rather than the exception.
  const unmeasured = estimateShippingCost(product.shipping, {
    destinationCountry: "JP",
    shippingMethod: "StandardPlus",
    copies: 1,
  });
  check(
    "an unmeasured destination gets no invented estimate",
    unmeasured === 0,
    `got ${unmeasured}`,
  );
  check(
    "an order to an unmeasured destination is refused rather than mispriced",
    !hasUsableShippingCost(SHIPPING, product.shipping, undefined, {
      destinationCountry: "JP",
      copies: 1,
    }),
  );
  // …but a live quote settles it, which is the recoverable path a customer
  // actually takes.
  check(
    "a live quote makes an unmeasured destination priceable",
    hasUsableShippingCost(SHIPPING, product.shipping, 14.5, {
      destinationCountry: "JP",
      copies: 1,
    }),
  );

  // Never another country's measured rate. Substituting one destination's rate
  // for another's is how a UK buyer gets billed a Canadian shipping cost — and
  // it stays plausible-looking, so nothing catches it.
  const scalar = product.shipping.fallbackCost ?? 0;
  check(
    "an unmeasured destination is not billed another country's measured rate",
    unmeasured !== 4.99 + 1.5 && unmeasured !== 9.99 + 2.25 && unmeasured !== scalar,
    `JP quoted ${unmeasured}`,
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
    shipping: { ...product.shipping, fallback: undefined, fallbackCost: undefined },
  });
  check(
    "passthrough with no fallback refuses to price",
    !hasUsableShippingCost(SHIPPING, bare.shipping, undefined, {
      destinationCountry: "US",
      copies: 1,
    }),
  );
}

// ---- Availability is derived, not declared ---------------------------------

// The inversion the whole redesign turns on. Availability used to be declared
// per product and coverage was advisory, so a speed the printer didn't run to a
// country was still offered there — and the order failed after the customer had
// typed their address. These check the three vetoes compose the right way, and
// crucially that "we have no measurement" is NOT one of them.
{
  const reachable: MarketCapability = {
    country: "US",
    status: "available",
    levels: [
      { level: "MAIL", method: "Budget", traceable: false, postboxOk: true, businessOnly: false },
      {
        level: "PRIORITY_MAIL",
        method: "StandardPlus",
        traceable: true,
        postboxOk: true,
        businessOnly: false,
      },
    ],
    probedAt: Date.now(),
  };

  check(
    "coverage narrows the offered speeds to what the printer runs",
    offeredMethodsFor(SHIPPING, reachable, product.shipping, "US").join(",") ===
      "Budget,StandardPlus",
    offeredMethodsFor(SHIPPING, reachable, product.shipping, "US").join(","),
  );

  // No sweep yet is not a refusal. Reading it as one would hide every speed in
  // a market the moment it was opened, before anything had been measured.
  check(
    "an unswept country still offers every speed we sell",
    offeredMethodsFor(SHIPPING, undefined, product.shipping, "JP").length ===
      SHIPPING_METHODS.length,
  );
  check(
    "a settled country refusal offers no delivery speeds",
    offeredMethodsFor(
      SHIPPING,
      { country: "JP", status: "refused", levels: [], probedAt: Date.now() },
      product.shipping,
      "JP",
    ).length === 0,
  );
  check(
    "an available response containing only unmapped services offers no guessed tier",
    offeredMethodsFor(
      SHIPPING,
      { country: "JP", status: "available", levels: ["GROUND_HD"], probedAt: Date.now() },
      product.shipping,
      "JP",
    ).length === 0,
  );

  // A global veto beats coverage: the printer running it doesn't mean we sell it.
  const noBudget: ShippingSettings = {
    ...SHIPPING,
    methods: { ...SHIPPING.methods, Budget: { offered: false } },
  };
  check(
    "a speed switched off catalog-wide is not offered anywhere",
    !offeredMethodsFor(noBudget, reachable, product.shipping, "US").includes("Budget"),
  );

  // And a per-country veto beats both, without touching the other countries.
  const notInUs: ShippingSettings = {
    ...SHIPPING,
    countryOverrides: { US: { disabled: ["StandardPlus"] } },
  };
  check(
    "a country veto removes one speed there and nowhere else",
    !offeredMethodsFor(notInUs, reachable, product.shipping, "US").includes("StandardPlus") &&
      offeredMethodsFor(notInUs, undefined, product.shipping, "GB").includes("StandardPlus"),
  );

  // A measured refusal for THIS book, on a route the printer serves for others.
  check(
    "a speed the printer refused for this book is not offered",
    !offeredMethodsFor(SHIPPING, undefined, product.shipping, "US").includes("Standard"),
  );

  // ---- Coverage is per FORMAT, not just per country ------------------------
  //
  // Measured against the real printer: a hardcover to Australia is imported and
  // runs MAIL/EXPEDITED/EXPRESS, while the paperback to the same address goes
  // by Australia Post and runs MAIL/EXPRESS. Country-level coverage cannot
  // express that, so these check the per-format document does — and, just as
  // importantly, that its absence changes nothing.
  {
    const hardcoverInAu: MarketCapability = {
      country: "AU",
      status: "available",
      levels: [
        { level: "MAIL", method: "Budget", traceable: false, postboxOk: true, businessOnly: false },
        { level: "EXPRESS", method: "Overnight", traceable: true, postboxOk: false, businessOnly: false },
      ],
      probedAt: Date.now(),
    };
    const config = normalizeProductCapability({
      version: 1,
      probe: { copies: 1, currency: "USD", env: "sandbox" },
      products: [{ sku: product.provider.sku, pageCount: 40, countries: [hardcoverInAu] }],
      sweptAt: Date.now(),
    });

    check(
      "per-format coverage narrows speeds to what the printer runs for THAT book",
      offeredMethodsFor(SHIPPING, hardcoverInAu, product.shipping, "AU").join(",") ===
        "Budget,Overnight",
      offeredMethodsFor(SHIPPING, hardcoverInAu, product.shipping, "AU").join(","),
    );

    // The fallback contract the projection depends on. A format nobody has
    // swept must be indistinguishable from one with no document at all, or
    // activating a new product would withdraw it from every market until the
    // next sweep.
    check(
      "an unswept format has no coverage map, so the caller falls back",
      coverageFor(config, "NOSUCHSKU0000000000000000000") === undefined,
    );
    check(
      "a swept format's coverage is keyed by country",
      coverageFor(config, product.provider.sku)?.get("AU")?.status === "available",
    );

    // Normalization has to survive the round trip through Firestore, or the
    // sweep's verdicts quietly become "unswept" on the way back out.
    const reread = normalizeProductCapability(JSON.parse(JSON.stringify(config)));
    check(
      "per-format coverage survives a serialization round trip",
      coverageFor(reread, product.provider.sku)?.get("AU")?.levels.length === 2,
    );

    // The admin-facing half. A format that reaches NOTHING it sells to is an
    // error; one that loses a single market is only a warning — because an
    // error makes it non-offerable, which would pull the format from the entire
    // storefront over one country the projection already withholds on its own.
    const only = (...countries: string[]): GeoPolicy => ({
      mode: "allowlist",
      countries,
      regions: {},
    });
    const withMarkets = (policy: GeoPolicy) =>
      normalizeProduct({ ...product, shipping: { ...product.shipping, destinationsOverride: policy } });
    const strandedInAu = new Map<string, MarketCapability>([
      ["AU", { country: "AU", status: "refused", levels: [], probedAt: Date.now() }],
      ["US", reachable],
    ]);
    const issuesFor = (policy: GeoPolicy, capability?: ReadonlyMap<string, MarketCapability>) =>
      validateProduct(withMarkets(policy), settings, {
        registry: REGISTRY,
        shipping: SHIPPING,
        ...(capability ? { capability } : {}),
      }).filter((i) => i.field === "shipping.destinations");

    check(
      "a format the printer can't deliver anywhere it's sold is an error",
      issuesFor(only("AU"), strandedInAu).some((i) => i.level === "error"),
    );
    check(
      "losing one market only warns, so the format stays sellable in the rest",
      issuesFor(only("AU", "US"), strandedInAu).every((i) => i.level === "warning") &&
        issuesFor(only("AU", "US"), strandedInAu).some((i) => i.level === "warning"),
    );
    // The same product with no coverage passed, and with an inconclusive one,
    // must both stay clean. A throttled probe is not evidence, and turning one
    // into a save-blocking error is the failure mode this whole design avoids.
    const unknownInAu = new Map<string, MarketCapability>([
      ["AU", { country: "AU", status: "unknown", levels: [], probedAt: Date.now() }],
    ]);
    check(
      "an unswept or inconclusive format raises nothing at all",
      issuesFor(only("AU")).length === 0 && issuesFor(only("AU"), unknownInAu).length === 0,
    );

    // The storefront half, read off the published rate rows rather than from a
    // second document — so the picker and the price table can't disagree.
    const auPublic = toPublicProduct(withMarkets(only("AU", "US")), settings, {
      offerable: true,
      registry: REGISTRY,
      shipping: SHIPPING,
      capability: strandedInAu,
    });
    check(
      "a format with no working route is unavailable in that country and no other",
      !isAvailableIn(auPublic, "AU") &&
        !availableCountries(auPublic).includes("AU") &&
        isAvailableIn(auPublic, "US"),
    );
    // Fail-open, in the two shapes it has to hold: no country to filter by, and
    // a country the projection has no rows for at all.
    check(
      "an unknown destination hides nothing",
      isAvailableIn(auPublic, "") && isAvailableIn(auPublic, "JP"),
    );
  }

  // Flat mode is the one place automatic availability is unsafe: a speed with
  // no rate entered would be sold at whatever the cheapest one charges.
  const flat = withPricingMode(SHIPPING, "flat");
  check(
    "switching to flat leaves only the cheapest speed on",
    SHIPPING_METHODS.filter((m) => flat.methods[m].offered).length === 1,
  );
}

// Unknown/stale FX data must err toward overstating cost, never toward an
// artificially healthy margin.
{
  const current = createDefaultPricingSettings();
  current.fx.updatedAt = Date.now();
  const stale = createDefaultPricingSettings();
  stale.fx.updatedAt = 0;
  check(
    "unknown FX age adds a fail-safe cost buffer",
    convertCostAmount(stale, 10, "USD", "EUR") >
      convertCostAmount(current, 10, "USD", "EUR"),
  );
}

// ---- The dry run predicts what the save actually does ----------------------

// The preview exists so a policy change can be reviewed before it reaches
// customers, which is worth nothing if it disagrees with the save. It's built
// by running the real projection twice, so this check is really guarding
// against someone "optimising" it into a model of the rules.
{
  const dearer: ShippingSettings = {
    ...SHIPPING,
    pricing: { ...SHIPPING.pricing, markupPct: 50 },
  };
  const preview = previewShippingChange({
    products: [product],
    settings,
    registry: REGISTRY,
    current: SHIPPING,
    candidate: dearer,
  });
  check(
    "a markup change is predicted as repricing and not as withdrawal",
    preview.totals.repriced > 0 && preview.totals.lost === 0 && preview.totals.gained === 0,
    JSON.stringify(preview.totals),
  );

  const after = toPublicProduct(product, settings, {
    offerable: true,
    registry: REGISTRY,
    shipping: dearer,
  });
  const predicted = preview.prices.find((p) => p.country === "US" && p.method === "StandardPlus");
  const actual = after.shipping.rates.find(
    (r) => r.country === "US" && r.method === "StandardPlus",
  )?.charged[predicted?.currency ?? settings.baseCurrency];
  check(
    "the predicted price is the price the save produces",
    predicted != null &&
      actual != null &&
      Math.abs(predicted.after - (actual.base + actual.perCopy)) < 0.01,
    predicted ? `predicted ${predicted.after}` : "no prediction",
  );

  // Withdrawing a speed has to read as a withdrawal, not as a reprice — they
  // have opposite remedies and the panel tints only one of them.
  const withoutStandardPlus: ShippingSettings = {
    ...SHIPPING,
    methods: { ...SHIPPING.methods, StandardPlus: { offered: false } },
  };
  const withdrawal = previewShippingChange({
    products: [product],
    settings,
    registry: REGISTRY,
    current: SHIPPING,
    candidate: withoutStandardPlus,
  });
  check(
    "unticking a speed is predicted as routes withdrawn",
    withdrawal.totals.lost > 0 && withdrawal.totals.gained === 0,
    JSON.stringify(withdrawal.totals),
  );

  // An unchanged policy must produce an empty diff. A preview that always finds
  // something would be ignored within a week.
  const same = previewShippingChange({
    products: [product],
    settings,
    registry: REGISTRY,
    current: SHIPPING,
    candidate: SHIPPING,
  });
  check(
    "an unchanged policy predicts no change at all",
    same.totals.gained + same.totals.lost + same.totals.repriced + same.totals.unpriceable === 0,
    JSON.stringify(same.totals),
  );
}

// ---- An unmeasured speed is not an unavailable one -------------------------

// The failure this guards is a save-blocking error invented out of a network
// blip: a speed we never got an answer for, treated as one the printer refuses.
{
  // Only StandardPlus is on sale, so a refusal of it is a refusal of everything
  // this catalog offers.
  const onlyStandardPlus: ShippingSettings = {
    ...SHIPPING,
    methods: Object.fromEntries(
      SHIPPING_METHODS.map((m) => [m, { offered: m === "StandardPlus" }]),
    ) as ShippingSettings["methods"],
  };
  const opts = { registry: REGISTRY, shipping: onlyStandardPlus };

  // AU has a row for another speed but none for the one we sell: unknown, not
  // refused. Nothing here justifies blocking a save.
  const unknownInAu = normalizeProduct({
    ...product,
    shipping: {
      ...product.shipping,
      fallback: [
        ...(product.shipping.fallback ?? []),
        { country: "AU", method: "Budget", available: true, base: 14.99, perCopy: 3 },
      ],
    },
  });
  check(
    "an unmeasured speed does not strand a country",
    !saveBlockingIssues(validateProduct(unknownInAu, settings, opts)).some((i) =>
      i.message.includes("refuses every speed"),
    ),
  );

  // Same shape, but now the printer actually refused it. That IS a finding.
  const refusedInAu = normalizeProduct({
    ...product,
    shipping: {
      ...product.shipping,
      fallback: [
        ...(product.shipping.fallback ?? []),
        { country: "AU", method: "Budget", available: true, base: 14.99, perCopy: 3 },
        { country: "AU", method: "StandardPlus", available: false, base: 0, perCopy: 0 },
      ],
    },
  });
  const stranding = validateProduct(refusedInAu, settings, opts).find((i) =>
    i.message.includes("refuses every speed"),
  );
  check("a refused speed does strand a country", stranding != null, stranding?.message);
  // Naming the country is the difference between a dead end and a fix.
  check(
    "the stranding error names the country it's about",
    stranding?.message.includes("AU") === true,
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
      destinationsOverride: {
        mode: "allowlist",
        countries: ["US", "GB", "DE", "CA"],
        regions: {},
      },
    },
  });
  check(
    "deselecting a market clears its stranding error without re-measuring",
    !validateProduct(withoutAu, settings, opts).some(
      (i) => i.message.includes("AU") && i.message.includes("refuses every speed"),
    ),
    validateProduct(withoutAu, settings, opts)
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

// ---- The seeded policy can actually sell -----------------------------------

// One check where there used to be one per product, because the answer stopped
// varying by product: which speeds are on sale is a single document now.
{
  check(
    "the seeded policy sells at least one speed",
    SHIPPING_METHODS.some((m) => SHIPPING.methods[m].offered),
  );

  // `Standard` is the provider's GROUND service, which it does not run to the
  // US or the UK. Falling back to it when nothing else is known would fail the
  // first quote in our two largest markets.
  check(
    "the fallback tier isn't one that misses the US and UK",
    defaultShippingMethod(SHIPPING) !== "Standard",
    defaultShippingMethod(SHIPPING),
  );
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
  const escapes = ["ES", "IT", "NL", "JP", "BR"].filter((c) =>
    isDestinationAllowed(REGISTRY, destinationPolicyFor(SHIPPING, worldwide.shipping), { country: c }),
  );
  check(
    "a product claiming worldwide shipping still can't leave our markets",
    escapes.length === 0,
    escapes.join(", "),
  );

  // "Ship anywhere" is now stored as-is and resolved against the registry at
  // check time, so a product created before a market opened reaches it too.
  check(
    "a ship-anywhere policy resolves to exactly the open markets",
    destinationPolicyFor(SHIPPING, worldwide.shipping).mode === "all" &&
      allowedMarketsFor(REGISTRY, destinationPolicyFor(SHIPPING, worldwide.shipping)).join(",") ===
        enabledMarkets(REGISTRY).join(","),
    allowedMarketsFor(REGISTRY, destinationPolicyFor(SHIPPING, worldwide.shipping)).join(","),
  );

  // The ceiling holds against an empty registry too — that's the state before
  // config loads, and it must refuse rather than fall open.
  check(
    "an unloaded registry refuses every destination",
    allowedMarketsFor(EMPTY_MARKET_REGISTRY, destinationPolicyFor(SHIPPING, worldwide.shipping)).length === 0,
  );

  // A blocklist may subtract from the markets but never add to them.
  const blocking = normalizeProduct({
    ...product,
    shipping: {
      ...product.shipping,
      destinations: { mode: "blocklist", countries: ["AU", "FR"], regions: {} },
    },
  });
  const viaBlocklist = allowedMarketsFor(REGISTRY, destinationPolicyFor(SHIPPING, blocking.shipping));
  check(
    "a blocklist subtracts markets and adds none",
    !viaBlocklist.includes("AU") &&
      !viaBlocklist.includes("FR") &&
      viaBlocklist.every((c) => REGISTRY.enabled.has(c)),
    viaBlocklist.join(", "),
  );

  // The checkout picker is built from this function, so an empty result would
  // mean a product nobody can order — worth failing loudly rather than shipping
  // a country dropdown with nothing in it.
  const seeds = seedProductsFromCatalog().filter(
    (p) => allowedMarketsFor(REGISTRY, destinationPolicyFor(SHIPPING, p.shipping)).length === 0,
  );
  check("every seeded product can be ordered to at least one market", seeds.length === 0);

  // A closed country is refused even when the product explicitly names it:
  // otherwise "allowlist" would be a way to opt back out of the ceiling.
  const optimistic = normalizeProduct({
    ...product,
    shipping: {
      ...product.shipping,
      destinations: { mode: "allowlist", countries: ["US", "JP"], regions: {} },
    },
  });
  check(
    "naming a closed country in an allowlist doesn't open it",
    !isDestinationAllowed(REGISTRY, destinationPolicyFor(SHIPPING, optimistic.shipping), { country: "JP" }) &&
      isDestinationAllowed(REGISTRY, destinationPolicyFor(SHIPPING, optimistic.shipping), { country: "US" }),
  );

  // The sanctions list is applied when the registry is BUILT, not only in the
  // admin UI — a document hand-edited in the Firestore console must not be able
  // to open one.
  check(
    "a sanctioned country can't be enabled through the registry",
    !registryOf(["US", "RU", "IR"]).enabled.has("RU") &&
      !registryOf(["US", "RU", "IR"]).enabled.has("IR"),
  );
}

// ---- Country reference data agrees with itself ------------------------------

// Every table here is transcribed by hand from an external register, and a
// mistake in one is invisible until the provider rejects a real address — for
// the tax-id countries, after the customer has paid. These checks are the only
// thing that disagrees with a typo.
{
  // A seeded market with no probe address can be sold to but never MEASURED, so
  // a passthrough product refuses every order to it the moment a live quote
  // fails. Shipping that state by default would make the fallback machinery
  // decorative for exactly the countries we sell to most.
  const unmeasurableSeeds = SEED_MARKETS.filter((c) => !isMeasurable(c));
  check(
    "every seeded market can have its shipping measured",
    unmeasurableSeeds.length === 0,
    unmeasurableSeeds.join(", "),
  );

  // The provider rejects an address in these countries without a subdivision,
  // so a probe address that omits one measures nothing and reports it as a
  // provider refusal.
  const probeMissingState = Object.keys(PROBE_ADDRESS).filter(
    (c) => STATE_CODE_REQUIRED.has(c) && !PROBE_ADDRESS[c].state?.trim(),
  );
  check(
    "every probe address carries a state where one is mandatory",
    probeMissingState.length === 0,
    probeMissingState.join(", "),
  );

  // The two tables are written independently — one for sweeping coverage, one
  // for the checkout picker — and the sweep's code silently becoming invalid is
  // how a whole country's coverage reads as "refused".
  const probeStateNotOffered = Object.keys(PROBE_STATE).filter((country) => {
    const subs = subdivisionsFor(country);
    return subs.length > 0 && !subs.some((s) => s.code === PROBE_STATE[country]);
  });
  check(
    "the probe state is one the subdivision list actually offers",
    probeStateNotOffered.length === 0,
    probeStateNotOffered.join(", "),
  );

  // Same check in the other direction for the probe ADDRESS, which is what
  // calibration bills a customer's shipping from.
  const probeAddressStateNotOffered = Object.keys(PROBE_ADDRESS).filter((country) => {
    const state = PROBE_ADDRESS[country].state;
    const subs = subdivisionsFor(country);
    return Boolean(state) && subs.length > 0 && !subs.some((s) => s.code === state);
  });
  check(
    "the probe address's state is one the subdivision list offers",
    probeAddressStateNotOffered.length === 0,
    probeAddressStateNotOffered.join(", "),
  );

  // A duplicate code makes one of the two entries unselectable, and React keys
  // the options by it.
  const dupes = Object.keys(SUBDIVISIONS).filter((country) => {
    const codes = SUBDIVISIONS[country].map((s) => s.code);
    return new Set(codes).size !== codes.length;
  });
  check("no subdivision list repeats a code", dupes.length === 0, dupes.join(", "));

  // Checkout demands a tax id for these and names it in the message; an
  // unlabelled one asks the customer for "tax id" in a country where nobody
  // calls it that.
  const unlabelled = [...TAX_ID_REQUIRED].filter((c) => !TAX_ID_LABEL[c]);
  check("every mandatory tax id has a local name", unlabelled.length === 0, unlabelled.join(", "));

  // The countries where a subdivision mistake is most expensive: the order is
  // refused at print-job creation, which is after payment, so the picker (not a
  // free-text field) is what has to cover them.
  const riskyWithoutPicker = [...TAX_ID_REQUIRED].filter(
    (c) => STATE_CODE_REQUIRED.has(c) && subdivisionsFor(c).length === 0,
  );
  check(
    "a country needing both a tax id and a state code offers a state picker",
    riskyWithoutPicker.length === 0,
    riskyWithoutPicker.join(", "),
  );
}

// ---- Customers are billed in the destination's currency ---------------------

{
  const supported = settings.currencies;
  // The bug this replaced: checkout hardcoded USD, so every market opened after
  // the first billed dollars for a book priced in the local currency.
  check(
    "a eurozone destination is billed in euros when the catalog supports them",
    !supported.includes("EUR") ||
      currencyForMarket("DE", supported, settings.baseCurrency) === "EUR",
  );
  check(
    "a destination whose currency we don't support falls back to the base",
    currencyForMarket("JP", ["USD", "EUR"], "USD") === "USD",
  );
  // An unknown or missing country must not produce an empty currency string —
  // that reaches Stripe as an invalid charge rather than a validation error.
  check(
    "an unrecognised destination still resolves to a real currency",
    currencyForMarket("ZZ", supported, settings.baseCurrency) === settings.baseCurrency &&
      currencyForMarket(null, supported, settings.baseCurrency) === settings.baseCurrency,
  );
  // Every currency this table can select has to be one the catalog prices in,
  // or opening the market yields a checkout that can't quote.
  const unpriceable = SEED_MARKETS.filter(
    (c) => !supported.includes(currencyForMarket(c, supported, settings.baseCurrency)),
  );
  check(
    "every seeded market resolves to a currency the catalog prices in",
    unpriceable.length === 0,
    unpriceable.join(", "),
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
    const issues = validateProduct(seed, settings, { registry: REGISTRY, env: "sandbox" });
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
    registry: REGISTRY,
    shipping: SHIPPING,
    plans: [
      { id: "storyteller", printDiscountPct: 10 },
      { id: "dream-weaver", printDiscountPct: 20 },
    ],
  });

  const simplifiedVariantMismatches = offeredValues(publicProduct.variants, "finish").flatMap(
    (finish) => {
      const variant = simplifiedPrintVariant(publicProduct.variants, finish);
      return !variant ||
        variant.print !== "premium-colour" ||
        variant.paper !== "80-coated-white" ||
        variant.finish !== finish
        ? [finish]
        : [];
    },
  );
  check(
    "the simplified storefront always uses premium colour on 80# paper",
    simplifiedVariantMismatches.length === 0,
    simplifiedVariantMismatches[0],
  );

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
  //
  // Unmeasured destinations are checked for the opposite property: the
  // storefront must publish NO price and checkout must refuse, together. Either
  // one alone is the bad case — a published figure checkout won't honour, or a
  // silent charge the storefront never showed.
  const shippingMismatches: string[] = [];
  const unmeasuredLeaks: string[] = [];
  for (const cur of settings.currencies) {
    for (const country of allowedMarketsFor(REGISTRY, destinationPolicyFor(SHIPPING, product.shipping))) {
      for (const copies of [1, 3, 10]) {
        const method = defaultShippingMethod(SHIPPING);
        const quote = simulatePublicOrder(publicProduct, settings, {
          currency: cur,
          pages: min,
          copies,
          destinationCountry: country,
          shippingMethod: method,
        });
        const scenario = {
          currency: cur,
          pages: min,
          copies,
          destinationCountry: country,
          shippingMethod: method,
        };
        const priceable = hasUsableShippingCost(SHIPPING, product.shipping, undefined, scenario);
        if (!priceable) {
          if (quote.shipping != null) {
            unmeasuredLeaks.push(`${cur} ${country} ×${copies}: published ${quote.shipping}`);
          }
          continue;
        }
        const server = computeMargin(product, scenario, settings, SHIPPING).shippingCharged;
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
  check(
    "an unmeasured destination publishes no shipping price at all",
    unmeasuredLeaks.length === 0,
    unmeasuredLeaks[0],
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
  const headroom = worstBreakEvenDiscountPct(product, settings, SHIPPING, 1);
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
    registry: REGISTRY,
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
    toPublicProduct(p, settings, { offerable: true, registry: REGISTRY, shipping: SHIPPING }),
  );
  const roundTripped = publicProducts.every(
    (p) => findPublicProductBySlug(publicProducts, formatSlug(p.spec))?.sku === p.sku,
  );
  check("a format URL resolves back to the format it names", roundTripped);
}

// ---- Address validation is read out of the provider's real payload ----------

// The provider's cost response carries the carrier's verdict on the shipping
// address, and checkout gates on it — an address it can't verify is one it will
// refuse to print, after the customer has paid. So the mapper is checked against
// the payload Lulu's own docs publish, quirks included: `warnings` arrives as a
// bare object though the schema says array, `postcode` as a NUMBER though the
// schema says string, and `state_code` as null. Trusting the schema here would
// throw inside the pricing path.
{
  const documented = {
    city: "Lübeck",
    country_code: "DE",
    is_business: false,
    name: "Hans Dampf",
    phone_number: "844-212-0689",
    postcode: "23552",
    state_code: "",
    street1: "Holstenstr. 40",
    street2: "",
    warnings: {
      type: "validation_warning",
      path: "external",
      code: "REPLACED",
      message: "street1: Holstenstr. 40 -> Holstenstraße 40",
    },
    suggested_address: {
      country_code: "DE",
      state_code: null,
      postcode: 23552,
      city: "Lübeck",
      street1: "Holstenstraße 40",
      street2: null,
    },
  };

  const v = mapAddressValidation(documented as never);
  check("the carrier's address correction is read from the provider payload", v != null);
  check(
    "a single warning object is read as well as an array",
    v?.warnings.length === 1 && v.warnings[0].code === "REPLACED",
  );
  check("the changed field is named from the warning message", v?.warnings[0].field === "street1");
  check("a correctable address is a warning, not a blocker", v?.severity === "warning");
  check(
    "only the fields that actually differ are suggested",
    v?.suggested?.line1 === "Holstenstraße 40" &&
      v.suggested.townOrCity === undefined &&
      v.suggested.countryCode === undefined,
    JSON.stringify(v?.suggested),
  );
  check(
    "a null suggestion doesn't propose deleting the field",
    v?.suggested?.line2 === undefined && v.suggested.stateOrCounty === undefined,
  );

  // A numeric postcode must survive as a string rather than throwing.
  const numericZip = mapAddressValidation({
    postcode: "94304",
    warnings: { code: "REPLACED", message: "postcode: 94304 -> 94304-2163" },
    suggested_address: { postcode: 943042163 },
  } as never);
  check(
    "a numeric postcode is coerced, not crashed on",
    numericZip?.suggested?.postalOrZipCode === "943042163",
  );

  // An address the validator can't make sense of brings no suggestion. That's
  // fatal — the provider won't create the print job — so it must not be
  // presented as a cosmetic note.
  const unverifiable = mapAddressValidation({
    street1: "Nowhere",
    warnings: { code: "INCOMPLETE", message: "street1: address could not be verified" },
  } as never);
  check("an unverifiable address is an error, not a suggestion", unverifiable?.severity === "error");

  // A carrier that agrees with the customer must not produce a "did you mean?"
  // prompt — Lulu echoes `suggested_address` even when it matches.
  const agreeing = mapAddressValidation({
    street1: "1850 Sand Hill Rd",
    city: "Palo Alto",
    postcode: "94304",
    suggested_address: { street1: "1850 SAND HILL RD", city: "Palo Alto", postcode: "94304" },
  } as never);
  check("an unchanged suggestion is not offered as a choice", agreeing === undefined);
}

// ---- Report ----------------------------------------------------------------

for (const name of checks) console.log(`  ok   ${name}`);
for (const failure of failures) console.error(`  FAIL ${failure}`);
console.log(
  `\n${checks.length} passed, ${failures.length} failed (${product.presentation.name}, ${min}–${max} pages).`,
);
process.exit(failures.length > 0 ? 1 : 0);
