/**
 * Client access to the referral program.
 *
 * The server owns every decision here — what the offer is, who may invite, what
 * each invitation promised, what a reward is worth. The client's only jobs are to
 * render that and to remember a referral code across the signup it triggers.
 *
 * That last part is the subtle one. Someone arrives on `?ref=CODE`, and the
 * account they'll be attributed to may not exist for another two sessions. So the
 * code is parked in localStorage and offered to the backend on every identity
 * change until the backend gives a VERDICT (attributed, or a reason it never
 * will be) — clearing it on the first attempt, as an earlier version did, quietly
 * lost attribution for everyone who signed up in a second visit.
 */
import { backendFetch } from "./backend";
import type { ReferralOverview } from "../core/config/referral";

export type { InvitationView, ReferralOverview, RewardView } from "../core/config/referral";

const PENDING_KEY = "pendingReferralCode";

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

export type AcceptOutcome =
  | "attributed"
  | "already_attributed"
  | "self"
  | "unknown_code"
  | "expired"
  | "already_used"
  | "ineligible";

/** Everything the invite screen shows, in one round trip. */
export async function fetchReferralOverview(): Promise<ReferralOverview> {
  const res = await backendFetch("/referrals/overview");
  if (!res.ok) throw new Error(await message(res, "Could not load your invitations."));
  return (await res.json()) as ReferralOverview;
}

/** Send invitations. One outcome per address, in the order they were given. */
export async function sendReferralInvites(
  emails: string[],
  personalMessage?: string,
): Promise<{ results: SendResult[]; invitesLeftToday: number }> {
  const res = await backendFetch("/referrals/invite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ emails, message: personalMessage || undefined }),
  });
  if (!res.ok) throw new Error(await message(res, "Could not send your invitations."));
  return (await res.json()) as { results: SendResult[]; invitesLeftToday: number };
}

/** What an invitation promises — for the landing and decline screens (tokenless). */
export async function previewInvitation(
  code: string,
): Promise<{ valid: boolean; inviterName: string | null; benefit: string }> {
  const res = await backendFetch(`/invite/preview?code=${encodeURIComponent(code)}`);
  if (!res.ok) throw new Error(await message(res, "Could not load this invitation."));
  return (await res.json()) as { valid: boolean; inviterName: string | null; benefit: string };
}

/** Opt an invited address out for good (tokenless — they have no account). */
export async function declineInvitation(code: string): Promise<boolean> {
  try {
    const res = await backendFetch("/invite/decline", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ---- Remembering the code across signup -------------------------------------

/** Park the code from a `?ref=` landing until there's an identity to attach it to. */
export function rememberReferralCode(code: string): void {
  try {
    localStorage.setItem(PENDING_KEY, code.slice(0, 64));
  } catch {
    /* storage unavailable — the invite just doesn't stick */
  }
}

export function pendingReferralCode(): string | null {
  try {
    return localStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
}

function forgetReferralCode(): void {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Offer the remembered code to the backend for the current identity.
 *
 * The code is dropped only once the answer is FINAL: attributed, or a reason
 * that can't change (unknown, expired, spent, self-referral, program off). A
 * network blip or a not-yet-ready account leaves it parked for the next attempt.
 */
export async function claimPendingReferral(): Promise<AcceptOutcome | null> {
  const code = pendingReferralCode();
  if (!code) return null;
  let outcome: AcceptOutcome;
  try {
    const res = await backendFetch("/referrals/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { outcome?: AcceptOutcome };
    outcome = json.outcome ?? "ineligible";
  } catch {
    return null;
  }
  if (outcome !== "ineligible") forgetReferralCode();
  return outcome;
}

async function message(res: Response, fallback: string): Promise<string> {
  try {
    const json = (await res.json()) as { error?: { message?: string } };
    return json.error?.message || fallback;
  } catch {
    return fallback;
  }
}
