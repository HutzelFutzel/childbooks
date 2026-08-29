/**
 * Append-only authentication event log + the Auth blocking functions that feed
 * it.
 *
 * Firebase Auth and the profile doc only keep the LATEST sign-in timestamp, so
 * there's no history to build a "logins by weekday/hour" view from. These
 * blocking triggers capture every signup + sign-in server-side (can't be
 * spoofed by the client) into `analyticsEvents/{autoId}`:
 *
 *   { type: "signup" | "login", uid, email, source, country, at,
 *     device, os, browser, browserMajor }
 *
 * The device fields come from the `userAgent` the blocking event carries, parsed
 * server-side (see `core/analytics/device.ts` for what's collected and why it
 * needs no consent). Capturing them HERE is what makes every existing chart
 * device-aware for free: signups and logins by form factor, per market, over
 * time, with no new endpoint and no client change. Forward-only like the rest of
 * this collection — an event without them predates capture, which is a different
 * fact from "desktop" and is reported as such.
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
import { notifySlack, formatSignupSlackMessage, getSparksSpent } from "./notify";
import { SLACK_WEBHOOK_URL } from "./secrets";
import { regionFromLocale } from "./geo";
import { UNKNOWN_COUNTRY } from "../../books-frontend/src/core/analytics/markets";
import {
  isUnknownDevice,
  parseDeviceFacts,
  type DeviceFacts,
} from "../../books-frontend/src/core/analytics/device";

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

/**
 * Form factor / OS / browser for a blocking event.
 *
 * The event carries a raw `userAgent`; client hints aren't available here (this
 * isn't an HTTP request we can read headers off), so the UA string is the only
 * signal — which is fine, because everything derived from it is a family or a
 * major version.
 */
function deviceOf(event: AuthBlockingEvent): DeviceFacts {
  return parseDeviceFacts({ ua: event.userAgent ?? null });
}

async function record(
  type: "signup" | "login",
  user: AuthUserRecord,
  country: string,
  device: DeviceFacts,
): Promise<void> {
  const source = sourceOf(user);
  const known = !isUnknownDevice(device);
  const now = Date.now();
  try {
    ensureAdmin();
    const db = getFirestore();
    await db.collection("analyticsEvents").add({
      type,
      uid: user.uid,
      email: user.email ? user.email.toLowerCase() : null,
      source,
      country,
      at: now,
      // Omitted entirely when nothing could be read, so a missing field means
      // "not captured" rather than a bucket the dashboard would have to trust.
      ...(known
        ? {
            device: device.device,
            os: device.os,
            browser: device.browser,
            browserMajor: device.browserMajor,
          }
        : {}),
    });
    // Denormalize the market onto the user doc so the dashboard's per-market
    // grouping is a single `users` read rather than a join against the event
    // log (which only covers the selected window). Only overwrite with a known
    // country — a signal-less sign-in must not erase a good earlier reading.
    const patch: Record<string, unknown> = {};
    if (source !== "anonymous" && type === "signup") {
      patch.signedUpAt = now;
      patch.signupSource = source;
    }
    if (country !== UNKNOWN_COUNTRY) {
      patch.country = country;
      if (type === "signup") patch.signupCountry = country;
    }
    // Same reasoning for the device rollup. `signupDevice` anchors every
    // cross-device cohort ("created the account on a phone — then what?"), so
    // it's written ONCE, on creation, and never touched by a later sign-in.
    //
    // Note what it means in a guest-first product: `beforeUserCreated` fires
    // when the ANONYMOUS session is minted, and upgrading links that account in
    // place (same uid, and linking re-triggers beforeSignIn, not beforeCreate).
    // So this is the device the person first arrived on, which is the useful
    // reading anyway — but it is not necessarily the device they filled the
    // signup form on. `firstDevice` is deliberately left to the session beacon,
    // which is the only writer that sees guests reliably and can keep it
    // write-once without racing this one.
    if (known) {
      patch.meta = {
        device: {
          ...(type === "signup" ? { signupDevice: device.device } : {}),
          device: device.device,
          os: device.os,
          browser: device.browser,
          browserMajor: device.browserMajor,
        },
      };
    }
    if (Object.keys(patch).length > 0) {
      await db.doc(`users/${user.uid}`).set(patch, { merge: true });
    }
  } catch {
    // Best-effort: never block authentication on analytics.
  }

  // Ping Slack (#growth) for REAL new accounts only — everyone starts as an
  // anonymous guest, so those would be pure noise. Deduped on uid; prod-only and
  // best-effort (notifySlack swallows failures, so it can't block sign-in).
  if (type === "signup" && source !== "anonymous") {
    let guestSparksSpent = 0;
    try {
      guestSparksSpent = await getSparksSpent(user.uid);
    } catch {
      // Best-effort
    }

    await notifySlack({
      channel: "growth",
      messageKey: "signup",
      ref: `signup_${user.uid}`,
      text: formatSignupSlackMessage({
        email: user.email ?? user.uid,
        providerId: source,
        country,
        device: device.device,
        os: device.os,
        browser: device.browser,
        guestSparksSpent,
      }),
    });
  }
}

/**
 * Record a non-anonymous signup event and stamp `signedUpAt` on the user doc.
 * Called from `/auth/welcome` when a user creates/links a real account.
 * Idempotent: if `users/{uid}.signedUpAt` is already set, it will not duplicate.
 */
export async function recordSignupEvent(opts: {
  uid: string;
  email: string | null;
  providerId: string;
  country: string;
  device?: DeviceFacts;
  at?: number;
}): Promise<void> {
  const at = opts.at ?? Date.now();
  try {
    ensureAdmin();
    const db = getFirestore();
    const userRef = db.doc(`users/${opts.uid}`);
    const userSnap = await userRef.get();
    const existing = userSnap.data() ?? {};
    if (typeof existing.signedUpAt === "number") {
      return; // Already stamped as signed up.
    }

    const patch: Record<string, unknown> = {
      signedUpAt: at,
      signupSource: opts.providerId,
    };
    if (opts.country !== UNKNOWN_COUNTRY) {
      patch.country = opts.country;
      patch.signupCountry = opts.country;
    }
    const known = opts.device && !isUnknownDevice(opts.device);
    if (known && opts.device) {
      patch.meta = {
        device: {
          signupDevice: opts.device.device,
          device: opts.device.device,
          os: opts.device.os,
          browser: opts.device.browser,
          browserMajor: opts.device.browserMajor,
        },
      };
    }
    await userRef.set(patch, { merge: true });

    await db.collection("analyticsEvents").add({
      type: "signup",
      uid: opts.uid,
      email: opts.email ? opts.email.toLowerCase() : null,
      source: opts.providerId,
      country: opts.country,
      at,
      ...(known && opts.device
        ? {
            device: opts.device.device,
            os: opts.device.os,
            browser: opts.device.browser,
            browserMajor: opts.device.browserMajor,
          }
        : {}),
    });
  } catch {
    // Best-effort: never throw
  }
}

// The signup ping needs the Slack webhook URL in this function's env too (the
// blocking functions run separately from `api`), so bind the secret here.
const BLOCKING_OPTS = { secrets: [SLACK_WEBHOOK_URL] };

/** Fired once when an account (incl. anonymous guests) is first created. */
export const onBeforeCreate = beforeUserCreated(BLOCKING_OPTS, async (event) => {
  if (event.data) await record("signup", event.data, countryOf(event), deviceOf(event));
});

/** Fired on every sign-in (not token refresh). */
export const onBeforeSignIn = beforeUserSignedIn(BLOCKING_OPTS, async (event) => {
  if (event.data) await record("login", event.data, countryOf(event), deviceOf(event));
});
