/**
 * Live subscription state for the signed-in user (mirrors
 * `users/{uid}/subscriptions`). Drives the "current plan" indicator and the
 * Manage-subscription entry point. Watch for full accounts, stop on sign-out.
 */
import { create } from "zustand";
import type { Unsubscribe } from "firebase/firestore";
import {
  activeSubscription,
  subscribeUserSubscriptions,
  type UserSubscription,
} from "../platform/subscriptions";
import {
  findPublicPlanByPriceId,
  planActionMultiplier,
  type PublicPlan,
} from "../core/config/plans";
import { featureAllowedForSubscription } from "../core/config/features";
import { useAppConfigStore } from "./appConfigStore";

interface SubscriptionState {
  subscriptions: UserSubscription[];
  loading: boolean;
  unsub: Unsubscribe | null;
  watch: () => void;
  stop: () => void;
  /** The current benefit-providing subscription, or null. */
  active: () => UserSubscription | null;
}

export const useSubscriptionStore = create<SubscriptionState>((set, get) => ({
  subscriptions: [],
  loading: false,
  unsub: null,

  watch() {
    if (get().unsub) return;
    set({ loading: true });
    const unsub = subscribeUserSubscriptions((subscriptions) => set({ subscriptions, loading: false }));
    set({ unsub });
  },

  stop() {
    get().unsub?.();
    set({ subscriptions: [], loading: false, unsub: null });
  },

  active() {
    return activeSubscription(get().subscriptions);
  },
}));

/**
 * The signed-in user's current PUBLIC plan (their active subscription's plan,
 * else null — i.e. the free baseline). Non-hook so pure estimate helpers can
 * use it; components should select the stores they need for reactivity.
 */
export function currentPublicPlan(): PublicPlan | null {
  const sub = activeSubscription(useSubscriptionStore.getState().subscriptions);
  if (!sub) return null;
  return findPublicPlanByPriceId(useAppConfigStore.getState().plans.plans, sub.priceId);
}

/**
 * The Spark price multiplier the user's plan applies to an action (mirrors the
 * server's `actionMultiplier`; 1 for free accounts / unset actions).
 */
export function currentActionMultiplier(action: string): number {
  return planActionMultiplier(currentPublicPlan(), action);
}

/** Reactive version of {@link currentActionMultiplier} for components. */
export function usePlanActionMultiplier(action: string): number {
  const subscriptions = useSubscriptionStore((s) => s.subscriptions);
  const plans = useAppConfigStore((s) => s.plans.plans);
  const sub = activeSubscription(subscriptions);
  const plan = sub ? findPublicPlanByPriceId(plans, sub.priceId) : null;
  return planActionMultiplier(plan, action);
}

/**
 * Whether the signed-in user may use a gateable feature (see
 * `core/config/features`). Ungated features (listed on no active plan) are
 * allowed for everyone. Non-hook version for imperative call sites.
 */
export function currentFeatureAllowed(featureId: string): boolean {
  const sub = activeSubscription(useSubscriptionStore.getState().subscriptions);
  const plans = useAppConfigStore.getState().plans.plans;
  return featureAllowedForSubscription(plans, sub?.priceId ?? null, featureId);
}

/** Reactive version of {@link currentFeatureAllowed} for components. */
export function useFeatureAllowed(featureId: string): boolean {
  const subscriptions = useSubscriptionStore((s) => s.subscriptions);
  const plans = useAppConfigStore((s) => s.plans.plans);
  const sub = activeSubscription(subscriptions);
  return featureAllowedForSubscription(plans, sub?.priceId ?? null, featureId);
}
