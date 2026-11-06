/**
 * What to do when a book will not save: why it failed, and when to try again.
 *
 * Pure, so the rules can be checked without a network. The store owns the timers.
 */
import { NotSignedInError, StoredValueTooLargeError } from "./types";

/**
 * `transient`: offline, a timeout, a blocked connection: sending the same book later can work.
 * `signedOut`: the session ended; saving works again once they sign in.
 * `tooLarge`: over the storage document limit. `rejected`: the backend refused the write itself
 * (permissions, an invalid value). Neither of the last two is fixed by sending the same book again.
 */
export type SaveFailureReason = "transient" | "signedOut" | "tooLarge" | "rejected";

export function saveFailureReasonOf(err: unknown): SaveFailureReason {
  if (err instanceof StoredValueTooLargeError) return "tooLarge";
  if (err instanceof NotSignedInError) return "signedOut";
  const message = err instanceof Error ? err.message : String(err);
  if (/exceeds the maximum allowed size|is longer than \d+ bytes/i.test(message)) return "tooLarge";
  const code = (err as { code?: unknown } | null)?.code;
  if (code === "unauthenticated" || code === "auth/user-token-expired" || code === "auth/user-not-found") {
    return "signedOut";
  }
  if (code === "permission-denied" || code === "invalid-argument") return "rejected";
  return "transient";
}

/** Whether trying the same book again on a timer can ever help. */
export function isRetryable(reason: SaveFailureReason): boolean {
  return reason === "transient";
}

export const RETRY_BASE_MS = 2_000;
export const RETRY_MAX_MS = 60_000;
const RETRY_JITTER = 0.2;

/**
 * The wait before retry number `attempt` (1 = the first retry): 2s, 4s, 8s … up to a minute, spread
 * ±20% so that many tabs coming back online together do not all knock at once.
 */
export function retryDelayMs(attempt: number, random: () => number = Math.random): number {
  const step = Math.max(1, Math.floor(attempt));
  const base = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (step - 1));
  const spread = 1 + (random() * 2 - 1) * RETRY_JITTER;
  return Math.round(Math.min(RETRY_MAX_MS * (1 + RETRY_JITTER), base * spread));
}

/**
 * After this many failed attempts while the browser says it is online, "check your connection" is no
 * longer the likely story, and the message says so.
 */
export const LONG_FAILURE_ATTEMPTS = 5;

export type SaveFailureNote = SaveFailureReason | "stubborn";

/** The note the reader sees: the reason, or "stubborn" for a transient failure that keeps coming back online. */
export function saveFailureNote(reason: SaveFailureReason, attempts: number, online: boolean): SaveFailureNote {
  return reason === "transient" && online && attempts >= LONG_FAILURE_ATTEMPTS ? "stubborn" : reason;
}
