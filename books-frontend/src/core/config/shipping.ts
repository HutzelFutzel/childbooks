/**
 * How shipping is SOLD — one policy for the whole catalog.
 *
 * This used to live on every product, which made it five copies of the same
 * decision. Nothing about "do we sell Overnight" or "what markup do we take"
 * varies by book, so a per-product copy could only ever drift: a speed enabled
 * on three products and forgotten on the fourth is invisible in the admin and
 * shows up as a customer who can't pick it.
 *
 * What stays on the product is the MEASUREMENT — `shipping.fallback`, the rates
 * the provider quoted for that specific book. That one genuinely differs,
 * because shipping is priced by weight and a 24-page paperback is not a
 * 100-page casewrap. Policy is declared here; cost is discovered there.
 *
 * ONE document, `adminSettings/shipping`, and deliberately no public mirror.
 * Everything the storefront needs — which speeds reach a country, their labels,
 * what they cost — is already resolved into the public product projection by
 * `projectShippingRates`. A second public document would be a second source of
 * truth for the same question, and the two would disagree the moment one was
 * written and the other wasn't.
 *
 * Availability is NOT declared here either. Which speeds reach which country is
 * discovered by the coverage sweep (`marketCapability.ts`) and the per-product
 * rate measurement. This file only says which of them we're willing to sell.
 */
import { z } from "zod";
import type { ShippingMethod } from "../fulfillment/types";
import { geoPolicySchema, type CurrencyCode, type GeoPolicy } from "./products";

/**
 * Every speed, slowest first.
 *
 * The canonical order, exported because four modules had their own copy of this
 * array and they had drifted — one omitted `Overnight` entirely, so a speed the
 * provider runs could never be sold no matter what an admin ticked.
 */
export const SHIPPING_METHODS: readonly ShippingMethod[] = [
  "Budget",
  "Standard",
  "StandardPlus",
  "Express",
  "Overnight",
];

/**
 * Fallback customer-facing names.
 *
 * Deliberately free of delivery estimates. An earlier version suggested typing
 * "Standard (5–8 business days)" into the label, which is a promise nobody
 * re-checks — the real figure comes from the provider per country and is
 * rendered next to the label at checkout.
 */
export const DEFAULT_METHOD_LABELS: Readonly<Record<ShippingMethod, string>> = {
  Budget: "Budget",
  Standard: "Standard",
  StandardPlus: "Standard Plus",
  Express: "Express",
  Overnight: "Overnight",
};

/**
 * What each speed is, for the admin deciding whether to sell it.
 *
 * Deliberately says nothing about which countries a speed reaches. An earlier
 * version did — "Express: US only", "Standard: not offered to the US or the UK"
 * — and those were hand-written claims that went stale silently. Coverage is
 * discovered per country by the sweep and shown next to the country it applies
 * to, where it can be wrong out loud instead of quietly.
 */
export const METHOD_HINTS: Readonly<Record<ShippingMethod, string>> = {
  Budget: "Cheapest and slowest, untracked. Tends to drop out on large orders.",
  Standard: "Ground courier, tracked.",
  StandardPlus: "Tracked priority post. The broadest coverage of the five.",
  Express: "Fast courier.",
  Overnight: "Fastest and dearest.",
};

/** Whether we sell a speed at all, and what to call it. */
export interface ShippingMethodSetting {
  /**
   * Whether this speed may be sold anywhere.
   *
   * A veto, not an enablement: `true` means "offer it wherever the provider
   * runs it", which is why opening a market needs no per-speed work. The old
   * model made this the source of truth and left coverage advisory, so a speed
   * the provider didn't run to a country was still offered there and failed the
   * order after the customer had typed their address.
   */
  offered: boolean;
  /** Customer-facing name. Falls back to {@link DEFAULT_METHOD_LABELS}. */
  label?: string;
}

export type ShippingPricingMode = "passthrough" | "free" | "flat";

export interface ShippingPricingSettings {
  mode: ShippingPricingMode;
  /** Markup on the provider's cost, percent. Passthrough only. */
  markupPct: number;
  /**
   * Flat handling charge added on top of the marked-up provider cost.
   *
   * Passthrough only: `free` means free, and `flat` already names its own
   * amount, so adding a handling fee to either would contradict the mode.
   */
  fixedAdd: number;
  fixedAddKind: "perOrder" | "perCopy";
  /**
   * Currency `fixedAdd` is entered in.
   *
   * It is a PRICE, so it converts at the plain rate. Cost converts with the FX
   * buffer, which exists to overstate what we pay — applying it to something we
   * charge would just overcharge the customer.
   */
  fixedAddCurrency: CurrencyCode;
  /** Free shipping: fold the cost into the book price rather than absorb it. */
  absorbInPrice: boolean;
  /**
   * Flat mode charges a rate PER SPEED, not one rate for all of them.
   *
   * A single flat amount is what makes flat mode dangerous next to automatic
   * availability: the customer picks Overnight, pays the Budget rate, and the
   * difference comes out of margin. A speed with no entry here isn't sellable
   * under flat mode.
   */
  flatPerMethod: Partial<Record<ShippingMethod, number>>;
  flatCurrency: CurrencyCode;
}

export interface ShippingSettings {
  version: 1;
  /** Always all five, so "absent" never has to mean something. */
  methods: Record<ShippingMethod, ShippingMethodSetting>;
  /**
   * Per-country vetoes, for "the provider runs it, we don't want to sell it
   * here". Sparse: only countries someone has actually touched.
   */
  countryOverrides: Record<string, { disabled: ShippingMethod[] }>;
  /**
   * Where the catalog ships, before the market registry narrows it and before
   * any single product narrows it further. Still only ever a NARROWING of the
   * registry — `isDestinationAllowed` intersects with it first.
   */
  destinations: GeoPolicy;
  pricing: ShippingPricingSettings;
  updatedAt: number;
  updatedBy: string;
}

/**
 * The seeded policy: every speed on, cost passed through at no markup.
 *
 * All five are offered because that is the point of deriving availability —
 * the provider decides what reaches a country and we sell whatever it will
 * carry. Safe under passthrough, where the customer pays what we're charged.
 * Switching to flat or free is what makes it unsafe, which is why
 * {@link withPricingMode} turns them off on that transition rather than
 * leaving a trap in the schema.
 */
export function createDefaultShippingSettings(): ShippingSettings {
  const methods = {} as Record<ShippingMethod, ShippingMethodSetting>;
  for (const method of SHIPPING_METHODS) methods[method] = { offered: true };
  return {
    version: 1,
    methods,
    countryOverrides: {},
    destinations: { mode: "all", countries: [], regions: {} },
    pricing: {
      mode: "passthrough",
      markupPct: 0,
      fixedAdd: 0,
      fixedAddKind: "perOrder",
      fixedAddCurrency: "USD",
      absorbInPrice: false,
      flatPerMethod: {},
      flatCurrency: "USD",
    },
    updatedAt: 0,
    updatedBy: "seed",
  };
}

/**
 * Switch pricing mode, turning off the speeds the new mode can't safely carry.
 *
 * Leaving every speed on when moving to `flat` or `free` would quietly sell
 * Overnight at the Budget rate — the loss is real, immediate, and invisible
 * until someone reads a margin report. So the transition keeps only the
 * cheapest speed and makes re-enabling the others deliberate.
 */
export function withPricingMode(
  settings: ShippingSettings,
  mode: ShippingPricingMode,
): ShippingSettings {
  if (mode === settings.pricing.mode) return settings;
  const methods = { ...settings.methods };
  if (mode !== "passthrough") {
    for (const method of SHIPPING_METHODS) {
      methods[method] = { ...methods[method], offered: method === SHIPPING_METHODS[0] };
    }
  }
  return { ...settings, methods, pricing: { ...settings.pricing, mode } };
}

/** The speeds we're willing to sell at all, in canonical order. */
export function offeredMethods(settings: ShippingSettings): ShippingMethod[] {
  return SHIPPING_METHODS.filter((m) => settings.methods[m]?.offered);
}

/** Whether a speed may be sold to one country (global veto + country veto). */
export function methodOfferedIn(
  settings: ShippingSettings,
  country: string | null | undefined,
  method: ShippingMethod,
): boolean {
  if (!settings.methods[method]?.offered) return false;
  const code = (country ?? "").trim().toUpperCase();
  if (!code) return true;
  return !settings.countryOverrides[code]?.disabled.includes(method);
}

/** The customer-facing name for a speed. */
export function methodLabel(settings: ShippingSettings, method: ShippingMethod): string {
  return settings.methods[method]?.label?.trim() || DEFAULT_METHOD_LABELS[method];
}

// ---- Normalization ---------------------------------------------------------

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function str(v: unknown, fallback = "", max = 200): string {
  return typeof v === "string" ? v.slice(0, max) : fallback;
}

function isMethod(v: unknown): v is ShippingMethod {
  return typeof v === "string" && (SHIPPING_METHODS as readonly string[]).includes(v);
}

export function normalizeShippingSettings(input: unknown): ShippingSettings {
  const def = createDefaultShippingSettings();
  const s = (input ?? {}) as Partial<ShippingSettings>;

  // A missing document is a first run, not "sell nothing". Seeding here rather
  // than returning an empty policy means the very first admin page load shows
  // the speeds the storefront is already able to serve.
  if (!s.methods || typeof s.methods !== "object") return def;

  const methods = {} as Record<ShippingMethod, ShippingMethodSetting>;
  for (const method of SHIPPING_METHODS) {
    const raw = (s.methods as Partial<Record<ShippingMethod, ShippingMethodSetting>>)[method];
    const label = str(raw?.label, "", 60).trim();
    methods[method] = {
      // Unknown reads as offered, matching the seeded default: a speed added to
      // the enum later should behave like the rest rather than be silently
      // unsellable until someone notices a checkbox they've never seen.
      offered: typeof raw?.offered === "boolean" ? raw.offered : true,
      ...(label ? { label } : {}),
    };
  }

  const countryOverrides: ShippingSettings["countryOverrides"] = {};
  for (const [rawCountry, rawValue] of Object.entries(s.countryOverrides ?? {})) {
    const country = rawCountry.trim().toUpperCase();
    if (country.length !== 2) continue;
    const disabled = Array.isArray(rawValue?.disabled)
      ? [...new Set(rawValue.disabled.filter(isMethod))]
      : [];
    if (disabled.length > 0) countryOverrides[country] = { disabled };
  }

  const p = (s.pricing ?? {}) as Partial<ShippingPricingSettings>;
  const flatPerMethod: Partial<Record<ShippingMethod, number>> = {};
  for (const [rawMethod, rawAmount] of Object.entries(p.flatPerMethod ?? {})) {
    if (!isMethod(rawMethod)) continue;
    const amount = num(rawAmount, -1);
    if (amount >= 0) flatPerMethod[rawMethod] = amount;
  }

  const destinations = s.destinations;
  return {
    version: 1,
    methods,
    countryOverrides,
    destinations:
      destinations && typeof destinations === "object" && Array.isArray(destinations.countries)
        ? {
            mode:
              destinations.mode === "allowlist" || destinations.mode === "blocklist"
                ? destinations.mode
                : "all",
            countries: destinations.countries
              .filter((c): c is string => typeof c === "string")
              .map((c) => c.trim().toUpperCase())
              .filter((c) => c.length === 2),
            regions:
              destinations.regions && typeof destinations.regions === "object"
                ? destinations.regions
                : {},
          }
        : def.destinations,
    pricing: {
      mode: p.mode === "free" || p.mode === "flat" ? p.mode : "passthrough",
      // A negative markup would sell shipping below cost, and a NaN would make
      // every downstream amount NaN — both clamp to the harmless value rather
      // than propagating into a charged price.
      markupPct: Math.max(0, num(p.markupPct)),
      fixedAdd: Math.max(0, num(p.fixedAdd)),
      fixedAddKind: p.fixedAddKind === "perCopy" ? "perCopy" : "perOrder",
      fixedAddCurrency: str(p.fixedAddCurrency, "USD", 3).toUpperCase() || "USD",
      absorbInPrice: p.absorbInPrice === true,
      flatPerMethod,
      flatCurrency: str(p.flatCurrency, "USD", 3).toUpperCase() || "USD",
    },
    updatedAt: num(s.updatedAt),
    updatedBy: str(s.updatedBy, "", 120),
  };
}

// ---- Validation (backend, before persisting) -------------------------------

const methodEnum = z.enum(["Budget", "Standard", "StandardPlus", "Express", "Overnight"]);

export const shippingSettingsSchema = z.object({
  version: z.literal(1).optional(),
  methods: z.record(
    methodEnum,
    z.object({ offered: z.boolean(), label: z.string().max(60).optional() }),
  ),
  countryOverrides: z
    .record(z.string().length(2), z.object({ disabled: z.array(methodEnum) }))
    .optional(),
  destinations: geoPolicySchema.optional(),
  pricing: z
    .object({
      mode: z.enum(["passthrough", "free", "flat"]),
      markupPct: z.number().min(0).max(500).optional(),
      fixedAdd: z.number().nonnegative().optional(),
      fixedAddKind: z.enum(["perOrder", "perCopy"]).optional(),
      fixedAddCurrency: z.string().max(3).optional(),
      absorbInPrice: z.boolean().optional(),
      flatPerMethod: z.record(methodEnum, z.number().nonnegative()).optional(),
      flatCurrency: z.string().max(3).optional(),
    })
    .optional(),
  updatedAt: z.number().optional(),
  updatedBy: z.string().max(120).optional(),
});
