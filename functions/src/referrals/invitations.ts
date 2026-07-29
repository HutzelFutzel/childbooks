/**
 * The invitation lifecycle: minting a personal share code, sending emailed
 * invitations, accepting one, and declining one.
 *
 * The link and the emailed invite are the same mechanism with different freezing
 * points, which is the one subtlety worth internalizing:
 *
 *   - An **emailed invitation** is person-specific the moment it's sent, so its
 *     terms freeze then. One code, one recipient, one invitation document.
 *   - A **personal link** is shared with an unknown number of people, so its code
 *     resolves to the inviter only, and each acceptance mints its own invitation
 *     document with terms frozen at that moment. That keeps "one invitation = one
 *     referral" true for both channels, which is what makes the funnel counters
 *     and the payout idempotency work at all.
 *
 * Abuse controls, in the order they bite: the sender must qualify (verified, and
 * optionally a paying customer), sends are rate-limited per day and per month,
 * an address that declined is never contacted again, and an address someone else
 * invited recently isn't invited a second time.
 */
import { FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getReferralConfig, getSeoConfig } from "../appConfig";
import {
  freezeTerms,
  inviteTeaser,
  summarizeSide,
  type ReferralConfig,
  type ReferralTerms,
} from "../../../books-frontend/src/core/config/referral";
import {
  sendReferralAcceptedEmail,
  sendReferralInviteEmail,
  sendReferralInviteSentEmail,
} from "../email/triggers";
import { notifySlack } from "../notify";
import { onReferralEvent } from "./events";
import { bumpStat } from "./stats";
import {
  CODES,
  COUNTERS,
  DAY_MS,
  INVITATIONS,
  INVITE_INDEX,
  SUPPRESSION,
  dayKey,
  db,
  getInvitation,
  hashEmail,
  isAlreadyExists,
  looksLikeEmail,
  monthKey,
  newCode,
  newInvitationId,
  normalizeCode,
  normalizeEmail,
  normalizeInvitation,
  resolveCode,
  type InvitationDoc,
} from "./store";

/** Don't invite an address a DIFFERENT user already invited this recently. */
const REINVITE_COOLDOWN_MS = 30 * DAY_MS;

// ---- The personal share code -------------------------------------------------

/**
 * The caller's evergreen share code, minted on first use. Retries on collision;
 * the code space makes that essentially theoretical.
 */
export async function ensureReferralCode(uid: string): Promise<string> {
  const userRef = db().doc(`users/${uid}`);
  const snap = await userRef.get();
  const existing = snap.exists ? (snap.get("referralCode") as string | undefined) : undefined;
  if (existing) return existing;

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newCode();
    try {
      await db().doc(`${CODES}/${code}`).create({ inviterUid: uid, invitationId: null, at: Date.now() });
      await userRef.set({ referralCode: code }, { merge: true });
      return code;
    } catch (err) {
      if (!isAlreadyExists(err)) throw err;
    }
  }
  throw new Error("Could not mint a referral code.");
}

/** The absolute link that carries a code into the studio. */
export async function shareUrlFor(code: string): Promise<string> {
  const seo = await getSeoConfig();
  const base = (seo.siteUrl || "https://childbook.studio").replace(/\/$/, "");
  return `${base}/studio?ref=${encodeURIComponent(code)}`;
}

/** The tokenless link that suppresses an address for good. */
export async function declineUrlFor(code: string): Promise<string> {
  const seo = await getSeoConfig();
  const base = (seo.siteUrl || "https://childbook.studio").replace(/\/$/, "");
  return `${base}/invite/decline?code=${encodeURIComponent(code)}`;
}

// ---- Sending -----------------------------------------------------------------

export type SendOutcome =
  | "sent"
  | "invalid"
  | "self"
  | "already_member"
  | "recently_invited"
  | "declined"
  | "limit"
  | "failed";

export interface SendResult {
  email: string;
  outcome: SendOutcome;
}

export interface EligibilityVerdict {
  canInvite: boolean;
  reason: string | null;
}

/** Whether this account may send invitations at all. */
export async function checkEligibility(
  uid: string,
  config: ReferralConfig,
  opts: { emailVerified: boolean },
): Promise<EligibilityVerdict> {
  if (!config.enabled) {
    return { canInvite: false, reason: "Invitations aren't available right now." };
  }
  if (config.eligibility.senderMustBeVerified && !opts.emailVerified) {
    return { canInvite: false, reason: "Please confirm your email address first — then you can invite friends." };
  }
  if (config.eligibility.senderMustHavePurchased && !(await hasPurchased(uid))) {
    return {
      canInvite: false,
      reason: "Invitations unlock after your first order. Your personal link keeps working in the meantime.",
    };
  }
  return { canInvite: true, reason: null };
}

async function hasPurchased(uid: string): Promise<boolean> {
  try {
    const snap = await db().collection(`users/${uid}/payments`).where("status", "==", "paid").limit(1).get();
    return !snap.empty;
  } catch {
    return false;
  }
}

/** How many emailed invitations this user has left today. */
export async function invitesLeftToday(uid: string, config: ReferralConfig): Promise<number> {
  const used = await counterValue(uid, dayKey());
  return Math.max(0, config.limits.invitesPerUserPerDay - used);
}

async function counterValue(uid: string, key: string): Promise<number> {
  try {
    const snap = await db().doc(`${COUNTERS}/${uid}_${key}`).get();
    const v = snap.exists ? snap.get("count") : 0;
    return typeof v === "number" ? v : 0;
  } catch {
    return 0;
  }
}

async function bumpCounter(uid: string, key: string): Promise<void> {
  await db()
    .doc(`${COUNTERS}/${uid}_${key}`)
    .set({ count: FieldValue.increment(1), at: Date.now() }, { merge: true });
}

const MAX_PER_REQUEST = 10;

/**
 * Send emailed invitations. Returns one outcome per address — including the
 * honest ones ("already a member", "someone invited them recently"), because
 * silently swallowing those trains people to send the same invite again and
 * again. The per-day and per-month caps are what keep that honesty from being
 * an address-enumeration oracle.
 */
export async function sendInvitations(
  uid: string,
  emails: string[],
  message: string | null,
): Promise<{ results: SendResult[]; invitesLeftToday: number }> {
  const config = await getReferralConfig();
  const auth = await getAuth().getUser(uid).catch(() => null);
  const verdict = await checkEligibility(uid, config, { emailVerified: auth?.emailVerified === true });
  if (!verdict.canInvite) {
    return {
      results: emails.slice(0, MAX_PER_REQUEST).map((email) => ({ email: normalizeEmail(email), outcome: "limit" })),
      invitesLeftToday: 0,
    };
  }

  const [dayUsed, monthUsed] = await Promise.all([counterValue(uid, dayKey()), counterValue(uid, monthKey())]);
  let dayBudget = Math.max(0, config.limits.invitesPerUserPerDay - dayUsed);
  const monthBudget = Math.max(0, config.limits.invitesPerUserPerMonth - monthUsed);
  let budget = Math.min(dayBudget, monthBudget);

  const terms = freezeTerms(config);
  const code = await ensureReferralCode(uid);
  const inviteUrl = await shareUrlFor(code);
  const inviterName = auth?.displayName ?? null;
  const ownEmail = auth?.email ? normalizeEmail(auth.email) : null;
  const seen = new Set<string>();
  const results: SendResult[] = [];

  for (const raw of emails.slice(0, MAX_PER_REQUEST)) {
    const email = normalizeEmail(raw);
    if (!looksLikeEmail(email) || seen.has(email)) {
      results.push({ email, outcome: "invalid" });
      continue;
    }
    seen.add(email);
    if (email === ownEmail) {
      results.push({ email, outcome: "self" });
      continue;
    }
    if (budget <= 0) {
      results.push({ email, outcome: "limit" });
      continue;
    }

    const { outcome, invitationId } = await sendOne({ uid, email, terms, config, inviterName, message });
    results.push({ email, outcome });
    if (outcome === "sent" && invitationId) {
      budget -= 1;
      dayBudget -= 1;
      await Promise.all([bumpCounter(uid, dayKey()), bumpCounter(uid, monthKey()), bumpStat("invitesSent")]);
      await sendReferralInviteSentEmail({
        uid,
        recipientEmail: email,
        benefit: terms.referrerSummary || inviteTeaser(terms),
        inviteUrl,
        invitationId,
      });
    }
  }

  return { results, invitesLeftToday: Math.max(0, dayBudget) };
}

async function sendOne(args: {
  uid: string;
  email: string;
  terms: ReferralTerms;
  config: ReferralConfig;
  inviterName: string | null;
  message: string | null;
}): Promise<{ outcome: SendOutcome; invitationId?: string }> {
  const { uid, email, terms, config } = args;
  const emailHash = hashEmail(email);

  // Declined once = never again. Checked before anything else, because this is
  // the promise the decline link makes.
  const suppressed = await db().doc(`${SUPPRESSION}/${emailHash}`).get();
  if (suppressed.exists) return { outcome: "declined" };

  const indexRef = db().doc(`${INVITE_INDEX}/${emailHash}`);
  const index = await indexRef.get();
  const lastInvitedAt = index.exists ? ((index.get("lastInvitedAt") as number) ?? 0) : 0;
  if (lastInvitedAt && Date.now() - lastInvitedAt < REINVITE_COOLDOWN_MS) return { outcome: "recently_invited" };

  // Already a customer: nothing to invite them to, and telling the inviter is
  // kinder than a silent no-op.
  const existing = await getAuth()
    .getUserByEmail(email)
    .catch(() => null);
  if (existing) return { outcome: "already_member" };

  const invitationId = newInvitationId();
  const code = newCode();
  const expiresAt = Date.now() + config.limits.invitationExpiryDays * DAY_MS;

  try {
    await db().doc(`${CODES}/${code}`).create({ inviterUid: uid, invitationId, at: Date.now() });
  } catch {
    return { outcome: "failed" };
  }

  const invitation: Omit<InvitationDoc, "id"> = {
    inviterUid: uid,
    recipientEmail: email,
    recipientEmailHash: emailHash,
    code,
    channel: "email",
    status: "pending",
    terms,
    createdAt: Date.now(),
    expiresAt,
    acceptedBy: null,
    acceptedAt: null,
    progress: { signedUp: false, verified: false, activated: false, purchased: false },
    remindersSent: 0,
    rewardedCount: 0,
    referrerRewarded: false,
  };
  await db().doc(`${INVITATIONS}/${invitationId}`).set(invitation);

  const sent = await sendReferralInviteEmail({
    to: email,
    inviterName: args.inviterName,
    benefit: terms.referredSummary,
    acceptUrl: await shareUrlFor(code),
    declineUrl: await declineUrlFor(code),
    message: args.message,
    expiresOn: formatDate(expiresAt),
    invitationId,
  });
  if (!sent) {
    await db().doc(`${INVITATIONS}/${invitationId}`).set({ status: "void" }, { merge: true });
    return { outcome: "failed" };
  }

  await indexRef.set({ lastInvitedAt: Date.now(), count: FieldValue.increment(1) }, { merge: true });
  return { outcome: "sent", invitationId };
}

function formatDate(at: number): string {
  return new Date(at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

// ---- Accepting ---------------------------------------------------------------

export type AcceptOutcome =
  | "attributed"
  | "already_attributed"
  | "self"
  | "unknown_code"
  | "expired"
  | "already_used"
  | "ineligible";

/**
 * Attach a signed-in user to an invitation.
 *
 * Runs as early as the studio can manage — at the GUEST stage, before signup —
 * because attribution that waits for email verification loses everyone who takes
 * two sessions to get there. The reward triggers are what stay gated on proof;
 * attribution just needs to happen while the referral link is still the reason
 * they're here.
 */
export async function acceptInvitation(
  uid: string,
  rawCode: string,
  opts: { isAnonymous?: boolean } = {},
): Promise<AcceptOutcome> {
  const code = normalizeCode(rawCode);
  const target = await resolveCode(code);
  if (!target) return "unknown_code";
  if (target.inviterUid === uid) return "self";

  const userRef = db().doc(`users/${uid}`);
  const userSnap = await userRef.get();
  if (userSnap.exists && userSnap.get("referredBy")) return "already_attributed";

  const config = await getReferralConfig();

  let invitation: InvitationDoc;
  if (target.invitationId) {
    // An invitation already sent is a promise: it's honored even if the program
    // has since been switched off.
    const claimed = await claimEmailInvitation(target.invitationId, uid);
    if (typeof claimed === "string") return claimed;
    invitation = claimed;
  } else {
    // A share link is a NEW referral, so the master switch applies.
    if (!config.enabled) return "ineligible";
    invitation = await mintLinkInvitation(target.inviterUid, uid, code, config);
  }

  await userRef.set(
    {
      referredBy: invitation.inviterUid,
      referralInvitationId: invitation.id,
      referredAt: FieldValue.serverTimestamp(),
      // Anonymous acceptances are flagged so support can tell "attributed as a
      // guest" from "attributed as a real account" without archaeology.
      referredAsGuest: opts.isAnonymous === true,
    },
    { merge: true },
  );

  // Counted here rather than off the trigger, so a shared link counts the same as
  // an emailed invite (see TRIGGER_EFFECTS). Reached once per user: a second call
  // returns `already_attributed` above.
  await bumpStat("invitesAccepted");
  await onReferralEvent(uid, "invite_accepted");
  await announceAcceptance(invitation, uid);
  return "attributed";
}

/**
 * Claim a single-use email invitation, atomically. Returns the invitation, or an
 * outcome string explaining why it can't be claimed.
 */
async function claimEmailInvitation(
  invitationId: string,
  uid: string,
): Promise<InvitationDoc | Extract<AcceptOutcome, "expired" | "already_used" | "unknown_code">> {
  const ref = db().doc(`${INVITATIONS}/${invitationId}`);
  return await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return "unknown_code" as const;
    const invitation = normalizeInvitation(snap.id, snap.data());
    if (invitation.acceptedBy && invitation.acceptedBy !== uid) return "already_used" as const;
    if (invitation.status === "void" || invitation.status === "blocked") return "already_used" as const;
    if (invitation.expiresAt > 0 && Date.now() > invitation.expiresAt) {
      tx.set(ref, { status: "expired" }, { merge: true });
      return "expired" as const;
    }
    tx.set(
      ref,
      {
        status: "accepted",
        acceptedBy: uid,
        acceptedAt: Date.now(),
        progress: { signedUp: true },
      },
      { merge: true },
    );
    return { ...invitation, status: "accepted", acceptedBy: uid, acceptedAt: Date.now() };
  });
}

/**
 * One acceptance of a personal share link becomes its own invitation, with terms
 * frozen NOW — a link has no send moment to freeze at, and freezing per
 * acceptance is what keeps a shared link from being an open-ended promise at
 * whatever the config said years ago.
 */
async function mintLinkInvitation(
  inviterUid: string,
  uid: string,
  code: string,
  config: ReferralConfig,
): Promise<InvitationDoc> {
  const id = newInvitationId();
  const terms = freezeTerms(config);
  const now = Date.now();
  const invitation: Omit<InvitationDoc, "id"> = {
    inviterUid,
    recipientEmail: null,
    recipientEmailHash: null,
    code,
    channel: "link",
    status: "accepted",
    terms,
    createdAt: now,
    expiresAt: now + config.limits.linkExpiryDays * DAY_MS,
    acceptedBy: uid,
    acceptedAt: now,
    progress: { signedUp: true, verified: false, activated: false, purchased: false },
    remindersSent: 0,
    rewardedCount: 0,
    referrerRewarded: false,
  };
  await db().doc(`${INVITATIONS}/${id}`).set(invitation);
  return { ...invitation, id };
}

async function announceAcceptance(invitation: InvitationDoc, referredUid: string): Promise<void> {
  const friend = await getAuth().getUser(referredUid).catch(() => null);
  const pendingTrigger = invitation.terms.rules.find((r) => r.referrer)?.trigger;
  await sendReferralAcceptedEmail({
    uid: invitation.inviterUid,
    friendName: friend?.displayName ?? null,
    benefit: invitation.terms.referrerSummary || summarizeSide(invitation.terms, "referrer"),
    pending: pendingTrigger === "first_purchase" ? "their first purchase" : null,
    invitationId: invitation.id,
  });
  await notifySlack({
    channel: "growth",
    messageKey: "referral_accepted",
    ref: `referral_accepted_${invitation.id}`,
    text: `🤝 Referral accepted — ${invitation.channel === "email" ? "emailed invite" : "shared link"} from ${invitation.inviterUid.slice(0, 8)}.`,
  });
}

// ---- Declining ---------------------------------------------------------------

/**
 * The decline link. Suppresses the address permanently and voids the invitation.
 * Tokenless by design — the recipient has no account, and requiring one to opt
 * out would make the opt-out theatre.
 */
export async function declineInvitation(rawCode: string): Promise<boolean> {
  const code = normalizeCode(rawCode);
  const target = await resolveCode(code);
  if (!target?.invitationId) return false;
  const invitation = await getInvitation(target.invitationId);
  if (!invitation) return false;
  if (invitation.recipientEmailHash) {
    await db()
      .doc(`${SUPPRESSION}/${invitation.recipientEmailHash}`)
      .set({ at: Date.now(), reason: "declined" }, { merge: true });
  }
  if (invitation.status === "pending") {
    await db().doc(`${INVITATIONS}/${invitation.id}`).set({ status: "void" }, { merge: true });
  }
  return true;
}

/** Public preview for the decline/landing pages — inviter first name and the offer. */
export async function previewInvitation(
  rawCode: string,
): Promise<{ valid: boolean; inviterName: string | null; benefit: string } | null> {
  const target = await resolveCode(normalizeCode(rawCode));
  if (!target) return null;
  const inviter = await getAuth().getUser(target.inviterUid).catch(() => null);
  const firstName = inviter?.displayName?.trim().split(/\s+/)[0] ?? null;

  if (target.invitationId) {
    const invitation = await getInvitation(target.invitationId);
    if (!invitation) return null;
    const live = invitation.status === "pending" && (invitation.expiresAt === 0 || Date.now() < invitation.expiresAt);
    return { valid: live, inviterName: firstName, benefit: invitation.terms.referredSummary };
  }
  const config = await getReferralConfig();
  const terms = freezeTerms(config);
  return { valid: config.enabled, inviterName: firstName, benefit: terms.referredSummary };
}
