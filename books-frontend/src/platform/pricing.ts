/**
 * Client access to the caller's standing campaign price overrides (`/ai/price-
 * overrides`).
 *
 * Campaign eligibility is evaluated against account facts the browser can't
 * read, so the multiplier that will actually be charged has to be asked for. The
 * server answers with the same evaluator `settleActionCost` prices against, so
 * the studio's quote and the wallet's charge come from one source.
 */
import { backendFetch } from "./backend";
import type { ImageActionId } from "../core/ai/actions";
import type { ImageTier } from "../core/config/modelConfig";

/** What a standing campaign does to one action's price, across both tiers. */
export interface ActionPriceOverride {
  /** Campaign multiplier per tier (1 = untouched, 0 = free). */
  tiers: Partial<Record<ImageTier, number>>;
  /** The campaign responsible for the best discount, when any. */
  note: { campaignId: string; label: string } | null;
}

interface PriceOverridesResponse {
  actions?: Partial<Record<ImageActionId, ActionPriceOverride>>;
}

/**
 * The signed-in caller's active price overrides. Resolves to an empty map on
 * any failure — a missing promotion shows the normal price, which is the only
 * safe direction for a number the user is about to be charged.
 */
export async function fetchPriceOverrides(): Promise<
  Partial<Record<ImageActionId, ActionPriceOverride>>
> {
  const res = await backendFetch("/ai/price-overrides");
  if (!res.ok) return {};
  const body = (await res.json()) as PriceOverridesResponse;
  return body.actions ?? {};
}
