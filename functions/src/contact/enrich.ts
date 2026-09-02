/**
 * Account context for a contact-form submission — the extra signal that lets a
 * human triage a message before ever opening the admin dashboard: is this a
 * real customer, have they paid us anything, and when did they last buy?
 *
 * Best-effort and READ-ONLY: any lookup failure (or a lookup that overruns the
 * budget) degrades to a short "details unavailable" line rather than blocking
 * the Slack ping. The ping is the thing a human actually sees; this is garnish.
 */
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { ensureAdmin } from "../storage";
import { money } from "../notify";

/** Payment statuses that represent real (even if since-refunded) revenue. */
const PAID_LIKE_STATUSES = new Set(["paid", "refunded", "partially_refunded"]);

/** Cap the extra lookup so a slow payments query can't stall the Slack ping. */
const LOOKUP_BUDGET_MS = 2_000;

export interface ContactAccountContext {
  /** A Firebase session (including a guest/anonymous one) was attached to the request. */
  signedIn: boolean;
  /** A REAL, non-anonymous account — mirrors the frontend's `signedIn` concept. */
  hasAccount: boolean;
  /** Only meaningful when `hasAccount` — a guest uid is never "verified". */
  verified: boolean;
  /** Lifetime gross across paid/refunded/partially-refunded payments (best-effort: summed as one currency). */
  totalRevenue: number;
  currency: string;
  /** Epoch ms of the most recent paid-like payment, or null if the uid never paid. */
  lastPurchaseAt: number | null;
  /**
   * Lookup timed out or threw before we knew anything useful. Format as
   * "details unavailable" rather than inventing a guest/zero-revenue line.
   */
  incomplete?: boolean;
}

const NOT_SIGNED_IN: ContactAccountContext = {
  signedIn: false,
  hasAccount: false,
  verified: false,
  totalRevenue: 0,
  currency: "USD",
  lastPurchaseAt: null,
};

const SIGNED_IN_UNKNOWN: ContactAccountContext = {
  signedIn: true,
  hasAccount: false,
  verified: false,
  totalRevenue: 0,
  currency: "USD",
  lastPurchaseAt: null,
  incomplete: true,
};

/** Firestore Timestamp → epoch ms (payment docs store `createdAt` as a Timestamp). */
function tsToMs(v: unknown): number | null {
  if (v && typeof v === "object" && typeof (v as { toMillis?: () => number }).toMillis === "function") {
    return (v as { toMillis: () => number }).toMillis();
  }
  return typeof v === "number" ? v : null;
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    p.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

async function lookupAccount(uid: string): Promise<ContactAccountContext> {
  ensureAdmin();

  let hasAccount = false;
  let verified = false;
  try {
    const user = await getAuth().getUser(uid);
    // Mirrors `isAnonymousUid` (auth.ts): no linked provider ⇒ guest session.
    hasAccount = user.providerData.length > 0;
    verified = hasAccount && user.emailVerified === true;
  } catch {
    // Auth user missing/unreachable — still report signedIn=true from the valid
    // token that got us here; account/verified stay conservatively false.
  }

  let totalRevenue = 0;
  let currency = "USD";
  let lastPurchaseAt: number | null = null;
  try {
    const snap = await getFirestore()
      .collection("payments")
      .where("ownerUid", "==", uid)
      .limit(500)
      .get();
    let sawCurrency = false;
    for (const doc of snap.docs) {
      const d = doc.data() as Record<string, unknown>;
      if (!PAID_LIKE_STATUSES.has(typeof d.status === "string" ? d.status : "")) continue;
      totalRevenue += typeof d.amount === "number" ? d.amount : 0;
      if (!sawCurrency && typeof d.currency === "string" && d.currency) {
        currency = d.currency.toUpperCase();
        sawCurrency = true;
      }
      const at = tsToMs(d.createdAt);
      if (at != null && (lastPurchaseAt == null || at > lastPurchaseAt)) lastPurchaseAt = at;
    }
  } catch {
    // Degrade to zero revenue — a lookup hiccup shouldn't block the ping.
  }

  return { signedIn: true, hasAccount, verified, totalRevenue, currency, lastPurchaseAt };
}

/** Best-effort account + lifetime-revenue lookup for a uid. Never throws. */
export async function contactAccountContext(
  uid: string | null | undefined,
): Promise<ContactAccountContext> {
  if (!uid) return NOT_SIGNED_IN;
  try {
    return await withTimeout(lookupAccount(uid), LOOKUP_BUDGET_MS, SIGNED_IN_UNKNOWN);
  } catch {
    return SIGNED_IN_UNKNOWN;
  }
}

/** One Slack line summarizing account status, lifetime spend, and recency. */
export function formatAccountLine(ctx: ContactAccountContext): string {
  if (ctx.incomplete) return "👤 signed in · 💰 details unavailable";
  const account = !ctx.signedIn
    ? "not signed in"
    : !ctx.hasAccount
      ? "guest (anonymous session)"
      : ctx.verified
        ? "registered · verified"
        : "registered · unverified";
  const last = ctx.lastPurchaseAt
    ? new Date(ctx.lastPurchaseAt).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "never";
  return `👤 ${account} · 💰 ${money(ctx.totalRevenue, ctx.currency)} lifetime · 🛒 last purchase ${last}`;
}
