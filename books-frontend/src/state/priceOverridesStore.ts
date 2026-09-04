/**
 * The standing campaign price overrides that apply to the signed-in caller.
 *
 * Everything else a Spark estimate needs is world-readable config the client
 * already subscribes to (`appConfig/sparks`, the public cost table, the recent
 * cost window, the plan's own multiplier). Campaign overrides are the one input
 * that can't be: eligibility is decided against account facts the client never
 * sees, so the number has to come from the server that will also charge for it.
 *
 * Fetched once per identity and refreshed lazily — a campaign's start/end is a
 * calendar event, not a live feed, and a quote that lags a promotion by one
 * page load is far cheaper than polling every studio session.
 */
import { create } from "zustand";
import { fetchPriceOverrides, type ActionPriceOverride } from "../platform/pricing";
import type { ImageActionId } from "../core/ai/actions";
import type { ImageTier } from "../core/config/modelConfig";

/** How long a fetched set of overrides is trusted before the next refetch. */
const TTL_MS = 5 * 60_000;

interface PriceOverridesState {
  actions: Partial<Record<ImageActionId, ActionPriceOverride>>;
  fetchedAt: number;
  loading: boolean;
  /**
   * Bumped by every {@link PriceOverridesState.reset}. A response from before
   * the bump is discarded, so an in-flight fetch for the previous identity can't
   * land as the current one's prices.
   */
  generation: number;
  /** Fetch the caller's overrides (no-op while fresh or already in flight). */
  load: () => void;
  /** Drop everything on sign-out so one identity's promo can't price another's. */
  reset: () => void;
}

export const usePriceOverridesStore = create<PriceOverridesState>((set, get) => ({
  actions: {},
  fetchedAt: 0,
  loading: false,
  generation: 0,

  load() {
    const { fetchedAt, loading, generation } = get();
    if (loading || (fetchedAt > 0 && Date.now() - fetchedAt < TTL_MS)) return;
    set({ loading: true });
    void fetchPriceOverrides()
      // Soft-fail to "no overrides": showing the normal price is the safe
      // direction, and a price preview must never block generation.
      .catch(() => ({}) as Partial<Record<ImageActionId, ActionPriceOverride>>)
      .then((actions) => {
        if (get().generation !== generation) return;
        set({ actions, fetchedAt: Date.now(), loading: false });
      });
  },

  reset() {
    set({
      actions: {},
      fetchedAt: 0,
      loading: false,
      generation: get().generation + 1,
    });
  },
}));

/** The campaign multiplier for one action+tier (1 when no promotion applies). */
export function campaignMultiplierFor(
  overrides: Partial<Record<ImageActionId, ActionPriceOverride>>,
  action: ImageActionId,
  tier: ImageTier,
): number {
  const m = overrides[action]?.tiers?.[tier];
  return typeof m === "number" && m >= 0 ? m : 1;
}

/** Reactive campaign multiplier for one action+tier. */
export function useCampaignMultiplier(action: ImageActionId, tier: ImageTier): number {
  return usePriceOverridesStore((s) => campaignMultiplierFor(s.actions, action, tier));
}

/**
 * The campaign to name next to a discounted price, or null at full price. An
 * unexplained discount reads as a bug; a labelled one reads as a gift.
 */
export function useCampaignPriceNote(
  action: ImageActionId,
): { campaignId: string; label: string } | null {
  return usePriceOverridesStore((s) => s.actions[action]?.note ?? null);
}
