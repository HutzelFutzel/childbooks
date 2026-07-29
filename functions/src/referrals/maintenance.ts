/**
 * The invitation janitor: one nudge for invitations nobody acted on, and an
 * honest status for the ones that ran out of time.
 *
 * Both jobs exist because an invitation is a promise with a clock on it. Without
 * the reminder, the single biggest drop-off in the funnel is an invitation that
 * was simply forgotten in an inbox; without the expiry sweep, the invite screen
 * shows "pending" forever for invitations that can no longer be accepted, which
 * is worse than saying nothing.
 *
 * Exactly ONE reminder is ever sent (`remindersSent` is the guard, and the email
 * layer dedupes on the invitation id as a second line of defence). Anything more
 * turns an invitation into a drip campaign to someone who never asked to hear
 * from us at all.
 */
import { getAuth } from "firebase-admin/auth";
import { sendReferralReminderEmail } from "../email/triggers";
import { declineUrlFor, shareUrlFor } from "./invitations";
import { DAY_MS, INVITATIONS, db, normalizeInvitation, type InvitationDoc } from "./store";

/** How long an invitation sits untouched before the single reminder goes out. */
const REMIND_AFTER_MS = 3 * DAY_MS;

/**
 * Don't remind when the invitation is about to expire anyway — a nudge that
 * arrives with hours left to act on it is just noise.
 */
const MIN_REMAINING_MS = 2 * DAY_MS;

/** Bounded per run: this is a sweep, not a mail campaign. */
const MAX_PER_RUN = 100;

export interface SweepResult {
  reminded: number;
  expired: number;
}

/**
 * Nudge and expire in one pass over the pending invitations. Never throws — it
 * runs on a schedule, and a single bad document must not stop the rest.
 */
export async function sweepInvitations(): Promise<SweepResult> {
  const result: SweepResult = { reminded: 0, expired: 0 };
  const now = Date.now();

  const snap = await db()
    .collection(INVITATIONS)
    .where("status", "==", "pending")
    .limit(MAX_PER_RUN * 4)
    .get();

  for (const doc of snap.docs) {
    const invitation = normalizeInvitation(doc.id, doc.data());
    try {
      if (invitation.expiresAt > 0 && now > invitation.expiresAt) {
        await db().doc(`${INVITATIONS}/${invitation.id}`).set({ status: "expired" }, { merge: true });
        result.expired += 1;
        continue;
      }
      if (result.reminded >= MAX_PER_RUN) continue;
      if (!shouldRemind(invitation, now)) continue;
      if (await remind(invitation)) result.reminded += 1;
    } catch (err) {
      console.warn("[referrals] sweep skipped an invitation", invitation.id, err);
    }
  }
  return result;
}

function shouldRemind(invitation: InvitationDoc, now: number): boolean {
  if (invitation.channel !== "email" || !invitation.recipientEmail) return false;
  if (invitation.remindersSent > 0) return false;
  if (now - invitation.createdAt < REMIND_AFTER_MS) return false;
  if (invitation.expiresAt > 0 && invitation.expiresAt - now < MIN_REMAINING_MS) return false;
  return true;
}

async function remind(invitation: InvitationDoc): Promise<boolean> {
  const inviter = await getAuth().getUser(invitation.inviterUid).catch(() => null);
  // The counter is bumped BEFORE sending: a double-send is a compliance problem,
  // a missed reminder is not.
  await db().doc(`${INVITATIONS}/${invitation.id}`).set({ remindersSent: 1 }, { merge: true });
  return await sendReferralReminderEmail({
    to: invitation.recipientEmail!,
    inviterName: inviter?.displayName ?? null,
    // The FROZEN promise, not today's config — this is the same invitation.
    benefit: invitation.terms.referredSummary,
    acceptUrl: await shareUrlFor(invitation.code),
    declineUrl: await declineUrlFor(invitation.code),
    expiresOn: invitation.expiresAt > 0 ? formatDate(invitation.expiresAt) : null,
    invitationId: invitation.id,
  });
}

function formatDate(at: number): string {
  return new Date(at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/**
 * Emergency kill for a misconfigured offer: void every still-unaccepted invitation
 * so the frozen terms stop being claimable. Accepted invitations are never touched
 * — clawing those back costs more in trust than the rewards are worth.
 */
export async function voidUnacceptedInvitations(reason = "voided by admin"): Promise<number> {
  const snap = await db()
    .collection(INVITATIONS)
    .where("status", "==", "pending")
    .limit(500)
    .get();
  let count = 0;
  const batchSize = 400;
  let batch = db().batch();
  let inBatch = 0;
  for (const doc of snap.docs) {
    batch.set(doc.ref, { status: "void", voidReason: reason.slice(0, 200), voidedAt: Date.now() }, { merge: true });
    count += 1;
    inBatch += 1;
    if (inBatch >= batchSize) {
      await batch.commit();
      batch = db().batch();
      inBatch = 0;
    }
  }
  if (inBatch > 0) await batch.commit();
  return count;
}
