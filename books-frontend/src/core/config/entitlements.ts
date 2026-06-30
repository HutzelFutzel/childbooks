/**
 * Entitlement enforcement engine — the single place that turns a plan's
 * {@link PlanEntitlements} (data the admin configures on each plan) into the
 * concrete "can the user do X?" answers the app enforces.
 *
 * Design: entitlements stay **data-driven** (configured per plan, never code
 * gates), and this module provides the pure predicates that read them. The
 * backend enforces the money-affecting ones (e.g. the print discount at
 * checkout); the client uses the same predicates to show/lock/upsell UI so both
 * sides always agree.
 *
 * Resolution is dependency-light on purpose: callers pass the resolved plan (or
 * the active price id + the public plans list) so this file never reaches into
 * stores, Firestore, or the network.
 */
import {
  findPublicPlanByPriceId,
  type PlanDefinition,
  type PlanEntitlements,
  type PublicPlan,
} from "./plans";

/** The "nothing unlocked" baseline used when no plan resolves. */
export const EMPTY_ENTITLEMENTS: PlanEntitlements = {
  printDiscountPct: 0,
  formats: [],
  layouts: [],
  fonts: [],
  features: [],
  removeWatermark: false,
  limits: {},
};

/** The entitlements of a resolved plan, or the empty baseline. */
export function planEntitlements(plan: PlanDefinition | null | undefined): PlanEntitlements {
  return plan?.entitlements ?? EMPTY_ENTITLEMENTS;
}

/**
 * Resolve the effective entitlements for a buyer from their active subscription
 * price id and the public plans list (which carries entitlements). Falls back to
 * the free plan, then to the empty baseline. Pure — safe on client or server.
 */
export function entitlementsForSubscription(
  activePriceId: string | null,
  publicPlans: PublicPlan[],
): PlanEntitlements {
  const plan =
    findPublicPlanByPriceId(publicPlans, activePriceId) ??
    publicPlans.find((p) => p.isFree) ??
    null;
  return plan?.entitlements ?? EMPTY_ENTITLEMENTS;
}

// ---- Concrete predicates ---------------------------------------------------

/**
 * The print discount to actually apply, in percent. Clamped to [0, breakEven] so
 * a subscriber benefit can never push an order below break-even (we'd lose money).
 * `breakEvenDiscountPct` comes from {@link computeMargin}.
 */
export function effectivePrintDiscountPct(
  entitlements: PlanEntitlements,
  breakEvenDiscountPct: number,
): number {
  const want = Math.max(0, Math.min(100, entitlements.printDiscountPct || 0));
  const cap = Math.max(0, Math.min(100, breakEvenDiscountPct || 0));
  return Math.min(want, cap);
}

/** Whether the plan removes the "Made with…" watermark from shared pages. */
export function canRemoveWatermark(entitlements: PlanEntitlements): boolean {
  return entitlements.removeWatermark === true;
}

/**
 * Whether a layout is available: always-free base layouts plus any premium
 * layout ids the plan unlocks via `entitlements.layouts`.
 */
export function layoutAllowed(
  entitlements: PlanEntitlements,
  layoutId: string,
  baseLayoutIds: readonly string[],
): boolean {
  return baseLayoutIds.includes(layoutId) || entitlements.layouts.includes(layoutId);
}

/**
 * Whether a font is available: always-free base fonts plus any the plan unlocks
 * via `entitlements.fonts`.
 */
export function fontAllowed(
  entitlements: PlanEntitlements,
  fontId: string,
  baseFontIds: readonly string[],
): boolean {
  return baseFontIds.includes(fontId) || entitlements.fonts.includes(fontId);
}

/** Whether the plan unlocks a generic future-proof feature key. */
export function hasFeature(entitlements: PlanEntitlements, featureKey: string): boolean {
  return entitlements.features.includes(featureKey);
}

/**
 * Resolve a usage quota's effective cap for a plan: the plan's per-quota limit
 * if set, else the registry `defaultLimit`. Returns `null` for **unlimited** (a
 * negative plan value also means unlimited), so callers skip enforcement.
 */
export function quotaLimit(
  entitlements: PlanEntitlements | null | undefined,
  quotaId: string,
  defaultLimit: number | null,
): number | null {
  const v = entitlements?.limits?.[quotaId];
  if (typeof v === "number" && Number.isFinite(v)) return v < 0 ? null : Math.trunc(v);
  return defaultLimit;
}
