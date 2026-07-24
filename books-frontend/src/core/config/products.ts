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
import { LULU_BOOK_PRODUCTS } from "../fulfillment/lulu/products";

// ---- Shared primitives -----------------------------------------------------

/** ISO-4217 currency code, e.g. "USD", "EUR", "GBP". */
export type CurrencyCode = string;

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

export interface ProductImage {
  url: string;
  storagePath?: string;
  alt?: string;
  role: "hero" | "gallery" | "sizeGuide";
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
  table: {
    basePerUnit: number; // fixed cost per book
    perPage: number; // × interior page count
    quantityBreaks: { minQty: number; unitDiscountPct: number }[];
  };
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

// ---- Shipping policy + geo restrictions ------------------------------------

export interface GeoMatch {
  country?: string; // ISO-2
  region?: string; // state / province code
}

export interface GeoPolicy {
  mode: "all" | "allowlist" | "blocklist";
  countries: string[]; // ISO-2
  /** Per-country state/province restrictions (e.g. ship to US but not AK/HI). */
  regions: Record<string, { mode: "allowlist" | "blocklist"; codes: string[] }>;
}

export interface ShippingMethodConfig {
  method: ShippingMethod;
  enabled: boolean;
  label?: string; // customer-facing, e.g. "Standard (5–8 business days)"
}

export type ShippingPricing =
  | { mode: "passthrough"; markupPct?: number } // charge provider shipping (+optional markup)
  | { mode: "free"; absorbInPrice: boolean } // free shipping (optionally folded into price)
  | { mode: "flat"; default: number; currency: CurrencyCode; overrides: { match: GeoMatch; amount: number }[] };

export interface ProductShippingPolicy {
  destinations: GeoPolicy;
  methods: ShippingMethodConfig[];
  pricing: ShippingPricing;
  surcharges: { match: GeoMatch; amount: number; currency: CurrencyCode }[];
}

// ---- The product definition ------------------------------------------------

export interface ProductDefinition {
  id: string; // stable internal id (slug), NOT the SKU
  version: 1;
  status: ProductStatus;
  sortOrder: number;

  presentation: {
    name: string;
    tagline?: string;
    description: string; // markdown
    images: ProductImage[];
    badges: string[];
  };

  provider: {
    id: FulfillmentProviderId;
    sku: string; // e.g. Lulu pod_package_id
    printAreas: { interior: string; cover?: string; spine?: string };
    verified: boolean; // confirmed against the live provider catalog
  };

  spec: ProductSpec;
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

/** One product as the storefront sees it: prices resolved, internals stripped. */
export interface PublicProduct {
  id: string;
  status: ProductStatus;
  sortOrder: number;
  name: string;
  tagline?: string;
  description: string;
  images: ProductImage[];
  badges: string[];
  /** Opaque provider SKU (needed to quote/order); provider identity is not exposed. */
  sku: string;
  printAreas: { interior: string; cover?: string; spine?: string };
  spec: ProductSpec;
  conditions: ProductConditions;
  /** Resolved per-currency display price (per unit) at the display page count. */
  prices: Record<CurrencyCode, number>;
  /** Full per-currency price brackets, so checkout can price by actual page count. */
  priceTiers?: PageTier[];
  supportedCurrencies: CurrencyCode[];
  /** Per-currency tax behavior, so the storefront can label "incl. tax" correctly. */
  taxBehavior: Record<CurrencyCode, TaxBehavior>;
  shipping: {
    methods: ShippingMethodConfig[];
    destinations: GeoPolicy;
    pricing: ShippingPricing;
  };
}

export interface PublicProductsConfig {
  version: 1;
  products: PublicProduct[];
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

export function createDefaultShippingPolicy(): ProductShippingPolicy {
  return {
    destinations: { mode: "all", countries: [], regions: {} },
    methods: [
      { method: "Budget", enabled: false },
      { method: "Standard", enabled: true },
      { method: "Express", enabled: false },
    ],
    pricing: { mode: "passthrough" },
    surcharges: [],
  };
}

export function createDefaultProduct(overrides: Partial<ProductDefinition> = {}): ProductDefinition {
  const now = Date.now();
  return {
    id: newProductId(),
    version: 1,
    status: "draft",
    sortOrder: 0,
    presentation: { name: "New product", description: "", images: [], badges: [] },
    provider: { id: "lulu", sku: "", printAreas: { interior: "interior", cover: "cover" }, verified: false },
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
export function normalizeProduct(input: unknown): ProductDefinition {
  const def = createDefaultProduct();
  const p = (input ?? {}) as Partial<ProductDefinition>;
  return {
    ...def,
    ...p,
    version: 1,
    presentation: { ...def.presentation, ...p.presentation },
    provider: { ...def.provider, ...p.provider, printAreas: { ...def.provider.printAreas, ...p.provider?.printAreas } },
    spec: { ...def.spec, ...p.spec, cover: { ...def.spec.cover, ...p.spec?.cover } },
    conditions: {
      ...def.conditions,
      ...p.conditions,
      custom: p.conditions?.custom ?? [],
      access: normalizeAccess(p.conditions?.access),
    },
    cost: { ...def.cost, ...p.cost, table: { ...def.cost.table, ...p.cost?.table } },
    pricing: normalizePricing(p.pricing),
    shipping: { ...def.shipping, ...p.shipping },
  };
}

export function normalizeProductsConfig(input: unknown): ProductsConfig {
  const stored = (input ?? {}) as Partial<ProductsConfig>;
  const products = Array.isArray(stored.products) ? stored.products.map(normalizeProduct) : [];
  return { version: 1, products };
}

export function normalizePublicProductsConfig(input: unknown): PublicProductsConfig {
  const stored = (input ?? {}) as Partial<PublicProductsConfig>;
  return { version: 1, products: Array.isArray(stored.products) ? stored.products : [] };
}

// ---- Validation schema (used by the backend before persisting) -------------

const dimensionsSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
  unit: z.enum(["in", "mm"]),
});

const imageSchema = z.object({
  url: z.string().url(),
  storagePath: z.string().optional(),
  alt: z.string().optional(),
  role: z.enum(["hero", "gallery", "sizeGuide"]),
});

const spineSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("none") }),
  z.object({ mode: z.literal("perPage"), mmPerPage: z.number().nonnegative(), baseMm: z.number().nonnegative() }),
  z.object({ mode: z.literal("fixed"), widthMm: z.number().nonnegative() }),
]);

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

const geoMatchSchema = z.object({ country: z.string().optional(), region: z.string().optional() });

const geoPolicySchema = z.object({
  mode: z.enum(["all", "allowlist", "blocklist"]),
  countries: z.array(z.string()),
  regions: z.record(z.string(), z.object({ mode: z.enum(["allowlist", "blocklist"]), codes: z.array(z.string()) })),
});

const shippingSchema = z.object({
  destinations: geoPolicySchema,
  methods: z.array(z.object({ method: shippingMethodEnum, enabled: z.boolean(), label: z.string().optional() })),
  pricing: z.union([
    z.object({ mode: z.literal("passthrough"), markupPct: z.number().optional() }),
    z.object({ mode: z.literal("free"), absorbInPrice: z.boolean() }),
    z.object({
      mode: z.literal("flat"),
      default: z.number().nonnegative(),
      currency: z.string(),
      overrides: z.array(z.object({ match: geoMatchSchema, amount: z.number().nonnegative() })),
    }),
  ]),
  surcharges: z.array(z.object({ match: geoMatchSchema, amount: z.number().nonnegative(), currency: z.string() })),
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
    images: z.array(imageSchema),
    badges: z.array(z.string()),
  }),
  provider: z.object({
    id: z.enum(["lulu", "manual"]),
    sku: z.string(),
    printAreas: z.object({ interior: z.string(), cover: z.string().optional(), spine: z.string().optional() }),
    verified: z.boolean(),
  }),
  spec: specSchema,
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

/** Documented Lulu page maximums by binding (mins live on each BookProduct). */
const BINDING_MAX_PAGES: Record<Binding, number> = {
  "saddle-stitch": 48,
  "perfect-bound": 800,
  "coil-bound": 470,
  casewrap: 800,
  "linen-wrap": 800,
};

function orientationFromAspect(aspect: number): ProductSpec["orientation"] {
  if (aspect >= 1.12) return "landscape";
  if (aspect <= 0.9) return "portrait";
  return "square";
}

/**
 * Build initial {@link ProductDefinition}s from the curated Lulu catalog so
 * admins start from real SKUs/specs (status `draft`, unverified) instead of a
 * blank slate. Prices default to a 45% target margin; cost is provider-live.
 */
export function seedProductsFromCatalog(): ProductDefinition[] {
  return LULU_BOOK_PRODUCTS.map((bp, i) => {
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
      provider: {
        id: "lulu",
        sku: bp.sku,
        printAreas: { ...bp.printAreas },
        verified: bp.verified,
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
      conditions: {
        ...base.conditions,
        pages: { min: bp.minPages, max: BINDING_MAX_PAGES[bp.binding] ?? 800, step: bp.pageStep },
      },
    };
  });
}
