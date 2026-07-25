/**
 * Append-only authentication event log + the Auth blocking functions that feed
 * it.
 *
 * Firebase Auth and the profile doc only keep the LATEST sign-in timestamp, so
 * there's no history to build a "logins by weekday/hour" view from. These
 * blocking triggers capture every signup + sign-in server-side (can't be
 * spoofed by the client) into `analyticsEvents/{autoId}`:
 *
 *   { type: "signup" | "login", uid, email, source, country, at }
 *
 * `country` is the MARKET the event came from, derived from the already-exposed
 * locale/IP signals the blocking event carries (see geo.ts — never a stored IP,
 * never fine-grained geolocation). Without it every per-market number and every
 * local-time-of-day curve on the dashboard would be unbuildable, since Auth
 * itself records no location. The same code is denormalized onto `users/{uid}`
 * so the cross-user scans can group by market from a single collection read
 * instead of re-deriving it per request.
 *
 * The admin Analysis dashboard queries this collection by `at` range. Writes are
 * STRICTLY best-effort: a throw here would block the user's authentication, so
 * every failure is swallowed.
 *
 * NOTE: blocking functions must be enabled for the project (deploying these
 * registers them). Against the Auth emulator they run automatically.
 */
import { beforeUserCreated, beforeUserSignedIn } from "firebase-functions/v2/identity";
import type { AuthBlockingEvent, AuthUserRecord } from "firebase-functions/v2/identity";
import { getFirestore } from "firebase-admin/firestore";
import { ensureAdmin } from "./storage";
import { notifySlack } from "./notify";
import { SLACK_WEBHOOK_URL } from "./secrets";
import { regionFromLocale } from "./geo";
import { UNKNOWN_COUNTRY } from "../../books-frontend/src/core/analytics/markets";

/** The provider an account was created/signed in with. */
function sourceOf(user: AuthUserRecord): string {
  const providerId = user.providerData?.[0]?.providerId;
  if (providerId) return providerId; // e.g. "password", "google.com"
  return "anonymous";
}

/**
 * Market for a blocking event. The event carries the client's BCP-47 locale,
 * whose region subtag ("de-DE" → DE) is the only location signal available at
 * auth time — Auth records none and there's no request header to read here.
 */
function countryOf(event: AuthBlockingEvent): string {
  return regionFromLocale(event.locale ?? "") ?? UNKNOWN_COUNTRY;
}

async function record(
  type: "signup" | "login",
  user: AuthUserRecord,
  country: string,
): Promise<void> {
  const source = sourceOf(user);
  try {
    ensureAdmin();
    const db = getFirestore();
    await db.collection("analyticsEvents").add({
      type,
      uid: user.uid,
      email: user.email ? user.email.toLowerCase() : null,
      source,
      country,
      at: Date.now(),
    });
    // Denormalize the market onto the user doc so the dashboard's per-market
    // grouping is a single `users` read rather than a join against the event
    // log (which only covers the selected window). Only overwrite with a known
    // country — a signal-less sign-in must not erase a good earlier reading.
    if (country !== UNKNOWN_COUNTRY) {
      const patch: Record<string, unknown> = { country };
      if (type === "signup") patch.signupCountry = country;
      await db.doc(`users/${user.uid}`).set(patch, { merge: true });
    }
  } catch {
    // Best-effort: never block authentication on analytics.
  }

  // Ping Slack (#growth) for REAL new accounts only — everyone starts as an
  // anonymous guest, so those would be pure noise. Deduped on uid; prod-only and
  // best-effort (notifySlack swallows failures, so it can't block sign-in).
  if (type === "signup" && source !== "anonymous") {
    await notifySlack({
      channel: "growth",
      messageKey: "signup",
      ref: `signup_${user.uid}`,
      text: `🎉 New signup — ${user.email ?? user.uid} (${source})`,
    });
  }
}

// The signup ping needs the Slack webhook URL in this function's env too (the
// blocking functions run separately from `api`), so bind the secret here.
const BLOCKING_OPTS = { secrets: [SLACK_WEBHOOK_URL] };

/** Fired once when an account (incl. anonymous guests) is first created. */
export const onBeforeCreate = beforeUserCreated(BLOCKING_OPTS, async (event) => {
  if (event.data) await record("signup", event.data, countryOf(event));
});

/** Fired on every sign-in (not token refresh). */
export const onBeforeSignIn = beforeUserSignedIn(BLOCKING_OPTS, async (event) => {
  if (event.data) await record("login", event.data, countryOf(event));
});
