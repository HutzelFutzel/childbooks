/**
 * Per-account throttle on guessing coupon codes.
 *
 * Shared by every route that can say whether a string is a real code: the
 * standalone preview and the print-order quote. Tight enough that enumerating
 * the code space isn't worth starting, loose enough that nobody retyping a code
 * off a crumpled receipt ever sees it.
 *
 * In-memory, so it resets when the instance recycles. That's an acceptable
 * ceiling for a throttle whose job is to make enumeration tedious rather than
 * impossible — a Firestore counter here would cost a write per validation.
 */
const LIMIT = 20;
const WINDOW_MS = 10 * 60_000;
const attempts = new Map<string, { count: number; resetAt: number }>();

/** Record one attempt; returns true once the account is over the limit. */
export function recordCouponAttempt(uid: string): boolean {
  const now = Date.now();
  const entry = attempts.get(uid);
  if (!entry || now > entry.resetAt) {
    attempts.set(uid, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count++;
  if (attempts.size > 10_000) attempts.clear();
  return entry.count > LIMIT;
}

/** Whether the account is already over the limit, without counting this look. */
export function couponAttemptsExhausted(uid: string): boolean {
  const entry = attempts.get(uid);
  return Boolean(entry && Date.now() <= entry.resetAt && entry.count > LIMIT);
}
