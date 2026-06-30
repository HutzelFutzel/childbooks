/**
 * Append-only authentication event log + the Auth blocking functions that feed
 * it.
 *
 * Firebase Auth and the profile doc only keep the LATEST sign-in timestamp, so
 * there's no history to build a "logins by weekday/hour" view from. These
 * blocking triggers capture every signup + sign-in server-side (can't be
 * spoofed by the client) into `analyticsEvents/{autoId}`:
 *
 *   { type: "signup" | "login", uid, email, source, at }
 *
 * The admin Analysis dashboard queries this collection by `at` range. Writes are
 * STRICTLY best-effort: a throw here would block the user's authentication, so
 * every failure is swallowed.
 *
 * NOTE: blocking functions must be enabled for the project (deploying these
 * registers them). Against the Auth emulator they run automatically.
 */
import { beforeUserCreated, beforeUserSignedIn } from "firebase-functions/v2/identity";
import type { AuthUserRecord } from "firebase-functions/v2/identity";
import { getFirestore } from "firebase-admin/firestore";
import { ensureAdmin } from "./storage";

/** The provider an account was created/signed in with. */
function sourceOf(user: AuthUserRecord): string {
  const providerId = user.providerData?.[0]?.providerId;
  if (providerId) return providerId; // e.g. "password", "google.com"
  return "anonymous";
}

async function record(type: "signup" | "login", user: AuthUserRecord): Promise<void> {
  try {
    ensureAdmin();
    await getFirestore().collection("analyticsEvents").add({
      type,
      uid: user.uid,
      email: user.email ? user.email.toLowerCase() : null,
      source: sourceOf(user),
      at: Date.now(),
    });
  } catch {
    // Best-effort: never block authentication on analytics.
  }
}

/** Fired once when an account (incl. anonymous guests) is first created. */
export const onBeforeCreate = beforeUserCreated(async (event) => {
  if (event.data) await record("signup", event.data);
});

/** Fired on every sign-in (not token refresh). */
export const onBeforeSignIn = beforeUserSignedIn(async (event) => {
  if (event.data) await record("login", event.data);
});
