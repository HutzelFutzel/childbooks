/**
 * Gateable feature registry + the data-driven gating rule.
 *
 * A "feature" is a premium capability an admin can attach to plans via
 * `entitlements.features` (a list of ids from this registry, edited as
 * checkboxes in the admin Plans tab). The gating rule is purely data-driven —
 * no code gates, fully admin-configurable:
 *
 *   - A feature listed on NO active plan is ungated: everyone can use it.
 *   - Once a feature appears on at least one ACTIVE plan, it becomes gated:
 *     only users whose resolved plan (including the free plan, if the admin
 *     lists it there) carries the id may use it.
 *
 * So the admin turns gating on by adding the feature to the paid plan(s) that
 * should include it, and turns it back off for everyone by removing it from
 * every plan. The same predicates run on the client (show/lock/upsell UI) and
 * the backend (enforcement), so both sides always agree.
 */
import { entitlementsForSubscription } from "./entitlements";
import type { PlanEntitlements, PlanStatus, PublicPlan } from "./plans";

export interface FeatureDefinition {
  id: string;
  label: string;
  description: string;
}

/** Every capability an admin can gate behind plans. Add new ones here. */
export const FEATURES: FeatureDefinition[] = [
  {
    id: "customArtStyle",
    label: "Custom art style",
    description:
      "Free-text creative style directions in the setup wizard (on top of — or instead of — the preset styles).",
  },
  {
    id: "characterTransfer",
    label: "Character transfer",
    description:
      "Import characters, places and objects (with their reference art) from another of the user's projects.",
  },
];

export function featureById(id: string): FeatureDefinition | undefined {
  return FEATURES.find((f) => f.id === id);
}

/** The minimal plan shape the gating rule needs (works for both PlanDefinition and PublicPlan). */
export interface GateablePlan {
  status: PlanStatus;
  entitlements: PlanEntitlements;
}

/**
 * Whether a feature is currently gated at all: true once ANY active plan lists
 * it. Listed on no active plan ⇒ free for everyone.
 */
export function featureGated(plans: readonly GateablePlan[], featureId: string): boolean {
  return plans.some((p) => p.status === "active" && p.entitlements.features.includes(featureId));
}

/**
 * Whether entitlements grant a (possibly gated) feature. Callers resolve the
 * user's effective entitlements first (see {@link entitlementsForSubscription}).
 */
export function featureAllowed(
  plans: readonly GateablePlan[],
  entitlements: PlanEntitlements,
  featureId: string,
): boolean {
  if (!featureGated(plans, featureId)) return true;
  return entitlements.features.includes(featureId);
}

/**
 * Convenience: resolve a buyer's feature access from their active subscription
 * price id + the public plans list (falls back to the free plan's entitlements).
 */
export function featureAllowedForSubscription(
  publicPlans: PublicPlan[],
  activePriceId: string | null,
  featureId: string,
): boolean {
  const entitlements = entitlementsForSubscription(activePriceId, publicPlans);
  return featureAllowed(publicPlans, entitlements, featureId);
}
