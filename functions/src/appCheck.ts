/**
 * Firebase App Check verification for the tokenless public endpoints.
 *
 * App Check attests that a request came from THIS web app running in a real
 * browser, which is the only defense here that a determined script can't simply
 * wait out (unlike a honeypot, a fill-time check, or a rate limit). It's the
 * intended primary gate on `/contact`.
 *
 * ROLLOUT IS TWO-STAGE, on purpose. Until `APP_CHECK_ENFORCED=true` this module
 * verifies whatever token arrives and logs the outcome but never rejects, so you
 * can confirm real traffic is passing before a misconfigured site key can lock
 * legitimate visitors out of the only channel they have to reach you. Flip the
 * flag once the logs look right.
 *
 * Setup (Firebase console → App Check): register a reCAPTCHA Enterprise site key
 * for the web app, put it in `NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY` so the
 * client can mint tokens, then set `APP_CHECK_ENFORCED=true` here.
 */
import { getAppCheck } from "firebase-admin/app-check";
import type { Request } from "express";
import { ensureAdmin } from "./storage";

/** Header the Firebase client SDKs use; `cors.json` already allows it. */
const APP_CHECK_HEADER = "x-firebase-appcheck";

export type AppCheckVerdict =
  /** A token was present and verified. */
  | "valid"
  /** A token was present but rejected (expired, wrong project, forged). */
  | "invalid"
  /** No token at all — an old cached bundle, or a non-browser client. */
  | "missing"
  /** Not checked: running emulated, where tokens can't be verified. */
  | "skipped";

/** Whether a failed verification should actually reject the request. */
export function appCheckEnforced(): boolean {
  return process.env.APP_CHECK_ENFORCED === "true";
}

/**
 * Verify the App Check token on a request. Never throws — returns a verdict and
 * lets the caller decide, since enforcement is staged.
 */
export async function verifyAppCheck(req: Request): Promise<AppCheckVerdict> {
  // The emulator has no App Check backend to verify against, and blocking local
  // development on it would be self-defeating. Mirrors `notifySlack`'s and
  // `requireVerified`'s emulator carve-outs.
  if (process.env.FUNCTIONS_EMULATOR === "true") return "skipped";

  const token = req.get(APP_CHECK_HEADER)?.trim();
  if (!token) return "missing";

  try {
    ensureAdmin();
    await getAppCheck().verifyToken(token);
    return "valid";
  } catch {
    return "invalid";
  }
}

/**
 * Verify and apply the staged enforcement policy in one call. Returns true when
 * the request should be rejected.
 */
export async function appCheckRejects(req: Request, label: string): Promise<boolean> {
  const verdict = await verifyAppCheck(req);
  if (verdict === "valid" || verdict === "skipped") return false;
  if (!appCheckEnforced()) {
    console.warn(`[appCheck] ${label}: ${verdict} (not enforced — allowing)`);
    return false;
  }
  console.warn(`[appCheck] ${label}: ${verdict} (enforced — rejecting)`);
  return true;
}
