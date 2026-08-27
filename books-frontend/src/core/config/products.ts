/**
 * Admin-editable **product catalog** (the print products customers can order).
 *
 * A {@link ProductDefinition} is one sellable offering. It binds a fulfillment
 * provider + SKU to a physical spec (sizes, binding, cover geometry), eligibility
 * conditions (page/copy limits, …), a cost model (what *we* pay), a multi-currency
 * pricing model (what we *charge*, plus the margin policy), and a shipping policy
 * (which destinations, which methods, how shipping is priced).
 *
 * Two documents back this catalog (see `functions/src/products.ts`):
 *   - PRIVATE  `adminSettings/products` — the full {@link ProductsConfig}, incl.
 *     cost / fee / margin internals. Backend-only (Firestore rules deny clients).
 *   - PUBLIC   `appConfig/products` — a derived {@link PublicProductsConfig}
 *     projection with resolved retail prices but NO cost/margin internals. This
 *     is what the wizard + checkout read live.
 *
 * Only products that pass {@link validateProduct} with no errors AND are `active`
 * are offerable (see `productValidation.ts`).
 */
import { z } from "zod";
import type { Binding, Finish, ShippingMethod } from "../fulfillment/types";
import { LULU_BOOK_FORMATS } from "../fulfillment/lulu/products";
import { sameFormat, skuForVariant, variantFromSku } from "../fulfillment/lulu/skuAxes";
import { geoPolicySchema, type GeoMatch, type GeoPolicy } from "./geo";
// Type-only, so it is erased at compile time and creates no import cycle with
// `shipping.ts` (which imports `CurrencyCode` from here the same way).
import type { ShippingPricingMode } from "./shipping";
import {
  createDefaultVariantPolicy,
  firstAllowedVariant,
  isVariantSelection,
  normalizeVariantPolicy,
  variantAllowed,
  type ProductVariantPolicy,
  type VariantSelection,
} from "./variants";

// ---- Shared primitives -----------------------------------------------------

/** ISO-4217 currency code, e.g. "USD", "EUR", "GBP". */
export type CurrencyCode = string;

// Re-exported so the many modules that already import geo types from the
// catalog keep working; `geo.ts` owns them because the shipping policy needs
// the same schema at runtime and a direct import either way would cycle.
export { geoPolicySchema, geoMatchSchema } from "./geo";
export type { GeoMatch, GeoPolicy } from "./geo";

/** Fulfillment providers we can route an order to. Lulu today; extensible. */
export type FulfillmentProviderId = "lulu" | "manual";

export const FULFILLMENT_PROVIDERS: FulfillmentProviderId[] = ["lulu", "manual"];

export const PROVIDER_LABELS: Record<FulfillmentProviderId, string> = {
  lulu: "Lulu (print-on-demand)",
  manual: "Manual / other",
};

export type ProductStatus = "draft" | "active" | "retired";

export type LengthUnit = "in" | "mm";

export interface Dimensions {
  width: number;
  height: number;
  unit: LengthUnit;
}

// ---- Physical spec ---------------------------------------------------------

/** How the spine width is determined (drives the wraparound cover layout). */
export type SpineModel =
  | { mode: "none" } // saddle-stitch / stapled: no real spine
  | { mode: "perPage"; mmPerPage: number; baseMm: number } // spine = base + pages × perPage
  | { mode: "fixed"; widthMm: number };

export interface CoverSpec {
  /** When false, the cover trims to the same size as an interior page. */
  differsFromPage: boolean;
  sizing:
    | { mode: "providerComputed" } // ask the provider's cover-dimensions API
    | { mode: "fixed"; front: Dimensions; back: Dimensions; spine: SpineModel };
  /** Casewrap board overhang / wrap allowance, inches (hardcover only). */
  wrapMarginIn?: number;
}

export interface ProductSpec {
  binding: Binding;
  finish: Finish;
  /** Human-readable paper description, e.g. "80# coated white". */
  paperLabel?: string;
  orientation: "portrait" | "landscape" | "square";
  /** Physical trim size of a single interior page. */
  pageTrim: Dimensions;
  bleed: { value: number; unit: LengthUnit };
  interiorDpi: number;
  coverDpi: number;
  cover: CoverSpec;
}

// ---- Conditions / eligibility ----------------------------------------------

/**
 * Generic, future-proof eligibility rules. New conditions (the "idk what else"
 * ones) are added as data here, never as a schema change.
 */
export type ConditionRule =
  | { kind: "minOrderValue"; amount: number; currency: CurrencyCode }
  | { kind: "spineTextMinPages"; pages: number }
  | { kind: "ageGate"; minAge: number }
  | { kind: "note"; key: string; message: string };

/** Who is allowed to order a product, by subscription state. */
export type ProductAccessMode = "public" | "subscribersOnly" | "plans";

/**
 * Subscription gate for a product. A first-class field (not a {@link ConditionRule})
 * because it's a hard, server-enforced access check tied to the buyer's plan,
 * distinct from the advisory quote-time eligibility rules in `custom`.
 */
export interface ProductAccess {
  /**
   * - `public`: anyone can order (the default when absent).
   * - `subscribersOnly`: any active **paid** subscriber.
   * - `plans`: only the explicitly listed plan ids (`planIds`).
   */
  mode: ProductAccessMode;
  /** Plan ids allowed when `mode === "plans"` (ignored for other modes). */
  planIds: string[];
}

export interface ProductConditions {
  pages: { min: number; max: number; step: number };
  copies: { min: number; max: number };
  /** Optional content aspect-ratio guard (w/h with a tolerance). */
  allowedAspectRatios?: { ratio: number; tolerance: number }[];
  custom: ConditionRule[];
  /** Subscription gating: who can order this product. Absent ⇒ public. */
  access?: ProductAccess;
}

// ---- Cost model (what WE pay) ----------------------------------------------

export interface CostSurcharge {
  label: string;
  kind: "perOrder" | "perUnit";
  amount: number;
  currency: CurrencyCode;
}

/**
 * Print cost as the provider actually charges it: a fixed amount per copy plus
 * an amount per interior page.
 *
 * The split is not a convenience — it mirrors how the book is made. The base
 * pays for the cover and the binding, which cost the same whether there are 24
 * pages inside or 240, so it is a property of the FORMAT (trim × binding) and
 * therefore of the product. The per-page rate pays for ink and paper, so it is
 * a property of the VARIANT (print tier × paper stock) and varies by more than
 * an order of magnitude across the ones we sell.
 */
export interface CostLine {
  /** Fixed cost per copy: cover, binding, handling. */
  basePerUnit: number;
  /** Cost per interior page: ink and paper. */
  perPage: number;
}

/**
 * Where a cost table came from, so a stale or wrong-environment measurement
 * can be told apart from a fresh one. Costs measured in sandbox must not
 * silently back live pricing, and a table nobody has re-measured in a year is
 * a margin calculation waiting to be wrong.
 */
export interface CostMeasurement {
  at: number;
  env: ProviderEnv;
  /** The reference destination probed, e.g. "US/10001". */
  destination: string;
  /** How far the worst sample missed the fitted line, in the cost currency. */
  fitResidual?: number;
  variantsMeasured: number;
  variantsOffered: number;
}

export interface ProductCostModel {
  /** Currency the cost numbers below are expressed in. */
  currency: CurrencyCode;
  /**
   * How wholesale unit cost is determined when quoting / computing margin:
   *   - "providerLive": a real provider quote (accurate; admin margin preview).
   *   - "table":        the static estimate below (deterministic; used for the
   *                     public price projection and offline previews).
   * Even "providerLive" products should fill `table` so prices can be projected
   * without a network call.
   */
  source: "providerLive" | "table";
  /** The base variant's line — and the fallback for any variant not measured. */
  table: CostLine & {
    quantityBreaks: { minQty: number; unitDiscountPct: number }[];
  };
  /**
   * Per-page cost for each variant that differs from the base, keyed by
   * {@link costVariantKey} (`print/paper`). Only the per-page term appears
   * here: the base is a property of the format, shared by every variant of it,
   * and letting it drift per variant would be fitting noise rather than price.
   *
   * A key that isn't present falls back to `table.perPage`. Since the base
   * variant is the costliest one we sell, that fallback over- rather than
   * under-states cost, which is the safe direction for an unmeasured variant.
   */
  variantPerPage?: Record<string, number>;
  measurement?: CostMeasurement;
  surcharges: CostSurcharge[];
}

// ---- Pricing model (what we CHARGE) + margin policy ------------------------

/** Fee model for the payment processor (Stripe by default). Per currency. */
export interface PaymentFeeModel {
  percentPct: number; // e.g. 2.9
  fixed: number; // e.g. 0.30
  /** Optional extra % for cross-border / FX / payout. */
  extraPct?: number;
}

/** One price bracket: books whose page count falls in [minPages, maxPages]. */
export interface PageTier {
  minPages: number;
  maxPages: number;
  /** Per-unit price per currency for books in this page range. */
  prices: Record<CurrencyCode, number>;
}

/**
 * Per-product pricing — deliberately tiny. The ONLY thing an admin sets per
 * product is the price for each page range (per currency). Everything else
 * (currencies, FX, fees, rounding, tax) is shared across the catalog and lives
 * in {@link PricingSettings}.
 */
export interface ProductPricingModel {
  /** Per-currency price by page range — the only per-product pricing input. */
  tiers: PageTier[];
  /** Page count used when projecting a display ("from") price for the storefront. */
  displayPages?: number;
}

// ---- Global pricing settings (shared economics for the whole catalog) ------

export type TaxBehavior = "inclusive" | "exclusive";

/** How tax is treated for a given currency/market. */
export interface TaxCurrencyPolicy {
  /**
   * Whether the entered price already includes tax (EU/UK consumer law) or tax
   * is added on top at checkout (typical US sales tax).
   */
  behavior: TaxBehavior;
  /**
   * Display-only assumed rate, used purely to show net revenue / margin in the
   * admin readout. Stripe Tax computes and collects the real amount per
   * destination (and books are often zero/reduced-rated).
   */
  assumedRatePct: number;
}

/**
 * Digital-edition (ebook) sales — fully admin-configurable. The ebook is the
 * customer's own finished book as a downloadable PDF; near-zero marginal cost,
 * so it's priced flat per currency. Optional bundle discount rewards buyers who
 * already ordered a print copy of the SAME project.
 */
export interface EbookSettings {
  /** Master switch: hides the ebook option everywhere when false. */
  enabled: boolean;
  /** Sticker price per currency (major units). Missing/0 ⇒ not sold in that currency. */
  prices: Record<CurrencyCode, number>;
  /**
   * Subscriber pricing: `planPrices[planId][currency]` = the price members of
   * that plan pay (major units). `0` means the ebook is INCLUDED with the plan
   * (granted without checkout). A missing plan/currency falls back to the
   * sticker price. The base sticker price still gates availability — a sticker
   * price of 0 disables the ebook for everyone in that currency.
   */
  planPrices: Record<string, Record<CurrencyCode, number>>;
  /** % off the ebook when the buyer already bought a print copy of the same project. */
  printBundleDiscountPct: number;
  /** Stripe product tax code for digital books (drives digital-goods VAT rules). */
  taxCode?: string;
}

/**
 * The plan-specific ebook price for a buyer, or `null` when their plan has no
 * override (⇒ the sticker price applies). `0` means included with the plan.
 * Used by BOTH the server quote and the storefront display, so what the buyer
 * sees is exactly what checkout charges.
 */
export function ebookPlanPrice(
  settings: EbookSettings,
  planId: string | null | undefined,
  currency: CurrencyCode,
): number | null {
  if (!planId) return null;
  const v = settings.planPrices[planId]?.[currency];
  return typeof v === "number" && v >= 0 ? v : null;
}

/**
 * Catalog-wide pricing economics. One document for all products. Editing this
 * does NOT change any product's entered prices — only how margin is computed and
 * how/whether tax is applied.
 */
export interface PricingSettings {
  version: 1;
  /** Currency the margin math runs in; others derive via fx. */
  baseCurrency: CurrencyCode;
  /** Currencies a customer can be charged in (drives the price-table columns). */
  currencies: CurrencyCode[];
  /** Exchange rates (base → currency) + a drift buffer, for cost conversion. */
  fx: { rates: Record<CurrencyCode, number>; bufferPct: number };
  /** Payment-processor fee per currency (e.g. Stripe 2.9% + fixed). */
  fees: Record<CurrencyCode, PaymentFeeModel>;
  /** Optional price rounding per currency (cosmetic; applied to entered prices). */
  rounding: Record<CurrencyCode, { mode: "charm" | "none"; to?: number }>;
  /** Hard price floor per currency (never sell below). */
  floorPrice: Record<CurrencyCode, number>;
  /** Largest discount allowed; the break-even guardrail checks against it. */
  maxDiscountPct: number;
  /**
   * Margin floor (as a % of the revenue you keep) that a sale must preserve.
   * Drives each item's "safe max discount": the deepest promo that still leaves
   * at least this margin after cost, fees and tax. 0 ⇒ safe max == break-even.
   */
  minMarginPct: number;
  /**
   * Assumed share (%) of granted/sold Sparks that customers actually spend on
   * cost-derived actions. Used when costing Spark packs and plan grants for
   * discount planning. 100 ⇒ worst case (every Spark is spent).
   */
  sparkUtilizationPct: number;
  /** Tax handling for Stripe Tax + the admin margin readout. */
  tax: {
    /** Stripe product tax code for physical books (drives zero/reduced rating). */
    bookTaxCode?: string;
    perCurrency: Record<CurrencyCode, TaxCurrencyPolicy>;
  };
  /** Digital-edition sales (disabled by default). */
  ebook: EbookSettings;
}

// ---- Shipping: what this product MEASURED ----------------------------------

/**
 * Shipping POLICY is not declared here.
 *
 * Which speeds we sell, what markup we take, and where the catalog ships live
 * in {@link ShippingSettings} (`config/shipping.ts`), once for the whole
 * catalog. They used to be per product, which made them five copies of one
 * decision that could only drift apart.
 *
 * What remains on a product is what was MEASURED for it, because that genuinely
 * differs: shipping is priced by weight, so a 24-page paperback and a 100-page
 * casewrap to the same address are different numbers.
 *
 * The countries we sell to are likewise not declared here — they live in the
 * admin-managed market registry (`config/markets.ts`), and every geo check
 * intersects with it first, so neither the global policy nor a product's
 * override can ever widen the set. See `isDestinationAllowed`.
 */

/**
 * One speed as the storefront sees it.
 *
 * Resolved from {@link ShippingSettings} when the catalog is projected, not
 * stored on the product. It survives as a type because the public projection
 * still has to name the speeds it published rates for.
 */
export interface ShippingMethodConfig {
  method: ShippingMethod;
  enabled: boolean;
  /** Customer-facing name. Delivery estimates come from the measured rate. */
  label?: string;
}

/**
 * One measured shipping rate: what a speed costs to a country, and how long it
 * takes to get there.
 *
 * A row is only written when we LEARNED something. `available: true` means the
 * provider priced it; `available: false` means the provider refused it, which
 * is a real fact about coverage. A speed we couldn't get an answer for gets no
 * row at all — absence means "unknown", and falls through to the scalar
 * {@link ProductShippingPolicy.fallbackCost}.
 *
 * That three-way distinction is the whole point. When a failed request was
 * recorded as `available: false`, one throttled probe became a permanent claim
 * that a country had no shipping, which blocked saving until someone re-ran a
 * measurement they had no reason to suspect.
 *
 * Cost is fitted as `base + perCopy × copies` rather than stored flat, because
 * a passthrough product BILLS this number to the customer — a single scalar
 * measured at three copies overcharges the person buying one and undercharges
 * the person buying ten.
 */
export interface ShippingFallbackRow {
  /**
   * ISO-2 country this row was measured against.
   *
   * Always a real country: the sweep measures real destinations and never
   * invents a wildcard row, because a rate measured in one country is not
   * evidence about another.
   */
  country: string;
  method: ShippingMethod;
  /** Whether the provider quoted this tier to this country at all. */
  available: boolean;
  /** Shipping cost = `base + perCopy × copies`. Zero when unavailable. */
  base: number;
  perCopy: number;
  /**
   * Business days from start of production to delivery, as the provider
   * reported them. Total elapsed time including printing, NOT time in transit —
   * so "arrives in 5–8 business days" is honest and "shipping takes 5–8 days"
   * is not.
   *
   * Optional because rows measured before the sweep collected them carry none,
   * and an absent estimate must render as no estimate rather than as zero days.
   */
  transitDaysMin?: number;
  transitDaysMax?: number;
}

export interface ProductShippingPolicy {
  /**
   * Narrows the catalog-wide destination policy for this product alone.
   *
   * Undefined for almost everything. It exists for the case the global list
   * can't express — a format too heavy or too large for a carrier that serves
   * the rest of the catalog fine. Like every geo policy it can only narrow:
   * `isDestinationAllowed` intersects with the market registry first.
   */
  destinationsOverride?: GeoPolicy;
  /**
   * What the provider was measured to charge and to offer, per country and
   * tier, in the product's COST currency. Fills in for a live quote when one
   * can't be fetched, and tells validation which tiers actually reach the
   * destinations this product sells to.
   */
  fallback?: ShippingFallbackRow[];
  /** When {@link fallback} was measured (epoch ms). */
  fallbackMeasuredAt?: number;
  /**
   * The dearest single-copy route the sweep saw, in the COST currency.
   *
   * Measured, not configured — which is why it sits here with the rows rather
   * than in the global policy. It stands in for a country that WAS measured but
   * whose specific speed has no row. It is deliberately not used for a country
   * nobody measured: a rate fitted to the routes a sweep visited, billed to a
   * destination it never saw, is a number invented about a country we know
   * nothing about.
   */
  fallbackCost?: number;
}

// ---- Provider SKU verification ---------------------------------------------

/**
 * Provider environments a SKU can be verified in. Mirrors `FulfillmentEnv`,
 * declared locally so the catalog schema doesn't depend on runtime config.
 */
export type ProviderEnv = "sandbox" | "live";

export const PROVIDER_ENVS: ProviderEnv[] = ["sandbox", "live"];

/** The outcome of probing a SKU against one provider environment. */
export interface SkuVerification {
  /** Whether the provider priced the SKU across the product's page range. */
  ok: boolean;
  /** When the probe ran (epoch ms). */
  at: number;
  /**
   * The page counts actually probed. A verification only vouches for the range
   * it tested, so widening `conditions.pages` invalidates it.
   */
  pages: { min: number; max: number };
  /** The provider's own reason when `ok` is false. */
  error?: string;
}

/** The verification record for one environment, if the SKU was ever probed there. */
export function verificationFor(
  provider: ProductDefinition["provider"],
  env: ProviderEnv,
): SkuVerification | undefined {
  return provider.verifiedIn?.[env];
}

/**
 * Whether a SKU is proven usable in an environment. Deliberately strict: an
 * absent record is NOT verified, because "never probed" and "probed and fine"
 * must never be conflated when real money is involved.
 */
export function isVerifiedIn(provider: ProductDefinition["provider"], env: ProviderEnv): boolean {
  return verificationFor(provider, env)?.ok === true;
}

/**
 * Whether a verification still covers the product's configured page range.
 * Widening the range past what was probed makes the old verdict stale rather
 * than wrong — the untested pages were never proven printable.
 */
export function verificationCoversPages(
  record: SkuVerification | undefined,
  pages: { min: number; max: number },
): boolean {
  if (!record?.ok) return false;
  return record.pages.min <= pages.min && record.pages.max >= pages.max;
}

// ---- The product definition ------------------------------------------------

export interface ProductDefinition {
  id: string; // stable internal id (slug), NOT the SKU
  version: 1;
  status: ProductStatus;
  sortOrder: number;

  /**
   * Copy only. Pictures of the product live in `appConfig/catalogMedia` under
   * `book/{id}` — they're uploaded and retired on their own schedule, and a
   * product with none falls back to `book/default`, so pinning them to this
   * record would mean re-saving a product to change a photograph.
   */
  presentation: {
    name: string;
    tagline?: string;
    description: string; // markdown
    badges: string[];
  };

  provider: {
    id: FulfillmentProviderId;
    sku: string; // e.g. Lulu pod_package_id
    printAreas: { interior: string; cover?: string; spine?: string };
    /**
     * Proof the SKU is real, recorded PER ENVIRONMENT. Sandbox and live are
     * separate provider catalogs behind separate credentials, so one verdict
     * can't stand for both — a SKU that only exists in sandbox would fail at
     * print-job creation, which happens after the customer has been charged.
     */
    verifiedIn?: Partial<Record<ProviderEnv, SkuVerification>>;
  };

  spec: ProductSpec;
  /**
   * The choices a customer may make about this same book — print tier, paper,
   * cover finish. The product's own SKU encodes one of each (the base variant);
   * ordering another composes a different SKU from it at checkout, which is why
   * these don't need a product record each. See `variants.ts`.
   */
  variants: ProductVariantPolicy;
  conditions: ProductConditions;
  cost: ProductCostModel;
  pricing: ProductPricingModel;
  shipping: ProductShippingPolicy;

  createdAt: number;
  updatedAt: number;
  updatedBy?: string;
}

export interface ProductsConfig {
  version: 1;
  products: ProductDefinition[];
}

// ---- Public projection (no cost / fee / margin internals) ------------------

/**
 * How shipping is charged, with the cost internals removed.
 *
 * The global policy carries `markupPct`, `fixedAdd` and a measured wholesale
 * rate, none of which belong in a world-readable document. The mode still ships
 * because the storefront needs to say "free shipping"; every actual amount
 * comes from {@link PublicShippingRate} instead, already converted and marked
 * up.
 */
export type PublicShippingPricing = { mode: ShippingPricingMode };

/**
 * What shipping COSTS THE CUSTOMER for one destination and speed, per currency.
 *
 * The customer-facing counterpart of {@link ShippingFallbackRow}: same
 * `base + perCopy × copies` shape, but resolved through the product's pricing
 * policy (markup for passthrough, the flat amount for flat, zero for free) and
 * converted out of the cost currency. So it publishes what a checkout would
 * quote, never what we pay.
 *
 * Keeping the two-term shape rather than a single scalar is the same decision
 * the measurement makes: a flat number measured at three copies overcharges the
 * person buying one and undercharges the person buying ten.
 */
export interface PublicShippingRate {
  /** ISO-2 destination. */
  country: string;
  method: ShippingMethod;
  /**
   * Whether this speed reaches this country at all. False rows are published on
   * purpose — a greyed-out option with a reason beats an option that works right
   * up until the order is refused.
   */
  available: boolean;
  /** Charged shipping = `base + perCopy × copies`, per currency. */
  charged: Record<CurrencyCode, { base: number; perCopy: number }>;
  /**
   * Whether this rate came from a real measurement of this exact route and speed,
   * as opposed to the product's catch-all fallback. Surfaced so a price preview
   * can be honest about which of its two numbers is the softer one.
   */
  measured: boolean;
  /**
   * Business days from order to delivery, including production. Published so
   * the speed picker can say how long each option takes instead of leaving the
   * customer to infer it from the tier's name.
   */
  transitDaysMin?: number;
  transitDaysMax?: number;
}

/** One product as the storefront sees it: prices resolved, internals stripped. */
export interface PublicProduct {
  id: string;
  status: ProductStatus;
  /**
   * Whether this product is actually sellable right now: `active` AND free of
   * configuration errors (verified SKU, measured costs, reachable shipping…).
   *
   * `status` alone is not enough. A product can be active and still be unorderable
   * — an unverified SKU is refused at print-job creation, an unmeasured cost table
   * can't be priced — so the storefront filters on this, not on `status`. Computed
   * server-side against the active provider environment, because SKU verification
   * is per-environment and only the server knows which one it is serving.
   */
  offerable: boolean;
  sortOrder: number;
  name: string;
  tagline?: string;
  description: string;
  badges: string[];
  /**
   * Opaque provider SKU of the BASE variant (needed to quote/order); provider
   * identity is not exposed. Checkout sends this plus the chosen variant and the
   * server composes the SKU that actually prints — the client never builds one.
   */
  sku: string;
  printAreas: { interior: string; cover?: string; spine?: string };
  spec: ProductSpec;
  /** The variants offered, with each option's per-copy surcharge per currency. */
  variants: ProductVariantPolicy;
  /** The variant `sku` encodes and `prices` are quoted for. */
  defaultVariant?: VariantSelection;
  conditions: ProductConditions;
  /** Resolved per-currency display price (per unit) at the display page count. */
  prices: Record<CurrencyCode, number>;
  /** Full per-currency price brackets, so checkout can price by actual page count. */
  priceTiers?: PageTier[];
  supportedCurrencies: CurrencyCode[];
  /** Per-currency tax behavior, so the storefront can label "incl. tax" correctly. */
  taxBehavior: Record<CurrencyCode, TaxBehavior>;
  /**
   * The print discount each plan's members ACTUALLY get, `planPrintDiscountPct[planId]`.
   *
   * Not simply `PlanEntitlements.printDiscountPct`: checkout clamps that to
   * break-even so an order can never sell at a loss, and the clamp needs the cost
   * table, which the storefront must never see. So the clamp is resolved here,
   * once, against the worst scenario the product sells — exactly like `offerable`.
   *
   * The number is therefore safe to display: it can only under-promise. A plan
   * absent from the record grants no print discount.
   */
  planPrintDiscountPct: Record<string, number>;
  shipping: {
    methods: ShippingMethodConfig[];
    destinations: GeoPolicy;
    pricing: PublicShippingPricing;
    /** Charged shipping per destination + speed. See {@link PublicShippingRate}. */
    rates: PublicShippingRate[];
  };
}

export interface PublicProductsConfig {
  version: 1;
  products: PublicProduct[];
  /**
   * When this projection was last built (epoch ms).
   *
   * Everything here is DERIVED — from the catalog, pricing settings, the market
   * registry, coverage and the shipping policy — so it can silently fall behind
   * any of its five inputs. Stamping the build makes "the storefront is still
   * advertising the old markup" a comparison the admin can see rather than a
   * report from a customer.
   *
   * Zero on projections written before this existed, which reads as "unknown"
   * rather than "1970" wherever it's rendered.
   */
  projectedAt: number;
}

// ---- Defaults --------------------------------------------------------------

let idCounter = 0;
/** A reasonably unique slug-ish id for a new product (stable enough for a catalog). */
export function newProductId(prefix = "product"): string {
  idCounter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${rand}-${idCounter}`;
}

export function createDefaultProductsConfig(): ProductsConfig {
  return { version: 1, products: [] };
}

export function createDefaultPricingModel(): ProductPricingModel {
  return {
    tiers: [{ minPages: 0, maxPages: 100000, prices: { USD: 34.99, EUR: 32.99, GBP: 28.99 } }],
  };
}

/** Default catalog-wide pricing economics. */
export function createDefaultPricingSettings(): PricingSettings {
  return {
    version: 1,
    baseCurrency: "USD",
    currencies: ["USD", "EUR", "GBP"],
    fx: { rates: { USD: 1, EUR: 0.92, GBP: 0.79 }, bufferPct: 2 },
    fees: {
      USD: { percentPct: 2.9, fixed: 0.3 },
      EUR: { percentPct: 2.9, fixed: 0.25 },
      GBP: { percentPct: 2.9, fixed: 0.2 },
    },
    rounding: {
      USD: { mode: "charm", to: 0.99 },
      EUR: { mode: "charm", to: 0.99 },
      GBP: { mode: "charm", to: 0.99 },
    },
    floorPrice: { USD: 0, EUR: 0, GBP: 0 },
    maxDiscountPct: 20,
    minMarginPct: 10,
    sparkUtilizationPct: 100,
    tax: {
      // Stripe tax code for printed books (zero/reduced-rated in many markets).
      bookTaxCode: "txcd_35010000",
      perCurrency: {
        // US: sales tax added at checkout. EU/UK: VAT-inclusive display.
        USD: { behavior: "exclusive", assumedRatePct: 0 },
        EUR: { behavior: "inclusive", assumedRatePct: 7 },
        GBP: { behavior: "inclusive", assumedRatePct: 0 },
      },
    },
    ebook: createDefaultEbookSettings(),
  };
}

/** Default ebook settings: off, sensibly priced once switched on. */
export function createDefaultEbookSettings(): EbookSettings {
  return {
    enabled: false,
    prices: { USD: 9.99, EUR: 9.99, GBP: 8.99 },
    planPrices: {},
    printBundleDiscountPct: 50,
    // Stripe tax code for downloadable digital books.
    taxCode: "txcd_10302000",
  };
}

// ---- Subscription access helpers -------------------------------------------

export function defaultProductAccess(): ProductAccess {
  return { mode: "public", planIds: [] };
}

/** The product's access policy, defaulting to public when unset. */
export function productAccessOf(conditions: { access?: ProductAccess } | undefined): ProductAccess {
  const a = conditions?.access;
  if (!a) return defaultProductAccess();
  return { mode: a.mode, planIds: Array.isArray(a.planIds) ? a.planIds : [] };
}

/**
 * Whether a buyer on the given plan may order a product with this access policy.
 * Pure + shared by the backend checkout gate and the storefront UI so they agree.
 */
export function planMeetsAccess(
  access: ProductAccess | undefined,
  ctx: { planId: string | null; isSubscribed: boolean },
): boolean {
  const a = access ?? defaultProductAccess();
  if (a.mode === "public") return true;
  if (a.mode === "subscribersOnly") return ctx.isSubscribed;
  return ctx.planId != null && a.planIds.includes(ctx.planId);
}

export function createDefaultCostModel(): ProductCostModel {
  return {
    currency: "USD",
    source: "providerLive",
    table: { basePerUnit: 0, perPage: 0, quantityBreaks: [] },
    surcharges: [],
  };
}

/**
 * Shipping tiers are NOT universally available, so the default enables the one
 * that is.
 *
 * `Standard` maps to the provider's GROUND service, which it does not run to
 * the US or the UK — asking for it there is a hard refusal, not a fallback, so
 * a product offering only Standard cannot be ordered in either of our biggest
 * markets. `StandardPlus` (PRIORITY_MAIL) quotes everywhere we sell and is the
 * safe default; the rest are opened per product once measured against the
 * destinations it ships to. See `SHIPPING_LEVEL` in `lulu/provider.ts`.
 */
/**
 * A new product carries no shipping policy at all.
 *
 * Everything a product used to declare here — speeds, pricing, destinations —
 * now comes from the catalog-wide {@link ShippingSettings}, so the empty object
 * is the correct and complete default. It fills in as the product is measured.
 */
export function createDefaultShippingPolicy(): ProductShippingPolicy {
  return {};
}

export function createDefaultProduct(overrides: Partial<ProductDefinition> = {}): ProductDefinition {
  const now = Date.now();
  return {
    id: newProductId(),
    version: 1,
    status: "draft",
    sortOrder: 0,
    presentation: { name: "New product", description: "", badges: [] },
    provider: { id: "lulu", sku: "", printAreas: { interior: "interior", cover: "cover" } },
    spec: {
      binding: "casewrap",
      finish: "gloss",
      orientation: "square",
      pageTrim: { width: 8.5, height: 8.5, unit: "in" },
      bleed: { value: 0.125, unit: "in" },
      interiorDpi: 300,
      coverDpi: 200,
      cover: { differsFromPage: true, sizing: { mode: "providerComputed" }, wrapMarginIn: 0.5 },
    },
    // No choices until an admin opens them: a new product can only be ordered as
    // exactly the SKU it names, which is the only combination anyone has checked.
    variants: createDefaultVariantPolicy(),
    conditions: {
      pages: { min: 24, max: 800, step: 2 },
      copies: { min: 1, max: 100 },
      custom: [],
      access: defaultProductAccess(),
    },
    cost: createDefaultCostModel(),
    pricing: createDefaultPricingModel(),
    shipping: createDefaultShippingPolicy(),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ---- Normalization ---------------------------------------------------------

/**
 * Coerce a stored pricing blob into the slim {@link ProductPricingModel}.
 * Tolerates the legacy shape (economics + `strategy.tiers`) by lifting the tiers
 * out and dropping everything that's now global.
 */
export function normalizePricing(input: unknown): ProductPricingModel {
  const p = (input ?? {}) as {
    tiers?: unknown;
    strategy?: { mode?: string; tiers?: unknown };
    displayPages?: unknown;
  };
  let rawTiers: unknown = Array.isArray(p.tiers) ? p.tiers : undefined;
  if (!rawTiers && p.strategy?.mode === "tiered" && Array.isArray(p.strategy.tiers)) {
    rawTiers = p.strategy.tiers;
  }
  let tiers: PageTier[] = Array.isArray(rawTiers)
    ? (rawTiers as PageTier[]).map((t) => ({
        minPages: Number(t?.minPages) || 0,
        maxPages: Number(t?.maxPages) || 0,
        prices: t?.prices && typeof t.prices === "object" ? { ...t.prices } : {},
      }))
    : [];
  if (tiers.length === 0) tiers = createDefaultPricingModel().tiers;
  return {
    tiers,
    displayPages: typeof p.displayPages === "number" ? p.displayPages : undefined,
  };
}

/** Merge a stored (possibly partial) pricing-settings doc onto the defaults. */
export function normalizePricingSettings(input: unknown): PricingSettings {
  const def = createDefaultPricingSettings();
  const p = (input ?? {}) as Partial<PricingSettings>;
  const currencies = Array.isArray(p.currencies) && p.currencies.length > 0 ? p.currencies : def.currencies;
  return {
    version: 1,
    baseCurrency: p.baseCurrency && currencies.includes(p.baseCurrency) ? p.baseCurrency : currencies[0],
    currencies,
    fx: { rates: { ...def.fx.rates, ...p.fx?.rates }, bufferPct: p.fx?.bufferPct ?? def.fx.bufferPct },
    fees: { ...def.fees, ...p.fees },
    rounding: { ...def.rounding, ...p.rounding },
    floorPrice: { ...def.floorPrice, ...p.floorPrice },
    maxDiscountPct: typeof p.maxDiscountPct === "number" ? p.maxDiscountPct : def.maxDiscountPct,
    minMarginPct:
      typeof p.minMarginPct === "number" ? Math.max(0, Math.min(90, p.minMarginPct)) : def.minMarginPct,
    sparkUtilizationPct:
      typeof p.sparkUtilizationPct === "number"
        ? Math.max(1, Math.min(100, p.sparkUtilizationPct))
        : def.sparkUtilizationPct,
    tax: {
      bookTaxCode: p.tax?.bookTaxCode ?? def.tax.bookTaxCode,
      perCurrency: { ...def.tax.perCurrency, ...p.tax?.perCurrency },
    },
    ebook: normalizeEbookSettings(p.ebook),
  };
}

/** Coerce a stored (possibly missing) ebook blob into safe {@link EbookSettings}. */
export function normalizeEbookSettings(raw: unknown): EbookSettings {
  const def = createDefaultEbookSettings();
  const e = (raw ?? {}) as Partial<EbookSettings>;
  const prices: Record<CurrencyCode, number> = { ...def.prices };
  if (e.prices && typeof e.prices === "object") {
    for (const [cur, v] of Object.entries(e.prices)) {
      if (typeof v === "number" && v >= 0) prices[cur] = v;
    }
  }
  const planPrices: Record<string, Record<CurrencyCode, number>> = {};
  if (e.planPrices && typeof e.planPrices === "object") {
    for (const [planId, byCurrency] of Object.entries(e.planPrices)) {
      if (!byCurrency || typeof byCurrency !== "object") continue;
      const entry: Record<CurrencyCode, number> = {};
      for (const [cur, v] of Object.entries(byCurrency as Record<string, unknown>)) {
        if (typeof v === "number" && v >= 0) entry[cur] = v;
      }
      if (Object.keys(entry).length > 0) planPrices[planId] = entry;
    }
  }
  return {
    enabled: e.enabled === true,
    prices,
    planPrices,
    printBundleDiscountPct:
      typeof e.printBundleDiscountPct === "number"
        ? Math.max(0, Math.min(100, e.printBundleDiscountPct))
        : def.printBundleDiscountPct,
    taxCode: typeof e.taxCode === "string" && e.taxCode ? e.taxCode : def.taxCode,
  };
}

/** Coerce a stored access blob into a safe {@link ProductAccess} (defaults to public). */
function normalizeAccess(raw: unknown): ProductAccess {
  const a = (raw ?? {}) as Partial<ProductAccess>;
  const mode: ProductAccessMode =
    a.mode === "subscribersOnly" || a.mode === "plans" ? a.mode : "public";
  const planIds = Array.isArray(a.planIds)
    ? a.planIds.filter((x): x is string => typeof x === "string")
    : [];
  return { mode, planIds };
}

/**
 * Merge a stored (possibly partial / older) product onto the current defaults so
 * every field is present and typed. Tolerant of missing nested objects.
 */
/** Keep only well-formed, known-environment verification records. */
function normalizeVerifiedIn(
  input: Partial<Record<ProviderEnv, SkuVerification>>,
): Partial<Record<ProviderEnv, SkuVerification>> {
  const out: Partial<Record<ProviderEnv, SkuVerification>> = {};
  for (const env of PROVIDER_ENVS) {
    const r = input[env];
    if (!r || typeof r.ok !== "boolean") continue;
    out[env] = {
      ok: r.ok,
      at: Number(r.at) || 0,
      pages: { min: Number(r.pages?.min) || 0, max: Number(r.pages?.max) || 0 },
      ...(r.error ? { error: r.error } : {}),
    };
  }
  return out;
}

export function normalizeProduct(input: unknown): ProductDefinition {
  const def = createDefaultProduct();
  const p = (input ?? {}) as Partial<ProductDefinition>;
  const sku = p.provider?.sku ?? def.provider.sku;
  return {
    ...def,
    ...p,
    version: 1,
    // Explicit, so a legacy `images` array left on a stored product is dropped
    // rather than carried along; product pictures moved to `catalogMedia`.
    presentation: {
      name: p.presentation?.name ?? def.presentation.name,
      ...(p.presentation?.tagline ? { tagline: p.presentation.tagline } : {}),
      description: p.presentation?.description ?? def.presentation.description,
      badges: Array.isArray(p.presentation?.badges) ? p.presentation.badges : def.presentation.badges,
    },
    // Built explicitly (not spread) so the legacy single `verified` boolean is
    // dropped rather than carried along. It claimed a verdict with no
    // environment and no timestamp attached, which is exactly the ambiguity
    // `verifiedIn` exists to remove — those SKUs must be re-probed.
    provider: {
      id: p.provider?.id ?? def.provider.id,
      sku,
      printAreas: { ...def.provider.printAreas, ...p.provider?.printAreas },
      ...(p.provider?.verifiedIn ? { verifiedIn: normalizeVerifiedIn(p.provider.verifiedIn) } : {}),
    },
    spec: { ...def.spec, ...p.spec, cover: { ...def.spec.cover, ...p.spec?.cover } },
    // Anchored to the SKU: whatever the stored policy says, the variant this
    // product IS stays orderable, and options the current build doesn't know are
    // dropped rather than offered and then refused by the provider.
    variants: normalizeVariantPolicy(p.variants, variantFromSku(sku) ?? undefined),
    conditions: {
      ...def.conditions,
      ...p.conditions,
      custom: p.conditions?.custom ?? [],
      access: normalizeAccess(p.conditions?.access),
    },
    cost: normalizeCost(p.cost, def.cost),
    pricing: normalizePricing(p.pricing),
    shipping: normalizeShipping(p.shipping, def.shipping),
  };
}

/** Merge a stored cost model onto the defaults, dropping unusable numbers. */
function normalizeCost(input: unknown, def: ProductCostModel): ProductCostModel {
  const c = (input ?? {}) as Partial<ProductCostModel>;
  const cost: ProductCostModel = {
    ...def,
    ...c,
    table: { ...def.table, ...c.table },
    surcharges: Array.isArray(c.surcharges) ? c.surcharges : def.surcharges,
  };
  // A NaN or negative per-page rate would read as a free (or profitable) page
  // and quietly inflate every margin computed from it.
  const perPage: Record<string, number> = {};
  for (const [key, value] of Object.entries(c.variantPerPage ?? {})) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) perPage[key] = value;
  }
  if (Object.keys(perPage).length > 0) cost.variantPerPage = perPage;
  else delete cost.variantPerPage;
  return cost;
}

/**
 * Keep the measurement, drop everything the catalog-wide policy now owns.
 *
 * This is the whole migration. A stored product still carrying `methods`,
 * `pricing`, `surcharges` or `destinations` parses, loses them here, and writes
 * back slim on its next save — so no backfill script runs and no document has
 * to be touched before the new code can read it.
 *
 * The one salvage is `pricing.fallbackCost`, which was nested inside the old
 * passthrough policy but is a MEASURED number rather than a configured one.
 * Dropping it with the rest would silently discard a calibration and make
 * previously-sellable routes refuse until someone re-measured.
 */
function normalizeShipping(input: unknown, def: ProductShippingPolicy): ProductShippingPolicy {
  const s = (input ?? {}) as Partial<ProductShippingPolicy> & {
    destinations?: GeoPolicy;
    pricing?: { mode?: string; fallbackCost?: number };
  };
  const shipping: ProductShippingPolicy = { ...def };

  // An explicit override wins; otherwise adopt a legacy per-product policy that
  // actually restricted something. A legacy `"all"` said "everywhere we sell",
  // which is exactly what inheriting the global policy now means — carrying it
  // over as an override would freeze today's answer onto the product forever.
  const legacy = s.destinations;
  const override =
    s.destinationsOverride ?? (legacy && legacy.mode !== "all" ? legacy : undefined);
  if (override) shipping.destinationsOverride = override;

  const rows = Array.isArray(s.fallback) ? s.fallback : [];
  const clean = rows.filter(
    (r): r is ShippingFallbackRow =>
      r != null &&
      typeof r.country === "string" &&
      typeof r.method === "string" &&
      typeof r.available === "boolean" &&
      Number.isFinite(r.base) &&
      Number.isFinite(r.perCopy),
  );
  if (clean.length > 0) shipping.fallback = clean;
  if (Number.isFinite(s.fallbackMeasuredAt)) shipping.fallbackMeasuredAt = s.fallbackMeasuredAt;

  const measuredScalar = Number.isFinite(s.fallbackCost)
    ? s.fallbackCost
    : Number.isFinite(s.pricing?.fallbackCost)
      ? s.pricing?.fallbackCost
      : undefined;
  if (typeof measuredScalar === "number" && measuredScalar > 0) {
    shipping.fallbackCost = measuredScalar;
  }
  return shipping;
}

export function normalizeProductsConfig(input: unknown): ProductsConfig {
  const stored = (input ?? {}) as Partial<ProductsConfig>;
  const products = Array.isArray(stored.products) ? stored.products.map(normalizeProduct) : [];
  return { version: 1, products };
}

export function normalizePublicProductsConfig(input: unknown): PublicProductsConfig {
  const stored = (input ?? {}) as Partial<PublicProductsConfig>;
  const products = Array.isArray(stored.products) ? stored.products : [];
  return {
    version: 1,
    products: products.map((p) => ({
      ...p,
      // A projection written before `offerable` existed carries no verdict. Read it
      // as the old rule (active ⇒ offered) rather than as "not offerable", so a
      // catalog that hasn't been re-projected yet still sells instead of going dark.
      offerable: typeof p.offerable === "boolean" ? p.offerable : p.status === "active",
      // Absent on older projections. Empty means "no plan perks and no published
      // shipping rates known", which reads as the honest undiscounted, shipping-
      // unpriceable case rather than as free shipping — the storefront checks for
      // a rate before quoting one.
      planPrintDiscountPct:
        p.planPrintDiscountPct && typeof p.planPrintDiscountPct === "object"
          ? p.planPrintDiscountPct
          : {},
      shipping: {
        ...p.shipping,
        rates: Array.isArray(p.shipping?.rates) ? p.shipping.rates : [],
      },
    })),
    projectedAt: Number.isFinite(stored.projectedAt) ? (stored.projectedAt as number) : 0,
  };
}

// ---- Validation schema (used by the backend before persisting) -------------

const dimensionsSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
  unit: z.enum(["in", "mm"]),
});

const spineSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("none") }),
  z.object({ mode: z.literal("perPage"), mmPerPage: z.number().nonnegative(), baseMm: z.number().nonnegative() }),
  z.object({ mode: z.literal("fixed"), widthMm: z.number().nonnegative() }),
]);

const skuVerificationSchema = z.object({
  ok: z.boolean(),
  at: z.number(),
  pages: z.object({ min: z.number().nonnegative(), max: z.number().nonnegative() }),
  error: z.string().optional(),
});

const bindingEnum = z.enum(["saddle-stitch", "perfect-bound", "coil-bound", "casewrap", "linen-wrap"]);
const finishEnum = z.enum(["matte", "gloss"]);
const shippingMethodEnum = z.enum(["Budget", "Standard", "StandardPlus", "Express", "Overnight"]);

const specSchema = z.object({
  binding: bindingEnum,
  finish: finishEnum,
  paperLabel: z.string().optional(),
  orientation: z.enum(["portrait", "landscape", "square"]),
  pageTrim: dimensionsSchema,
  bleed: z.object({ value: z.number().nonnegative(), unit: z.enum(["in", "mm"]) }),
  interiorDpi: z.number().positive(),
  coverDpi: z.number().positive(),
  cover: z.object({
    differsFromPage: z.boolean(),
    sizing: z.union([
      z.object({ mode: z.literal("providerComputed") }),
      z.object({ mode: z.literal("fixed"), front: dimensionsSchema, back: dimensionsSchema, spine: spineSchema }),
    ]),
    wrapMarginIn: z.number().nonnegative().optional(),
  }),
});

/**
 * Optional and permissive by design: the values are validated against this
 * build's vocabulary by {@link normalizeVariantPolicy}, which runs on every read
 * and write, so a catalog saved before an option was renamed still loads.
 */
const variantChoiceSchema = z.object({
  value: z.string().min(1),
  // A bare number is the legacy flat-per-copy delta; `normalizeVariantDelta`
  // lifts it to `{ perCopy, perPage }` on read so old catalogs price unchanged.
  priceDelta: z
    .record(
      z.string(),
      z.union([z.number(), z.object({ perCopy: z.number(), perPage: z.number() })]),
    )
    .optional(),
});

// Keys stay `z.string()` rather than an axis enum: a keyed record demands an
// entry for every key, and a policy that only opens one axis is normal.
const variantPolicySchema = z.object({
  options: z.record(z.string(), z.array(variantChoiceSchema)).optional(),
  exclusions: z.array(z.record(z.string(), z.string())).optional(),
});

const conditionRuleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("minOrderValue"), amount: z.number().nonnegative(), currency: z.string() }),
  z.object({ kind: z.literal("spineTextMinPages"), pages: z.number().nonnegative() }),
  z.object({ kind: z.literal("ageGate"), minAge: z.number().nonnegative() }),
  z.object({ kind: z.literal("note"), key: z.string(), message: z.string() }),
]);

const accessSchema = z.object({
  mode: z.enum(["public", "subscribersOnly", "plans"]),
  planIds: z.array(z.string()),
});

const conditionsSchema = z.object({
  pages: z.object({ min: z.number().nonnegative(), max: z.number().nonnegative(), step: z.number().positive() }),
  copies: z.object({ min: z.number().nonnegative(), max: z.number().nonnegative() }),
  allowedAspectRatios: z.array(z.object({ ratio: z.number().positive(), tolerance: z.number().nonnegative() })).optional(),
  custom: z.array(conditionRuleSchema),
  access: accessSchema.optional(),
});

const costSchema = z.object({
  currency: z.string(),
  source: z.enum(["providerLive", "table"]),
  table: z.object({
    basePerUnit: z.number().nonnegative(),
    perPage: z.number().nonnegative(),
    quantityBreaks: z.array(z.object({ minQty: z.number().positive(), unitDiscountPct: z.number().min(0).max(100) })),
  }),
  // Keyed by `costVariantKey` (`print/paper`). A plain record rather than an
  // enum-keyed one so a catalog measured before an option was renamed still
  // loads; unknown keys are simply never looked up.
  variantPerPage: z.record(z.string(), z.number().nonnegative()).optional(),
  measurement: z
    .object({
      at: z.number(),
      env: z.enum(["sandbox", "live"]),
      destination: z.string(),
      fitResidual: z.number().nonnegative().optional(),
      variantsMeasured: z.number().nonnegative(),
      variantsOffered: z.number().nonnegative(),
    })
    .optional(),
  surcharges: z.array(
    z.object({
      label: z.string(),
      kind: z.enum(["perOrder", "perUnit"]),
      amount: z.number().nonnegative(),
      currency: z.string(),
    }),
  ),
});

const feeSchema = z.object({
  percentPct: z.number().min(0).max(100),
  fixed: z.number().nonnegative(),
  extraPct: z.number().min(0).max(100).optional(),
});

const pageTierSchema = z.object({
  minPages: z.number().nonnegative(),
  maxPages: z.number().nonnegative(),
  prices: z.record(z.string(), z.number().nonnegative()),
});

const pricingSchema = z.object({
  tiers: z.array(pageTierSchema),
  displayPages: z.number().positive().optional(),
});

const roundingSchema = z.record(z.string(), z.object({ mode: z.enum(["charm", "none"]), to: z.number().optional() }));

export const pricingSettingsSchema = z.object({
  version: z.literal(1),
  baseCurrency: z.string(),
  currencies: z.array(z.string()).min(1),
  fx: z.object({ rates: z.record(z.string(), z.number().positive()), bufferPct: z.number().min(0) }),
  fees: z.record(z.string(), feeSchema),
  rounding: roundingSchema,
  floorPrice: z.record(z.string(), z.number().nonnegative()),
  maxDiscountPct: z.number().min(0).max(100),
  // Optional so configs saved before these knobs existed still validate;
  // normalizePricingSettings fills the defaults.
  minMarginPct: z.number().min(0).max(90).optional(),
  sparkUtilizationPct: z.number().min(0).max(100).optional(),
  tax: z.object({
    bookTaxCode: z.string().optional(),
    perCurrency: z.record(
      z.string(),
      z.object({ behavior: z.enum(["inclusive", "exclusive"]), assumedRatePct: z.number().min(0).max(100) }),
    ),
  }),
  ebook: z
    .object({
      enabled: z.boolean(),
      prices: z.record(z.string(), z.number().nonnegative()),
      planPrices: z
        .record(z.string(), z.record(z.string(), z.number().nonnegative()))
        .optional()
        .default({}),
      printBundleDiscountPct: z.number().min(0).max(100),
      taxCode: z.string().optional(),
    })
    .optional(),
});

/**
 * Only the measurement, plus the rare per-product narrowing.
 *
 * `.passthrough()`-free and deliberately strict about what it KEEPS rather than
 * what it rejects: a document still carrying the old `methods` / `pricing` /
 * `surcharges` keys parses fine and `normalizeShipping` drops them, so the
 * hoist to `adminSettings/shipping` needs no backfill and no downtime.
 */
const shippingSchema = z.object({
  destinationsOverride: geoPolicySchema.optional(),
  fallback: z
    .array(
      z.object({
        country: z.string(),
        method: shippingMethodEnum,
        available: z.boolean(),
        base: z.number().nonnegative(),
        perCopy: z.number().nonnegative(),
        transitDaysMin: z.number().nonnegative().optional(),
        transitDaysMax: z.number().nonnegative().optional(),
      }),
    )
    .optional(),
  fallbackMeasuredAt: z.number().optional(),
  fallbackCost: z.number().nonnegative().optional(),
});

export const productSchema = z.object({
  id: z.string().min(1),
  version: z.literal(1),
  status: z.enum(["draft", "active", "retired"]),
  sortOrder: z.number(),
  presentation: z.object({
    name: z.string(),
    tagline: z.string().optional(),
    description: z.string(),
    badges: z.array(z.string()),
  }),
  provider: z.object({
    id: z.enum(["lulu", "manual"]),
    sku: z.string(),
    printAreas: z.object({ interior: z.string(), cover: z.string().optional(), spine: z.string().optional() }),
    // Spelled out per environment rather than as a record: a product is
    // normally verified in one environment and not the other, and a keyed
    // record would demand an entry for both.
    verifiedIn: z
      .object({ sandbox: skuVerificationSchema.optional(), live: skuVerificationSchema.optional() })
      .optional(),
  }),
  spec: specSchema,
  variants: variantPolicySchema.optional(),
  conditions: conditionsSchema,
  cost: costSchema,
  pricing: pricingSchema,
  shipping: shippingSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
  updatedBy: z.string().optional(),
});

export const productsConfigSchema = z.object({
  version: z.literal(1),
  products: z.array(productSchema),
});

// ---- Seeding from the existing Lulu catalog --------------------------------

function orientationFromAspect(aspect: number): ProductSpec["orientation"] {
  if (aspect >= 1.12) return "landscape";
  if (aspect <= 0.9) return "portrait";
  return "square";
}

/**
 * Build initial {@link ProductDefinition}s from the curated Lulu format catalog
 * so admins start from real SKUs/specs (status `draft`, unverified) instead of a
 * blank slate. One product per trim × binding; print/paper/finish ride on
 * {@link ProductDefinition.variants} so every measured combination is buyable
 * without a product record each.
 *
 * Cost is `providerLive` and the cost TABLE is left empty on purpose: nobody
 * can know what the printer charges for a format without asking it, and a
 * plausible-looking guess baked into the seed would be worse than nothing —
 * it reads as measured, and validation would stop asking for the real thing.
 * The empty table raises an actionable error instead, which blocks OFFERING
 * the product but not saving it.
 *
 * Prices are placeholders too: every seed inherits the single flat default
 * tier, which is a number, not a margin. Print cost climbs steeply with page
 * count, so a seeded product left at the default price sells at a loss on a
 * long book. The order is Verify → Measure → price, and the admin UI walks
 * through it; `suggestVariantDeltas` then prices the variants from what they
 * were measured to cost.
 */
export function seedProductsFromCatalog(): ProductDefinition[] {
  return LULU_BOOK_FORMATS.map((fmt, i) => {
    const bp = fmt.product;
    const base = createDefaultProduct({
      id: newProductId("lulu"),
      sortOrder: i,
      status: "draft",
    });
    return {
      ...base,
      presentation: {
        ...base.presentation,
        name: bp.label,
        description: bp.description,
      },
      // No verification records: the curated catalog's `verified` flag was
      // earned against whichever environment happened to be probed, so a seed
      // can't inherit it. The admin verifies against the target environment.
      provider: {
        id: "lulu",
        sku: bp.sku,
        printAreas: { ...bp.printAreas },
      },
      spec: {
        ...base.spec,
        binding: bp.binding,
        finish: bp.finish,
        orientation: orientationFromAspect(bp.aspect),
        pageTrim: { width: bp.trim.widthIn, height: bp.trim.heightIn, unit: "in" },
        bleed: { value: bp.bleedIn, unit: "in" },
        cover: {
          differsFromPage: bp.binding === "casewrap" || bp.binding === "linen-wrap",
          sizing: { mode: "providerComputed" },
          wrapMarginIn: bp.binding === "casewrap" || bp.binding === "linen-wrap" ? 0.5 : undefined,
        },
      },
      variants: fmt.variants,
      conditions: {
        ...base.conditions,
        pages: { min: bp.minPages, max: bp.maxPages, step: bp.pageStep },
      },
    };
  });
}

/**
 * Find the catalog product for a SKU. Exact match first, then same trim+binding
 * (so an order's composed variant SKU still resolves to its format product).
 */
export function findProductForSku<T extends { provider: { sku: string }; status?: ProductStatus }>(
  products: readonly T[],
  sku: string,
  opts: { activeOnly?: boolean } = {},
): T | undefined {
  const needle = (sku ?? "").trim();
  if (!needle) return undefined;
  const list = opts.activeOnly ? products.filter((p) => p.status === "active") : products;
  const exact = list.find((p) => p.provider.sku === needle);
  if (exact) return exact;
  return list.find((p) => sameFormat(p.provider.sku, needle));
}

/** Storefront counterpart of {@link findProductForSku}. */
export function findPublicProductForSku(
  products: readonly PublicProduct[],
  sku: string,
): PublicProduct | undefined {
  const needle = (sku ?? "").trim();
  if (!needle) return undefined;
  return products.find((p) => p.sku === needle) ?? products.find((p) => sameFormat(p.sku, needle));
}

/**
 * The products a customer may actually be shown and sold. The one gate every
 * storefront surface (size picker, format picker, order stage) should pass its
 * list through, so none of them can offer something checkout will refuse.
 */
export function offerablePublicProducts(
  products: readonly PublicProduct[],
): PublicProduct[] {
  return products.filter((p) => p.status === "active" && p.offerable);
}

/**
 * A product's URL segment for public pages: `8-5x8-5-hardcover`.
 *
 * Derived from the physical spec rather than from `id` or `presentation.name`,
 * for two reasons. Ids are opaque (`lulu-m8kx2p-a91f-3`), which is neither
 * readable nor a thing anyone would search for; names are admin-editable, so a
 * copy tweak would change a URL that search engines and inbound links have
 * already learned. Trim × binding is the product's identity — the catalog holds
 * exactly one product per combination — so the slug is both stable and the words
 * a person actually types.
 */
export function formatSlug(spec: Pick<ProductSpec, "pageTrim" | "binding">): string {
  const n = (v: number) => String(Math.round(v * 10) / 10).replace(".", "-");
  return `${n(spec.pageTrim.width)}x${n(spec.pageTrim.height)}-${spec.binding}`;
}

/**
 * The product a public URL segment names, or undefined.
 *
 * First match wins. Trim × binding is unique in a well-formed catalog, so a
 * collision means two products claim the same physical format — in which case
 * serving the first (the projection is sorted by `sortOrder`) is deterministic,
 * which is what a URL needs to be.
 */
export function findPublicProductBySlug(
  products: readonly PublicProduct[],
  slug: string,
): PublicProduct | undefined {
  const needle = (slug ?? "").trim().toLowerCase();
  if (!needle) return undefined;
  return products.find((p) => formatSlug(p.spec) === needle);
}

/**
 * Turn a checkout request (format SKU + optional variant) into the product, the
 * allowed variant, and the provider SKU that actually prints. Returns null when
 * the format isn't in the catalog or the variant isn't offered.
 */
export function resolvePrintOrder(args: {
  products: readonly ProductDefinition[];
  /** Base format SKU, or any same-format composed SKU. */
  productSku: string;
  variant?: VariantSelection;
  activeOnly?: boolean;
}): { product: ProductDefinition; variant: VariantSelection; printSku: string } | null {
  const product = findProductForSku(args.products, args.productSku, {
    activeOnly: args.activeOnly,
  });
  if (!product) return null;

  const base = variantFromSku(product.provider.sku);
  // An explicitly chosen variant must be offered — never silently substitute a
  // different one (the customer would be charged for something they didn't pick).
  // When the caller only sent a SKU, derive the variant from it and fall back to
  // the nearest orderable option if that exact combo was retired.
  let variant: VariantSelection | undefined;
  if (args.variant && isVariantSelection(args.variant)) {
    if (!variantAllowed(product.variants, args.variant)) return null;
    variant = args.variant;
  } else {
    const derived = variantFromSku(args.productSku) ?? base;
    if (!derived) return null;
    variant = variantAllowed(product.variants, derived)
      ? derived
      : firstAllowedVariant(product.variants, base ?? undefined);
  }
  if (!variant) return null;

  const printSku = skuForVariant(product.provider.sku, variant);
  if (!printSku) return null;
  return { product, variant, printSku };
}
