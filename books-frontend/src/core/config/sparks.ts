/**
 * **Sparks** — the platform's internal currency, used to pay for the variable
 * backend cost of AI generation. The honest principle: *the book is the product,
 * Sparks just pay for the kitchen*. Sparks meter the one thing that genuinely
 * costs money per use (image generation); the thinking/text steps are free.
 *
 * Two pieces live here:
 *   1. {@link SparksConfig} — the admin-editable economics (`appConfig/sparks`,
 *      world-readable so the studio can show prices live). Peg + markup + per-
 *      action pricing + the starter grant + the small negative buffer + buyable
 *      top-up packs.
 *   2. The pure pricing calculator — turns a measured/estimated USD cost into a
 *      whole-Spark price using the peg + markup, with per-action overrides.
 *
 * SAFETY: when `enabled` is false (the default), every action prices to 0 and the
 * spend path is skipped, so the app behaves exactly as it did before Sparks — an
 * admin turns the economy on only once it's configured.
 */
import { z } from "zod";
import {
  ALL_IMAGE_ACTION_IDS,
  ALL_TEXT_ACTION_IDS,
  type ImageActionId,
  type TextActionId,
} from "../ai/actions";

/** Any LLM action that can carry a Spark price. */
export type SparkActionId = TextActionId | ImageActionId;

/**
 * How an action's Spark price is determined:
 *   - `free`    — always 0 (the recommended default for text/thinking steps).
 *   - `derived` — computed from the measured provider cost × markup ÷ peg
 *                 (the recommended default for image generation).
 *   - `fixed`   — a flat, admin-pinned number of Sparks regardless of cost.
 */
export type ActionPricingMode = "free" | "derived" | "fixed";

export interface ActionPricing {
  mode: ActionPricingMode;
  /** Flat price when `mode === "fixed"`. */
  fixedSparks: number;
  /**
   * Pre-flight estimate used to RESERVE Sparks before a call whose exact cost
   * isn't known yet. The real price is settled from measured usage afterwards.
   */
  estimatedSparks: number;
}

/** One buyable top-up pack (the power-user overflow valve). */
export interface SparkPack {
  id: string;
  label: string;
  /** Base Sparks granted. */
  sparks: number;
  /** Extra Sparks as a volume reward (shown as a "+N bonus"). */
  bonusSparks: number;
  /** Per-currency price (major units), e.g. `{ USD: 2.99 }`. */
  prices: Record<string, number>;
  active: boolean;
  sortOrder: number;
}

/**
 * The starter-grant LADDER — free Sparks are earned in rungs so a visitor can
 * try generation before signing up, but the full grant requires a verified
 * account (each rung is a separate one-time, idempotent grant):
 *   1. `guestSparks`       — any session, including anonymous guests.
 *   2. `signupBonusSparks` — when the guest becomes a real account.
 *   3. `verifyBonusSparks` — when the account's email is verified.
 */
export interface GrantLadder {
  guestSparks: number;
  signupBonusSparks: number;
  verifyBonusSparks: number;
}

/** Referral rewards: both sides get Sparks when the referred user first PAYS. */
export interface ReferralSettings {
  enabled: boolean;
  /** Sparks granted to the referrer when their invitee makes a first purchase. */
  referrerSparks: number;
  /** Sparks granted to the referred user on their first purchase. */
  referredSparks: number;
}

/** The full admin-editable Sparks economy (the `appConfig/sparks` document). */
export interface SparksConfig {
  version: 1;
  /** Master switch. When false the whole economy is dormant (everything free). */
  enabled: boolean;
  /** USD value of one Spark (the peg), e.g. 0.02. */
  sparkValueUsd: number;
  /** Markup over raw provider cost when deriving a price, e.g. 2.5. */
  markupMultiplier: number;
  /**
   * The free-Sparks ladder (guest → signup → verified). The rungs together
   * should be enough for ~one complete book; the guest rung alone should cover
   * a taste of generation (a character or two) so value lands before signup.
   */
  grants: GrantLadder;
  /**
   * How far a balance may go negative so an in-flight action (whose real cost
   * landed above the reserved estimate) can always finish — never fail a render
   * mid-book. Once negative the user must top up before the next action.
   */
  maxNegativeSparks: number;
  /** Per-action pricing rules (keyed by {@link SparkActionId}). */
  actions: Record<string, ActionPricing>;
  /** Buyable top-up packs. */
  packs: SparkPack[];
  /** Referral rewards (paid-gated so they can't be farmed with fake accounts). */
  referral: ReferralSettings;
}

// ---- Defaults --------------------------------------------------------------

/**
 * Recommended defaults: text actions free, image actions cost-derived. The
 * economy ships DISABLED so turning it on is a deliberate admin action.
 */
export function createDefaultSparksConfig(): SparksConfig {
  const actions: Record<string, ActionPricing> = {};
  for (const id of ALL_TEXT_ACTION_IDS) {
    actions[id] = { mode: "free", fixedSparks: 0, estimatedSparks: 0 };
  }
  for (const id of ALL_IMAGE_ACTION_IDS) {
    // ~5 Sparks at $0.02/Spark, 2.5× markup ≈ a $0.04 image; estimate covers it.
    actions[id] = { mode: "derived", fixedSparks: 5, estimatedSparks: 5 };
  }
  return {
    version: 1,
    enabled: false,
    sparkValueUsd: 0.02,
    markupMultiplier: 2.5,
    grants: { guestSparks: 40, signupBonusSparks: 60, verifyBonusSparks: 50 },
    maxNegativeSparks: 10,
    actions,
    packs: [
      { id: "small", label: "Small", sparks: 100, bonusSparks: 0, prices: { USD: 2.99, EUR: 2.99, GBP: 2.49 }, active: true, sortOrder: 0 },
      { id: "medium", label: "Medium", sparks: 300, bonusSparks: 30, prices: { USD: 7.99, EUR: 7.99, GBP: 6.99 }, active: true, sortOrder: 1 },
      { id: "large", label: "Large", sparks: 800, bonusSparks: 120, prices: { USD: 17.99, EUR: 17.99, GBP: 15.99 }, active: true, sortOrder: 2 },
    ],
    referral: { enabled: false, referrerSparks: 100, referredSparks: 50 },
  };
}

function coerceActionPricing(raw: unknown, fallback: ActionPricing): ActionPricing {
  const p = (raw ?? {}) as Partial<ActionPricing>;
  const mode: ActionPricingMode =
    p.mode === "free" || p.mode === "derived" || p.mode === "fixed" ? p.mode : fallback.mode;
  return {
    mode,
    fixedSparks: typeof p.fixedSparks === "number" && p.fixedSparks >= 0 ? p.fixedSparks : fallback.fixedSparks,
    estimatedSparks:
      typeof p.estimatedSparks === "number" && p.estimatedSparks >= 0 ? p.estimatedSparks : fallback.estimatedSparks,
  };
}

function nonNegative(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback;
}

/**
 * Coerce the grant ladder. Older docs stored a single `starterGrant` (granted
 * only to verified accounts) — map that entirely onto the verify rung so the
 * admin's configured total is preserved exactly.
 */
function normalizeGrants(p: Partial<SparksConfig>, def: GrantLadder): GrantLadder {
  const legacy = (p as { starterGrant?: unknown }).starterGrant;
  if (!p.grants && typeof legacy === "number" && legacy >= 0) {
    return { guestSparks: 0, signupBonusSparks: 0, verifyBonusSparks: legacy };
  }
  return {
    guestSparks: nonNegative(p.grants?.guestSparks, def.guestSparks),
    signupBonusSparks: nonNegative(p.grants?.signupBonusSparks, def.signupBonusSparks),
    verifyBonusSparks: nonNegative(p.grants?.verifyBonusSparks, def.verifyBonusSparks),
  };
}

/** The total free Sparks a fully verified account can earn from the ladder. */
export function totalGrantSparks(config: SparksConfig): number {
  const g = config.grants;
  return g.guestSparks + g.signupBonusSparks + g.verifyBonusSparks;
}

/** Merge a stored (possibly partial/older) doc onto the current defaults. */
export function normalizeSparksConfig(input: unknown): SparksConfig {
  const def = createDefaultSparksConfig();
  const p = (input ?? {}) as Partial<SparksConfig>;
  const actions: Record<string, ActionPricing> = {};
  // Keep the fixed key set authoritative (every known action always present).
  for (const id of Object.keys(def.actions)) {
    actions[id] = coerceActionPricing(p.actions?.[id], def.actions[id]);
  }
  const packs = Array.isArray(p.packs)
    ? p.packs.map((raw, i) => {
        const pk = (raw ?? {}) as Partial<SparkPack>;
        return {
          id: typeof pk.id === "string" && pk.id ? pk.id : `pack-${i}`,
          label: typeof pk.label === "string" ? pk.label : `Pack ${i + 1}`,
          sparks: typeof pk.sparks === "number" && pk.sparks >= 0 ? pk.sparks : 0,
          bonusSparks: typeof pk.bonusSparks === "number" && pk.bonusSparks >= 0 ? pk.bonusSparks : 0,
          prices: pk.prices && typeof pk.prices === "object" ? { ...pk.prices } : {},
          active: pk.active !== false,
          sortOrder: typeof pk.sortOrder === "number" ? pk.sortOrder : i,
        } satisfies SparkPack;
      })
    : def.packs;
  return {
    version: 1,
    enabled: p.enabled === true,
    sparkValueUsd: typeof p.sparkValueUsd === "number" && p.sparkValueUsd > 0 ? p.sparkValueUsd : def.sparkValueUsd,
    markupMultiplier:
      typeof p.markupMultiplier === "number" && p.markupMultiplier > 0 ? p.markupMultiplier : def.markupMultiplier,
    grants: normalizeGrants(p, def.grants),
    maxNegativeSparks:
      typeof p.maxNegativeSparks === "number" && p.maxNegativeSparks >= 0 ? p.maxNegativeSparks : def.maxNegativeSparks,
    actions,
    packs,
    referral: {
      enabled: p.referral?.enabled === true,
      referrerSparks:
        typeof p.referral?.referrerSparks === "number" && p.referral.referrerSparks >= 0
          ? p.referral.referrerSparks
          : def.referral.referrerSparks,
      referredSparks:
        typeof p.referral?.referredSparks === "number" && p.referral.referredSparks >= 0
          ? p.referral.referredSparks
          : def.referral.referredSparks,
    },
  };
}

// ---- Pricing calculator ----------------------------------------------------

const DEFAULT_ACTION: ActionPricing = { mode: "free", fixedSparks: 0, estimatedSparks: 0 };

function actionPricing(config: SparksConfig, action: string): ActionPricing {
  return config.actions[action] ?? DEFAULT_ACTION;
}

/** Whole Sparks for a USD amount at the configured peg + markup (min 1 if >0). */
export function sparksForCostUsd(config: SparksConfig, costUsd: number): number {
  if (costUsd <= 0 || config.sparkValueUsd <= 0) return 0;
  const raw = (costUsd * config.markupMultiplier) / config.sparkValueUsd;
  return Math.max(1, Math.ceil(raw));
}

/** A pre-flight Spark estimate expressed as a range (min == max when uniform). */
export interface SparkEstimateRange {
  minSparks: number;
  maxSparks: number;
}

export interface EstimateRangeInputs {
  /** Recent measured call costs (USD) for this action+tier, if any. */
  samples?: number[];
  /**
   * A nominal per-call cost (USD) from the model cost table, used as a fallback
   * when there's no recent history yet (e.g. a freshly configured model).
   */
  rateCostUsd?: number | null;
  /** Last-resort flat estimate (the action's configured `estimatedSparks`). */
  fallbackSparks: number;
}

/** Linear-interpolated quantile of a SORTED ascending array. */
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Derive a Spark estimate RANGE for an image action from its recent call costs,
 * falling back to the model's rate-table cost, then a flat estimate. Used for
 * the studio preview ("3–5 ✦") and — via {@link maxEstimateSparks} — the server
 * pre-flight reserve. Settlement still charges the exact measured cost.
 *
 * With 4+ samples the range is the p25–p75 band (a single outlier call must not
 * blow the displayed range or the pre-flight reserve up for the next 10 calls);
 * with fewer samples it's the raw min–max.
 */
export function estimateSparkRange(
  config: SparksConfig,
  { samples, rateCostUsd, fallbackSparks }: EstimateRangeInputs,
): SparkEstimateRange {
  const valid = (samples ?? [])
    .filter((n) => typeof n === "number" && Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  if (valid.length > 0) {
    const loUsd = valid.length >= 4 ? quantile(valid, 0.25) : valid[0];
    const hiUsd = valid.length >= 4 ? quantile(valid, 0.75) : valid[valid.length - 1];
    const min = sparksForCostUsd(config, loUsd);
    const max = sparksForCostUsd(config, hiUsd);
    return { minSparks: Math.min(min, max), maxSparks: Math.max(min, max) };
  }
  if (typeof rateCostUsd === "number" && rateCostUsd > 0) {
    const s = sparksForCostUsd(config, rateCostUsd);
    return { minSparks: s, maxSparks: s };
  }
  const flat = Math.max(0, Math.round(fallbackSparks));
  return { minSparks: flat, maxSparks: flat };
}

/** The upper bound of an estimate range (what the pre-flight reserve should use). */
export function maxEstimateSparks(range: SparkEstimateRange): number {
  return range.maxSparks;
}

/**
 * The Spark price for one action given the measured USD cost of the call.
 * Applies the per-action mode, then an optional per-plan multiplier (subscribers
 * can get certain actions discounted). Returns 0 when the economy is disabled.
 */
export function priceForAction(
  config: SparksConfig,
  action: string,
  costUsd: number,
  planMultiplier = 1,
): number {
  if (!config.enabled) return 0;
  const rule = actionPricing(config, action);
  let base: number;
  switch (rule.mode) {
    case "free":
      base = 0;
      break;
    case "fixed":
      base = Math.max(0, Math.round(rule.fixedSparks));
      break;
    case "derived":
    default:
      base = sparksForCostUsd(config, costUsd);
      break;
  }
  const m = planMultiplier > 0 ? planMultiplier : 1;
  return Math.max(0, Math.round(base * m));
}

/**
 * Sparks to RESERVE before an action whose cost isn't known yet. Free actions
 * reserve nothing; fixed actions reserve their flat price; derived actions
 * reserve the configured estimate (× plan multiplier).
 */
export function estimateForAction(config: SparksConfig, action: string, planMultiplier = 1): number {
  if (!config.enabled) return 0;
  const rule = actionPricing(config, action);
  const m = planMultiplier > 0 ? planMultiplier : 1;
  if (rule.mode === "free") return 0;
  if (rule.mode === "fixed") return Math.max(0, Math.round(rule.fixedSparks * m));
  return Math.max(0, Math.round(rule.estimatedSparks * m));
}

/** Total Sparks a pack delivers (base + bonus). */
export function packTotalSparks(pack: SparkPack): number {
  return pack.sparks + pack.bonusSparks;
}

/** Effective USD per Spark for a pack in a currency (for transparency / display). */
export function packPricePerSpark(pack: SparkPack, currency: string): number | null {
  const price = pack.prices[currency];
  const total = packTotalSparks(pack);
  if (typeof price !== "number" || total <= 0) return null;
  return Math.round((price / total) * 10000) / 10000;
}

// ---- Ledger ----------------------------------------------------------------

/**
 * One immutable entry in a user's Spark ledger (`users/{uid}/sparksLedger`). The
 * ledger is the audit trail; the cached `sparkBalance` on the profile doc is a
 * fast read derived from it. Amounts are signed: grants/purchases/refunds are
 * positive, spends negative.
 */
export type LedgerEntryType = "grant" | "spend" | "refund" | "purchase" | "adjust" | "expiry";

export interface SparksLedgerEntry {
  id: string;
  type: LedgerEntryType;
  /** Signed Spark delta. */
  amount: number;
  /** Balance immediately after applying this entry. */
  balanceAfter: number;
  /** Human/audit reason, e.g. an action id, "starter", "subscription", "pack". */
  reason: string;
  /** Optional external linkage for idempotency (invoiceId / paymentId / jobId). */
  ref?: string;
  at: number;
}

/** Coerce a stored ledger doc into a typed entry (tolerant of partial data). */
export function normalizeLedgerEntry(id: string, raw: unknown): SparksLedgerEntry {
  const d = (raw ?? {}) as Record<string, unknown>;
  const types: LedgerEntryType[] = ["grant", "spend", "refund", "purchase", "adjust", "expiry"];
  const type = (typeof d.type === "string" && (types as string[]).includes(d.type) ? d.type : "adjust") as LedgerEntryType;
  return {
    id,
    type,
    amount: typeof d.amount === "number" ? d.amount : 0,
    balanceAfter: typeof d.balanceAfter === "number" ? d.balanceAfter : 0,
    reason: typeof d.reason === "string" ? d.reason : "",
    ref: typeof d.ref === "string" ? d.ref : undefined,
    at: typeof d.at === "number" ? d.at : 0,
  };
}

// ---- Validation (used by the backend before persisting) --------------------

const actionPricingSchema = z.object({
  mode: z.enum(["free", "derived", "fixed"]),
  fixedSparks: z.number().min(0),
  estimatedSparks: z.number().min(0),
});

const sparkPackSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  sparks: z.number().min(0),
  bonusSparks: z.number().min(0),
  prices: z.record(z.string(), z.number().min(0)),
  active: z.boolean(),
  sortOrder: z.number(),
});

export const sparksConfigSchema = z.object({
  version: z.literal(1),
  enabled: z.boolean(),
  sparkValueUsd: z.number().positive(),
  markupMultiplier: z.number().positive(),
  grants: z.object({
    guestSparks: z.number().min(0),
    signupBonusSparks: z.number().min(0),
    verifyBonusSparks: z.number().min(0),
  }),
  maxNegativeSparks: z.number().min(0),
  actions: z.record(z.string(), actionPricingSchema),
  packs: z.array(sparkPackSchema),
  referral: z
    .object({
      enabled: z.boolean(),
      referrerSparks: z.number().min(0),
      referredSparks: z.number().min(0),
    })
    .optional(),
});
