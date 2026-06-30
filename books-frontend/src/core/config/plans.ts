/**
 * Subscription **plans** — fully admin-configurable and linked to Stripe.
 *
 * Source-of-truth split:
 *   - This config (`adminSettings/plans` private + `appConfig/plans` public)
 *     owns PRESENTATION + ENTITLEMENTS + the monthly Spark grant.
 *   - Stripe owns the recurring **Product + Prices** (amounts, intervals,
 *     currencies) and the subscription lifecycle (renewals, dunning, proration).
 *   - They're linked by ids stored on each plan: `stripeProductId` and a price
 *     map `prices[currency][interval] = { amount, stripePriceId, active }`.
 *
 * The backend (`functions/src/plans.ts`) reconciles a saved plan into Stripe:
 * Prices are immutable, so changing an amount creates a NEW Price and archives
 * the old one — existing subscribers keep their (archived) price, which still
 * resolves to the plan via {@link resolvePlanByPriceId}.
 *
 * Plan names follow the little reader's storybook journey: "Once Upon" (free) →
 * "Story Time" → "Happily Ever After".
 */
import { z } from "zod";

export type PlanStatus = "draft" | "active" | "retired";
export type BillingInterval = "month" | "year";

/** Stripe operates two fully separate ledgers — test (sandbox) and live — with
 *  DIFFERENT product/price ids. We store ids per environment so the same plan
 *  works in both and the admin sandbox↔live toggle never points checkout at an
 *  id that doesn't exist in the active mode. */
export type BillingEnv = "sandbox" | "live";

export const BILLING_INTERVALS: BillingInterval[] = ["month", "year"];

/** One concrete Stripe price for a (currency, interval) combination. */
export interface PlanPricePoint {
  /** Major-unit amount, e.g. 8 or 80. */
  amount: number;
  /**
   * Legacy / most-recently-synced Stripe Price id (kept for back-compat and so
   * existing subscribers on an archived price still resolve). Prefer
   * {@link priceIdForEnv} which reads the per-environment id.
   */
  stripePriceId: string | null;
  /** Per-environment Stripe Price ids (test vs live are entirely separate). */
  stripePriceIds?: Partial<Record<BillingEnv, string | null>>;
  /** False once superseded/archived in Stripe (kept so old subs still resolve). */
  active: boolean;
}

export interface PlanBilling {
  /** Legacy / most-recently-synced Stripe Product id (see {@link productIdForEnv}). */
  stripeProductId: string | null;
  /** Per-environment Stripe Product ids (test vs live are separate). */
  stripeProductIds?: Partial<Record<BillingEnv, string | null>>;
  /** prices[currency][interval] — the per-currency monthly/annual price points. */
  prices: Record<string, Partial<Record<BillingInterval, PlanPricePoint>>>;
  /** Tax behavior for the subscription line (mirrors the catalog's tax model). */
  taxBehavior: "inclusive" | "exclusive";
}

/** What a plan unlocks (the selling points). All data-driven, never code gates. */
export interface PlanEntitlements {
  /** Discount on print orders for active subscribers (capped by break-even). */
  printDiscountPct: number;
  /** Product ids unlocked (empty ⇒ only the base/free formats). */
  formats: string[];
  /** Layout template ids unlocked beyond the basic set. */
  layouts: string[];
  /** Font ids/families unlocked beyond the core set. */
  fonts: string[];
  /** Generic future-proof entitlement keys (advanced edit tools, etc.). */
  features: string[];
  /** Remove the "Made with…" watermark from shared book pages. */
  removeWatermark: boolean;
  /**
   * Usage caps keyed by quota id (see `core/config/quotas.ts`). A value caps
   * that quota for the plan; a negative value means unlimited; an absent key
   * falls back to the quota's registry default. Empty by default ⇒ no limits.
   */
  limits: Record<string, number>;
}

/** Sparks delivered by the plan each billing cycle. */
export interface PlanGrant {
  /** Sparks granted on each successful invoice (every renewal). */
  monthlySparks: number;
  /** One-time extra Sparks on an annual invoice (reward for committing). */
  annualBonusSparks: number;
  /** Max balance carry-over as a multiple of `monthlySparks` (0 ⇒ no cap). */
  rolloverMultiple: number;
}

export interface PlanDefinition {
  id: string;
  version: 1;
  status: PlanStatus;
  sortOrder: number;
  /** The baseline free plan (no Stripe product/price; assigned by default). */
  isFree: boolean;

  presentation: {
    name: string;
    tagline?: string;
    description: string;
    badges: string[];
  };

  billing: PlanBilling;
  grant: PlanGrant;
  entitlements: PlanEntitlements;
  /** Per-action Spark price multiplier for subscribers (e.g. cheaper re-rolls). */
  actionMultipliers: Record<string, number>;

  createdAt: number;
  updatedAt: number;
  updatedBy?: string;
}

export interface PlansConfig {
  version: 1;
  plans: PlanDefinition[];
}

// ---- Public projection (storefront-facing) ---------------------------------

/** One (currency,interval) price the storefront can render + check out against. */
export interface PublicPlanPrice {
  amount: number;
  /** The active Stripe price id to start checkout with (null if not yet synced). */
  priceId: string | null;
}

export interface PublicPlan {
  id: string;
  status: PlanStatus;
  sortOrder: number;
  isFree: boolean;
  name: string;
  tagline?: string;
  description: string;
  badges: string[];
  /** prices[currency][interval] — only the active price + amount (no internals). */
  prices: Record<string, Partial<Record<BillingInterval, PublicPlanPrice>>>;
  /** Entitlements + grant are selling points, so they're public. */
  entitlements: PlanEntitlements;
  grant: PlanGrant;
}

export interface PublicPlansConfig {
  version: 1;
  plans: PublicPlan[];
}

// ---- Defaults --------------------------------------------------------------

let planIdCounter = 0;
export function newPlanId(prefix = "plan"): string {
  planIdCounter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${rand}-${planIdCounter}`;
}

export function createDefaultEntitlements(): PlanEntitlements {
  return { printDiscountPct: 0, formats: [], layouts: [], fonts: [], features: [], removeWatermark: false, limits: {} };
}

export function createDefaultGrant(): PlanGrant {
  return { monthlySparks: 0, annualBonusSparks: 0, rolloverMultiple: 2 };
}

export function createDefaultBilling(): PlanBilling {
  return { stripeProductId: null, prices: {}, taxBehavior: "inclusive" };
}

/** The baseline free plan ("Once Upon") every account falls back to. */
export function createFreePlan(): PlanDefinition {
  const now = Date.now();
  return {
    id: "free",
    version: 1,
    status: "active",
    sortOrder: 0,
    isFree: true,
    presentation: {
      name: "Once Upon",
      tagline: "Start your first story",
      description: "Make a complete book and see the magic. Print at standard price anytime.",
      badges: [],
    },
    billing: createDefaultBilling(),
    grant: createDefaultGrant(),
    entitlements: { ...createDefaultEntitlements(), removeWatermark: false },
    actionMultipliers: {},
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Starter storefront: the free baseline plus two thematic paid tiers. These are
 * editable placeholders (no Stripe price ids yet) so the admin Plans tab has real
 * content to tweak, publish and sync. Sparks grants are sized for ~1–2 books/mo.
 */
export function createDefaultPlansConfig(): PlansConfig {
  const now = Date.now();
  const storyteller: PlanDefinition = {
    id: "storyteller",
    version: 1,
    status: "active",
    sortOrder: 1,
    isFree: false,
    presentation: {
      name: "Storyteller",
      tagline: "For regular bedtime makers",
      description: "A fresh bundle of Sparks every month, cheaper prints, and no watermark on shares.",
      badges: ["Most popular"],
    },
    billing: {
      stripeProductId: null,
      prices: {
        USD: {
          month: { amount: 9.99, stripePriceId: null, active: true },
          year: { amount: 99, stripePriceId: null, active: true },
        },
      },
      taxBehavior: "inclusive",
    },
    grant: { monthlySparks: 600, annualBonusSparks: 1200, rolloverMultiple: 2 },
    entitlements: { ...createDefaultEntitlements(), printDiscountPct: 10, removeWatermark: true },
    actionMultipliers: {},
    createdAt: now,
    updatedAt: now,
  };
  const dreamWeaver: PlanDefinition = {
    id: "dream-weaver",
    version: 1,
    status: "active",
    sortOrder: 2,
    isFree: false,
    presentation: {
      name: "Dream Weaver",
      tagline: "For prolific little libraries",
      description: "Our biggest monthly Spark bundle, the deepest print discount, and every premium extra.",
      badges: ["Best value"],
    },
    billing: {
      stripeProductId: null,
      prices: {
        USD: {
          month: { amount: 24.99, stripePriceId: null, active: true },
          year: { amount: 249, stripePriceId: null, active: true },
        },
      },
      taxBehavior: "inclusive",
    },
    grant: { monthlySparks: 1800, annualBonusSparks: 3600, rolloverMultiple: 2 },
    entitlements: { ...createDefaultEntitlements(), printDiscountPct: 20, removeWatermark: true },
    actionMultipliers: {},
    createdAt: now,
    updatedAt: now,
  };
  return { version: 1, plans: [createFreePlan(), storyteller, dreamWeaver] };
}

export function createDefaultPlan(overrides: Partial<PlanDefinition> = {}): PlanDefinition {
  const now = Date.now();
  return {
    id: newPlanId(),
    version: 1,
    status: "draft",
    sortOrder: 0,
    isFree: false,
    presentation: { name: "New plan", description: "", badges: [] },
    billing: createDefaultBilling(),
    grant: createDefaultGrant(),
    entitlements: createDefaultEntitlements(),
    actionMultipliers: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ---- Normalization ---------------------------------------------------------

/** Normalize a per-environment id map ({ sandbox?, live? }), dropping junk. */
function normalizeEnvIds(raw: unknown): Partial<Record<BillingEnv, string | null>> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const out: Partial<Record<BillingEnv, string | null>> = {};
  for (const env of ["sandbox", "live"] as BillingEnv[]) {
    if (typeof r[env] === "string") out[env] = r[env] as string;
    else if (r[env] === null) out[env] = null;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizePricePoint(raw: unknown): PlanPricePoint {
  const p = (raw ?? {}) as Partial<PlanPricePoint>;
  const point: PlanPricePoint = {
    amount: typeof p.amount === "number" && p.amount >= 0 ? p.amount : 0,
    stripePriceId: typeof p.stripePriceId === "string" ? p.stripePriceId : null,
    active: p.active !== false,
  };
  const envIds = normalizeEnvIds(p.stripePriceIds);
  if (envIds) point.stripePriceIds = envIds;
  return point;
}

function normalizePrices(raw: unknown): PlanBilling["prices"] {
  const out: PlanBilling["prices"] = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [currency, byInterval] of Object.entries(raw as Record<string, unknown>)) {
    if (!byInterval || typeof byInterval !== "object") continue;
    const entry: Partial<Record<BillingInterval, PlanPricePoint>> = {};
    for (const interval of BILLING_INTERVALS) {
      const pp = (byInterval as Record<string, unknown>)[interval];
      if (pp != null) entry[interval] = normalizePricePoint(pp);
    }
    out[currency] = entry;
  }
  return out;
}

function normalizeEntitlements(raw: unknown): PlanEntitlements {
  const d = (raw ?? {}) as Partial<PlanEntitlements>;
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const limits: Record<string, number> = {};
  if (d.limits && typeof d.limits === "object") {
    for (const [k, v] of Object.entries(d.limits as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) limits[k] = Math.trunc(v);
    }
  }
  return {
    printDiscountPct: typeof d.printDiscountPct === "number" ? Math.max(0, Math.min(100, d.printDiscountPct)) : 0,
    formats: arr(d.formats),
    layouts: arr(d.layouts),
    fonts: arr(d.fonts),
    features: arr(d.features),
    removeWatermark: d.removeWatermark === true,
    limits,
  };
}

function normalizeGrant(raw: unknown): PlanGrant {
  const d = (raw ?? {}) as Partial<PlanGrant>;
  return {
    monthlySparks: typeof d.monthlySparks === "number" && d.monthlySparks >= 0 ? d.monthlySparks : 0,
    annualBonusSparks: typeof d.annualBonusSparks === "number" && d.annualBonusSparks >= 0 ? d.annualBonusSparks : 0,
    rolloverMultiple: typeof d.rolloverMultiple === "number" && d.rolloverMultiple >= 0 ? d.rolloverMultiple : 2,
  };
}

export function normalizePlan(input: unknown): PlanDefinition {
  const def = createDefaultPlan();
  const p = (input ?? {}) as Partial<PlanDefinition>;
  const multipliers: Record<string, number> = {};
  if (p.actionMultipliers && typeof p.actionMultipliers === "object") {
    for (const [k, v] of Object.entries(p.actionMultipliers)) {
      if (typeof v === "number" && v >= 0) multipliers[k] = v;
    }
  }
  return {
    ...def,
    ...p,
    version: 1,
    isFree: p.isFree === true,
    presentation: { ...def.presentation, ...p.presentation, badges: p.presentation?.badges ?? [] },
    billing: {
      stripeProductId: typeof p.billing?.stripeProductId === "string" ? p.billing.stripeProductId : null,
      ...(normalizeEnvIds(p.billing?.stripeProductIds)
        ? { stripeProductIds: normalizeEnvIds(p.billing?.stripeProductIds) }
        : {}),
      prices: normalizePrices(p.billing?.prices),
      taxBehavior: p.billing?.taxBehavior === "exclusive" ? "exclusive" : "inclusive",
    },
    grant: normalizeGrant(p.grant),
    entitlements: normalizeEntitlements(p.entitlements),
    actionMultipliers: multipliers,
  };
}

export function normalizePlansConfig(input: unknown): PlansConfig {
  const stored = (input ?? {}) as Partial<PlansConfig>;
  const plans = Array.isArray(stored.plans) ? stored.plans.map(normalizePlan) : [];
  // Guarantee a single free plan always exists as the baseline.
  if (!plans.some((p) => p.isFree)) plans.unshift(createFreePlan());
  return { version: 1, plans };
}

export function normalizePublicPlansConfig(input: unknown): PublicPlansConfig {
  const stored = (input ?? {}) as Partial<PublicPlansConfig>;
  return { version: 1, plans: Array.isArray(stored.plans) ? stored.plans : [] };
}

// ---- Public projection -----------------------------------------------------

/**
 * Strip internals; expose only the active price id + amount per currency/interval.
 * The price id is resolved for the given environment so the storefront starts
 * checkout against the right (test vs live) Stripe price.
 */
export function toPublicPlan(plan: PlanDefinition, env: BillingEnv = "sandbox"): PublicPlan {
  const prices: PublicPlan["prices"] = {};
  for (const [currency, byInterval] of Object.entries(plan.billing.prices)) {
    const entry: Partial<Record<BillingInterval, PublicPlanPrice>> = {};
    for (const interval of BILLING_INTERVALS) {
      const pp = byInterval?.[interval];
      if (pp && pp.active) entry[interval] = { amount: pp.amount, priceId: priceIdForEnv(pp, env) };
    }
    if (Object.keys(entry).length > 0) prices[currency] = entry;
  }
  return {
    id: plan.id,
    status: plan.status,
    sortOrder: plan.sortOrder,
    isFree: plan.isFree,
    name: plan.presentation.name,
    tagline: plan.presentation.tagline,
    description: plan.presentation.description,
    badges: plan.presentation.badges,
    prices,
    entitlements: plan.entitlements,
    grant: plan.grant,
  };
}

// ---- Resolution helpers ----------------------------------------------------

/** The baseline free plan, or null if (somehow) none exists. */
export function freePlan(config: PlansConfig): PlanDefinition | null {
  return config.plans.find((p) => p.isFree) ?? null;
}

/**
 * The Stripe Price id to use for a price point in a given environment. Falls
 * back to the legacy single id ONLY for sandbox — a legacy id was created in
 * test mode during development, so it must never be used as a live price id.
 */
export function priceIdForEnv(pp: PlanPricePoint | undefined, env: BillingEnv): string | null {
  if (!pp) return null;
  const byEnv = pp.stripePriceIds?.[env];
  if (byEnv) return byEnv;
  return env === "sandbox" ? (pp.stripePriceId ?? null) : null;
}

/** The Stripe Product id for a plan in a given environment (sandbox-only legacy fallback). */
export function productIdForEnv(billing: PlanBilling, env: BillingEnv): string | null {
  const byEnv = billing.stripeProductIds?.[env];
  if (byEnv) return byEnv;
  return env === "sandbox" ? (billing.stripeProductId ?? null) : null;
}

/** Whether a price point references a given Stripe price id in ANY environment. */
function pricePointHasId(pp: PlanPricePoint | undefined, priceId: string): boolean {
  if (!pp) return false;
  if (pp.stripePriceId === priceId) return true;
  const ids = pp.stripePriceIds;
  return Boolean(ids && (ids.sandbox === priceId || ids.live === priceId));
}

/**
 * Find the plan that owns a Stripe price id — scanning ALL price points
 * including archived (`active:false`) ones, so a subscriber on a superseded
 * price still resolves to their plan and keeps their entitlements/grant.
 */
export function resolvePlanByPriceId(config: PlansConfig, priceId: string | null): PlanDefinition | null {
  if (!priceId) return null;
  for (const plan of config.plans) {
    for (const byInterval of Object.values(plan.billing.prices)) {
      for (const interval of BILLING_INTERVALS) {
        if (pricePointHasId(byInterval?.[interval], priceId)) return plan;
      }
    }
  }
  return null;
}

/** The interval a Stripe price id belongs to within a plan (for grant logic). */
export function intervalForPriceId(plan: PlanDefinition, priceId: string): BillingInterval | null {
  for (const byInterval of Object.values(plan.billing.prices)) {
    for (const interval of BILLING_INTERVALS) {
      if (pricePointHasId(byInterval?.[interval], priceId)) return interval;
    }
  }
  return null;
}

/** Resolve the active Stripe price id for a (currency, interval) on a public plan. */
export function publicPriceId(
  plan: PublicPlan,
  currency: string,
  interval: BillingInterval,
): string | null {
  return plan.prices[currency]?.[interval]?.priceId ?? null;
}

/** Find the public plan that owns a Stripe price id (across currencies/intervals). */
export function findPublicPlanByPriceId(plans: PublicPlan[], priceId: string | null): PublicPlan | null {
  if (!priceId) return null;
  for (const plan of plans) {
    for (const byInterval of Object.values(plan.prices)) {
      for (const interval of BILLING_INTERVALS) {
        if (byInterval?.[interval]?.priceId === priceId) return plan;
      }
    }
  }
  return null;
}

// ---- Validation (used by the backend before persisting) --------------------

const envIdsSchema = z
  .object({ sandbox: z.string().nullable().optional(), live: z.string().nullable().optional() })
  .optional();

const pricePointSchema = z.object({
  amount: z.number().min(0),
  stripePriceId: z.string().nullable(),
  stripePriceIds: envIdsSchema,
  active: z.boolean(),
});

const billingSchema = z.object({
  stripeProductId: z.string().nullable(),
  stripeProductIds: envIdsSchema,
  prices: z.record(
    z.string(),
    z.object({ month: pricePointSchema.optional(), year: pricePointSchema.optional() }),
  ),
  taxBehavior: z.enum(["inclusive", "exclusive"]),
});

const entitlementsSchema = z.object({
  printDiscountPct: z.number().min(0).max(100),
  formats: z.array(z.string()),
  layouts: z.array(z.string()),
  fonts: z.array(z.string()),
  features: z.array(z.string()),
  removeWatermark: z.boolean(),
  limits: z.record(z.string(), z.number()).optional().default({}),
});

const grantSchema = z.object({
  monthlySparks: z.number().min(0),
  annualBonusSparks: z.number().min(0),
  rolloverMultiple: z.number().min(0),
});

export const planSchema = z.object({
  id: z.string().min(1),
  version: z.literal(1),
  status: z.enum(["draft", "active", "retired"]),
  sortOrder: z.number(),
  isFree: z.boolean(),
  presentation: z.object({
    name: z.string(),
    tagline: z.string().optional(),
    description: z.string(),
    badges: z.array(z.string()),
  }),
  billing: billingSchema,
  grant: grantSchema,
  entitlements: entitlementsSchema,
  actionMultipliers: z.record(z.string(), z.number().min(0)),
  createdAt: z.number(),
  updatedAt: z.number(),
  updatedBy: z.string().optional(),
});

export const plansConfigSchema = z.object({
  version: z.literal(1),
  plans: z.array(planSchema),
});
