/**
 * Full reconcile of the Rewardful account into the local mirror.
 *
 * Webhooks are the fast path but they're unsigned, retried for only three days,
 * and easy to mis-subscribe in the dashboard. This sweep is the truth: it pulls
 * every campaign, affiliate, commission and payout and rewrites the mirror from
 * scratch, so a missed delivery self-heals within a day.
 *
 * It also closes the loop webhooks can't: anything present locally but absent
 * upstream is tombstoned, which is the only way a commission deleted inside
 * Rewardful ever stops counting as a cost.
 */
import { getFirestore } from "firebase-admin/firestore";
import { ensureAdmin } from "../storage";
import { emptySyncStatus, type AffiliateSyncStatus } from "../../../books-frontend/src/core/config/affiliates";
import {
  listAffiliates,
  listCampaigns,
  listCommissions,
  listPayouts,
  rewardfulConfigured,
  RewardfulNotConfiguredError,
} from "./api";
import {
  CAMPAIGNS_COLLECTION,
  COMMISSIONS_COLLECTION,
  markCommissionDeleted,
  markMirrorDeleted,
  mirrorCampaign,
  mirrorCommission,
  mirrorPartner,
  mirrorPayout,
  PARTNERS_COLLECTION,
  PAYOUTS_COLLECTION,
  readSyncStatus,
  writeSyncStatus,
} from "./mirror";

/**
 * How many mirror writes run at once. Each one does a couple of Firestore reads
 * (the payment join) plus a write; a handful in flight keeps a few hundred
 * commissions well inside a scheduled function's budget without stampeding.
 */
const CONCURRENCY = 5;

/** Cap on tombstones per run — a safety valve, not an expected code path. */
const MAX_TOMBSTONES = 500;

async function mapLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      try {
        await fn(item);
      } catch (err) {
        // One bad record must not abandon the rest of the sweep.
        console.warn("[affiliates] mirror write failed", err);
      }
    }
  });
  await Promise.all(workers);
}

/**
 * Tombstone rows the upstream account no longer has. Recognised by a `syncedAt`
 * older than this run: everything still upstream was just rewritten.
 *
 * Only ever called after a CLEAN full pass that actually returned data — a
 * partial fetch must not be mistaken for a mass deletion.
 */
async function tombstoneMissing(collection: string, runStartedAt: number): Promise<number> {
  ensureAdmin();
  const stale = await getFirestore()
    .collection(collection)
    .where("syncedAt", "<", runStartedAt)
    .limit(MAX_TOMBSTONES)
    .get();
  let count = 0;
  for (const doc of stale.docs) {
    if (doc.get("deletedAt")) continue;
    if (collection === COMMISSIONS_COLLECTION) await markCommissionDeleted(doc.id);
    else await markMirrorDeleted(collection, doc.id);
    count++;
  }
  return count;
}

export interface ReconcileOptions {
  /**
   * Skip the tombstone pass. Used by the manual admin sync, where the point is
   * usually "pick up what the webhook missed" and a surprise mass-tombstone from
   * a half-finished fetch would be the worst possible outcome of pressing a
   * button.
   */
  skipTombstones?: boolean;
}

/**
 * Pull everything and rewrite the mirror. Returns the status it also persists, so
 * the caller (schedule or admin route) can report without a second read.
 */
export async function reconcileAffiliates(opts: ReconcileOptions = {}): Promise<AffiliateSyncStatus> {
  if (!rewardfulConfigured()) throw new RewardfulNotConfiguredError();
  ensureAdmin();

  const startedAt = Date.now();
  const previous = await readSyncStatus();
  const status: AffiliateSyncStatus = { ...emptySyncStatus(), ...previous, lastRunAt: startedAt };

  try {
    // Sequential fetches, deliberately: 45 requests per 30 seconds is the whole
    // budget, and four list endpoints paged in parallel is how you spend it.
    const campaigns = await listCampaigns();
    const partners = await listAffiliates();
    const commissions = await listCommissions();
    const payouts = await listPayouts();

    await mapLimited(campaigns, CONCURRENCY, async (c) => void (await mirrorCampaign(c)));
    await mapLimited(partners, CONCURRENCY, async (a) => void (await mirrorPartner(a)));

    let scopeViolations = 0;
    await mapLimited(commissions, CONCURRENCY, async (c) => {
      const doc = await mirrorCommission(c);
      if (doc?.inScope === false && doc.state !== "voided") scopeViolations++;
    });
    await mapLimited(payouts, CONCURRENCY, async (p) => void (await mirrorPayout(p)));

    if (!opts.skipTombstones) {
      // Guarded on a non-empty pull: an account that legitimately returns nothing
      // is indistinguishable from a fetch that silently failed, and the wrong
      // guess tombstones the entire mirror.
      if (campaigns.length > 0) await tombstoneMissing(CAMPAIGNS_COLLECTION, startedAt);
      if (partners.length > 0) await tombstoneMissing(PARTNERS_COLLECTION, startedAt);
      if (commissions.length > 0) await tombstoneMissing(COMMISSIONS_COLLECTION, startedAt);
      if (payouts.length > 0) await tombstoneMissing(PAYOUTS_COLLECTION, startedAt);
    }

    status.campaigns = campaigns.length;
    status.partners = partners.length;
    status.commissions = commissions.length;
    status.payouts = payouts.length;
    status.scopeViolations = scopeViolations;
    status.lastOkAt = Date.now();
    status.lastError = null;
    status.durationMs = Date.now() - startedAt;
    await writeSyncStatus(status);
    return status;
  } catch (err) {
    status.lastError = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    status.durationMs = Date.now() - startedAt;
    await writeSyncStatus(status);
    throw err;
  }
}
