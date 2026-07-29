/**
 * Abuse controls for the public, tokenless contact endpoint.
 *
 * `/contact` is reachable by anyone with a URL, so it needs its own defenses
 * rather than relying on an auth guard. In rough order of how much they actually
 * stop:
 *
 *   1. App Check (see `appCheck.ts`) — the real bot gate, once enforced.
 *   2. {@link consumeRateLimit} — a Firestore-backed fixed-window counter, so
 *      the limit holds ACROSS instances. The previous in-memory-only version was
 *      per-instance, which meant the effective ceiling was the configured limit
 *      times however many containers Cloud Run happened to be running.
 *   3. {@link checkSenderDomain} — the address has to belong to a domain that
 *      can actually receive mail, and not to a known disposable provider. You
 *      can't reply to a message from an address that doesn't exist.
 *   4. {@link looksAutomated} — a honeypot field plus a minimum fill time. Cheap
 *      speed bumps, not security controls.
 *
 * PRIVACY: every rate-limit key is hashed before it's used as a document id, so
 * this collection holds no IP addresses and no email addresses — just opaque
 * counters that expire.
 */
import { createHash } from "node:crypto";
import { resolveMx } from "node:dns/promises";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { ensureAdmin } from "../storage";

const RATE_LIMIT_COLLECTION = "contactRateLimits";

/** Fixed window length and per-key ceiling within it. */
export const RATE_WINDOW_MS = 10 * 60 * 1000;
export const RATE_MAX_PER_WINDOW = 5;

/** Reject anything submitted faster than a human could plausibly type it. */
const MIN_FILL_MS = 1_500;
/** …and anything claiming to have sat open for implausibly long. */
const MAX_FILL_MS = 12 * 60 * 60 * 1000;

/**
 * Local mirror of counters this instance has already seen.
 *
 * It may only ever short-circuit a DENIAL. A fresh or scaled-out instance has an
 * empty map, so Firestore remains the authority on whether a request is allowed
 * — the map just saves a transaction when the same caller keeps hammering the
 * same container.
 */
const localDenials = new Map<string, number>();

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 40);
}

/**
 * Count one attempt against `key`. Returns true when the caller is over the
 * limit and should be rejected.
 *
 * Transactional because two concurrent submissions would otherwise both read the
 * same count and both write count+1, letting a burst slip through. Fails OPEN: a
 * Firestore problem must not take the contact form offline, since it's now the
 * only way to reach us.
 */
export async function consumeRateLimit(
  key: string,
  max = RATE_MAX_PER_WINDOW,
  windowMs = RATE_WINDOW_MS,
): Promise<boolean> {
  const now = Date.now();
  const start = Math.floor(now / windowMs) * windowMs;
  const docId = `${hashKey(key)}_${start}`;

  if (localDenials.has(docId)) return true;

  try {
    ensureAdmin();
    const db = getFirestore();
    const ref = db.collection(RATE_LIMIT_COLLECTION).doc(docId);
    const allowed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.exists ? Number(snap.data()?.count ?? 0) : 0;
      if (current >= max) return false;
      tx.set(
        ref,
        {
          count: current + 1,
          windowStart: start,
          // Reaped by a Firestore TTL policy on this field; harmless if none is
          // configured (the docs are tiny and the ids are window-scoped).
          expiresAt: Timestamp.fromMillis(start + windowMs * 2),
        },
        { merge: true },
      );
      return true;
    });

    if (!allowed) {
      if (localDenials.size > 5_000) localDenials.clear();
      localDenials.set(docId, start);
    }
    return !allowed;
  } catch {
    return false;
  }
}

// ---- Sender domain ----------------------------------------------------------

/**
 * Free throwaway-mail providers. Not exhaustive by design — a full list is a
 * maintenance treadmill and this is only meant to catch the lazy majority.
 */
const DISPOSABLE_DOMAINS = new Set([
  "10minutemail.com",
  "guerrillamail.com",
  "guerrillamail.net",
  "mailinator.com",
  "yopmail.com",
  "temp-mail.org",
  "tempmail.com",
  "throwawaymail.com",
  "sharklasers.com",
  "trashmail.com",
  "getnada.com",
  "dispostable.com",
  "maildrop.cc",
  "fakeinbox.com",
  "mytemp.email",
  "moakt.com",
  "tempr.email",
  "spam4.me",
]);

const MX_TTL_MS = 60 * 60 * 1000;
const mxCache = new Map<string, { hasMx: boolean; at: number }>();

/** Race a promise against a timeout, resolving to `fallback` if it wins. */
async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type SenderDomainVerdict = "ok" | "disposable" | "undeliverable";

/**
 * Whether we could plausibly reply to this address.
 *
 * Fails OPEN on anything other than an authoritative "this domain has no mail
 * exchanger": a DNS timeout or SERVFAIL is our problem, not the visitor's, and
 * silently swallowing a real customer's message is far worse than accepting a
 * bit of spam.
 */
export async function checkSenderDomain(email: string): Promise<SenderDomainVerdict> {
  const domain = email.split("@")[1]?.toLowerCase().trim();
  if (!domain) return "undeliverable";
  if (DISPOSABLE_DOMAINS.has(domain)) return "disposable";

  const hit = mxCache.get(domain);
  if (hit && Date.now() - hit.at < MX_TTL_MS) {
    return hit.hasMx ? "ok" : "undeliverable";
  }

  const hasMx = await withTimeout(
    resolveMx(domain).then(
      (records) => records.length > 0,
      (err: NodeJS.ErrnoException) => {
        // Authoritative "no such domain" / "no MX records" ⇒ undeliverable.
        // Anything else (timeout, SERVFAIL, refused) ⇒ give them the benefit.
        return !(err.code === "ENOTFOUND" || err.code === "ENODATA" || err.code === "NXDOMAIN");
      },
    ),
    3_000,
    true,
  );

  if (mxCache.size > 2_000) mxCache.clear();
  mxCache.set(domain, { hasMx, at: Date.now() });
  return hasMx ? "ok" : "undeliverable";
}

// ---- Cheap bot signals ------------------------------------------------------

/**
 * Whether a submission carries the fingerprints of a script rather than a
 * person: the honeypot field is filled, or the form was completed impossibly
 * fast.
 *
 * `elapsedMs` is how long the form was open, measured ENTIRELY on the client (off
 * a monotonic clock where available) and sent as a duration. Deliberately not a
 * client timestamp compared against server time: browser clocks are routinely
 * minutes out, and that skew would silently discard real messages — the worst
 * possible failure for the only support channel we publish.
 *
 * A bot can of course report whatever duration it likes. So could it defeat a
 * server-signed timestamp, by simply waiting. This is a speed bump for the naive
 * majority; App Check is the actual gate.
 */
export function looksAutomated(input: { honeypot?: string; elapsedMs?: number }): boolean {
  if (input.honeypot && input.honeypot.trim().length > 0) return true;
  const elapsed = input.elapsedMs;
  if (typeof elapsed === "number" && Number.isFinite(elapsed)) {
    // Negative is impossible from a single clock ⇒ the value was fabricated.
    if (elapsed < MIN_FILL_MS) return true;
    if (elapsed > MAX_FILL_MS) return true;
  }
  return false;
}

/** Stable, non-reversible caller fingerprint for correlating repeat abuse. */
export function fingerprint(ip: string): string {
  return hashKey(`ip_${ip}`).slice(0, 16);
}
