import type { OrderStage } from "./types";

/** Stages a print job never leaves: a shipped book can't be un-shipped. */
const FINAL_STAGES: ReadonlySet<OrderStage> = new Set<OrderStage>(["complete", "cancelled"]);

/**
 * Why a status update for a job is older news than what's on record, or null
 * when it should be applied.
 *
 * Webhooks are delivered at least once and in no promised order, and the poll
 * races them. Applying whatever arrives last can move a shipped order back to
 * "in production" — or, with a stale rejection, place a second print job for a
 * book that has already shipped.
 */
export function staleStatusReason(
  current: { stage?: string | null; changedAt?: number | null },
  incoming: { stage: OrderStage; changedAt?: number | null },
): string | null {
  const stage = current.stage as OrderStage | undefined;
  if (stage && FINAL_STAGES.has(stage) && incoming.stage !== stage) {
    return `the job is already ${stage === "complete" ? "shipped" : "canceled"}`;
  }
  if (current.changedAt != null && incoming.changedAt != null && incoming.changedAt < current.changedAt) {
    return "an older status than the one on record";
  }
  return null;
}
