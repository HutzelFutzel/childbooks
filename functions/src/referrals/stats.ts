/**
 * Referral funnel counters and the admin summary.
 *
 * Counters are per-day documents incremented with `FieldValue.increment` — the
 * same shape as `stats/starterGrants_{day}` — so the funnel survives instance
 * restarts and can be charted without scanning the invitation collection.
 *
 * Every write here is telemetry: it must never throw back into a payment or
 * invitation flow.
 */
import { FieldValue } from "firebase-admin/firestore";
import {
  emptyDayStats,
  normalizeDayStats,
  type HeldRewardView,
  type InviterStats,
  type ReferralDayStats,
  type ReferralStatsSummary,
} from "../../../books-frontend/src/core/config/referral";
import { recipientForUid } from "../email/service";
import {
  DAY_MS,
  INVITATIONS,
  REWARDS,
  STATS,
  dayKey,
  db,
  listRewardsByStatus,
  normalizeInvitation,
  normalizeReward,
} from "./store";

/** Counters that can be bumped. `rewardCost` is money, the rest are counts. */
export type StatField = Exclude<keyof ReferralDayStats, "day">;

export async function bumpStat(field: StatField, by = 1, at = Date.now()): Promise<void> {
  if (by === 0) return;
  try {
    const day = dayKey(at);
    await db()
      .doc(`${STATS}/${day}`)
      .set({ day, [field]: FieldValue.increment(by), updatedAt: Date.now() }, { merge: true });
  } catch {
    // telemetry only
  }
}

/** Today's payout total — the input to the daily budget breaker. */
export async function rewardCostToday(): Promise<number> {
  try {
    const snap = await db().doc(`${STATS}/${dayKey()}`).get();
    const v = snap.exists ? snap.get("rewardCost") : 0;
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  } catch {
    // Fail OPEN: a stats read failure must not silently freeze all payouts.
    return 0;
  }
}

function addInto(target: ReferralDayStats, src: ReferralDayStats): void {
  target.invitesSent += src.invitesSent;
  target.invitesAccepted += src.invitesAccepted;
  target.verified += src.verified;
  target.activated += src.activated;
  target.purchased += src.purchased;
  target.rewardsGranted += src.rewardsGranted;
  target.rewardCost += src.rewardCost;
  target.clawbacks += src.clawbacks;
}

/**
 * The admin dashboard's referral report: the daily series in range, its totals,
 * the top inviters, and how many payouts are waiting for a human.
 *
 * Inviter totals are assembled from the invitation + reward collections rather
 * than a per-user counter, because the interesting question ("who is farming
 * this?") needs sent/accepted/rewarded side by side.
 */
export async function referralStatsSummary(from: number, to: number): Promise<ReferralStatsSummary> {
  const series: ReferralDayStats[] = [];
  const totals = emptyDayStats("total");

  // Day docs are tiny and the range is bounded by the dashboard, so reading them
  // by id beats a range query plus its index.
  const days: string[] = [];
  for (let at = from; at <= to + DAY_MS; at += DAY_MS) {
    const key = dayKey(at);
    if (!days.includes(key)) days.push(key);
    if (days.length > 400) break;
  }
  const refs = days.map((d) => db().doc(`${STATS}/${d}`));
  const snaps = refs.length > 0 ? await db().getAll(...refs) : [];
  snaps.forEach((snap, i) => {
    const stats = normalizeDayStats(days[i], snap.exists ? snap.data() : undefined);
    series.push(stats);
    addInto(totals, stats);
  });

  const [inviters, held] = await Promise.all([topInviters(from, to), heldRewards()]);

  return { from, to, totals, series, topInviters: inviters, pendingReview: held.length, held };
}

/**
 * Every payout waiting on a human, oldest first. Not date-filtered: a reward
 * held two months ago is exactly the one most in need of a decision.
 */
async function heldRewards(): Promise<HeldRewardView[]> {
  try {
    // `pending` is a claim whose delivery never finished — stuck for the same
    // reason as an explicit hold, and released the same way.
    const [review, stuck] = await Promise.all([
      listRewardsByStatus("review", MAX_HELD),
      listRewardsByStatus("pending", MAX_HELD),
    ]);
    const rows = [...review, ...stuck]
      // A `pending` reward is normal for the second or two between claim and
      // delivery; only one that stayed that way is actually stuck.
      .filter((r) => r.status !== "pending" || Date.now() - r.createdAt > STUCK_AFTER_MS)
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, MAX_HELD);
    return await Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        uid: r.uid,
        email: (await recipientForUid(r.uid)).email,
        side: r.side,
        status: r.status,
        summary: r.summary,
        unlocks: r.unlocks,
        cost: Math.round(r.cost * 100) / 100,
        at: r.createdAt,
        note: r.note,
        invitationId: r.invitationId,
      })),
    );
  } catch {
    return [];
  }
}

const MAX_HELD = 100;

/** How long a claimed-but-undelivered reward has to sit before it counts as stuck. */
const STUCK_AFTER_MS = 5 * 60_000;

const MAX_SCAN = 1000;

async function topInviters(from: number, to: number): Promise<InviterStats[]> {
  try {
    const invitations = await db().collection(INVITATIONS).limit(MAX_SCAN).get();
    const byUid = new Map<string, InviterStats>();
    const invitationOwner = new Map<string, string>();
    for (const doc of invitations.docs) {
      const inv = normalizeInvitation(doc.id, doc.data());
      if (inv.createdAt < from || inv.createdAt > to) continue;
      invitationOwner.set(inv.id, inv.inviterUid);
      const row =
        byUid.get(inv.inviterUid) ??
        { uid: inv.inviterUid, email: null, sent: 0, accepted: 0, rewarded: 0, cost: 0, needsReview: false };
      if (inv.channel === "email") row.sent += 1;
      if (inv.acceptedBy) row.accepted += 1;
      byUid.set(inv.inviterUid, row);
    }

    const rewards = await db().collection(REWARDS).where("side", "==", "referrer").limit(MAX_SCAN).get();
    for (const doc of rewards.docs) {
      const reward = normalizeReward(doc.id, doc.data());
      const row = byUid.get(reward.uid);
      if (!row) continue;
      if (reward.status === "granted") {
        row.rewarded += 1;
        row.cost += reward.cost;
      }
      if (reward.status === "review") row.needsReview = true;
    }

    const top = [...byUid.values()].sort((a, b) => b.accepted - a.accepted || b.sent - a.sent).slice(0, 20);
    // Resolve display emails only for the handful actually shown.
    await Promise.all(
      top.map(async (row) => {
        row.cost = Math.round(row.cost * 100) / 100;
        row.email = (await recipientForUid(row.uid)).email;
      }),
    );
    return top;
  } catch {
    return [];
  }
}

