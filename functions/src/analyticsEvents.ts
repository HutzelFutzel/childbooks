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
 * `country` is the MARKET the event came from. Auth blocking events only
 * carry the client's BCP-47 locale — no timezone, no CDN header — so the
 * country written HERE is `regionFromLocale` (English region tags ignored,
 * because `en-US` is Chrome's default worldwide and is not a location). The
 * durable `users/{uid}.country` stamp is owned by `/auth/welcome` and
 * `/session/ping`, which can see timezone. Slack for real signups is also
 * fired from welcome, not from these triggers: pinging here raced welcome
 * and won with US for every English-UI visitor.
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
import { regionFromLocale, shouldWriteCountry, type GeoGuess } from "./geo";
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
 * Market for a blocking event. Auth carries only the client's BCP-47 locale —
 * no timezone, no CDN header. `regionFromLocale` ignores English region tags
 * (`en-US` is Chrome's default worldwide, not a location), so English-UI
 * visitors land in ZZ here and the real stamp is left to `/auth/welcome` and
 * `/session/ping`, which can see timezone.
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
    // Do not denormalize locale onto `users.country`. Auth blocking events
    // carry no timezone, and `en-US` as a locale is not a location — writing
    // it here is how the admin dashboard called every English-UI visitor
    // American. `/auth/welcome` and `/session/ping` see timezone and own the
    // durable stamp. The event log still records what we knew at auth time
    // (ZZ for English UIs, DE for `de-DE`, …).
    const patch: Record<string, unknown> = {};
    if (source !== "anonymous" && type === "signup") {
      patch.signedUpAt = now;
      patch.signupSource = source;
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

  // Slack for real (non-guest) signups lives on `/auth/welcome`. That handler
  // sees timezone; this blocking function does not. Pinging from here raced
  // welcome and won with `en-US` → US, so #growth called every German an
  // American. Deduped on uid, the correct welcome ping then never sent.
}

/**
 * Record a non-anonymous signup event and stamp `signedUpAt` on the user doc.
 * Called from `/auth/welcome` when a user creates/links a real account.
 * Idempotent on the event: if `users/{uid}.signedUpAt` is already set, it will
 * not duplicate the analytics row — but a stronger geo guess (timezone vs a
 * leftover locale stamp) still updates `country`, so a German whose guest
 * session was minted as US is corrected at upgrade.
 */
export async function recordSignupEvent(opts: {
  uid: string;
  email: string | null;
  providerId: string;
  country: string;
  geo?: GeoGuess;
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
    const existingCountry =
      typeof existing.country === "string" ? existing.country : undefined;
    const guess: GeoGuess = opts.geo ?? {
      country: opts.country,
      source: opts.country === UNKNOWN_COUNTRY ? "unknown" : "locale",
    };
    const writeCountry = shouldWriteCountry(guess, existingCountry);

    if (typeof existing.signedUpAt === "number") {
      if (writeCountry) {
        await userRef.set(
          {
            country: guess.country,
            ...(typeof existing.signupCountry === "string" ? {} : { signupCountry: guess.country }),
          },
          { merge: true },
        );
      }
      return;
    }

    const patch: Record<string, unknown> = {
      signedUpAt: at,
      signupSource: opts.providerId,
    };
    if (writeCountry) {
      patch.country = guess.country;
      patch.signupCountry = guess.country;
    } else if (opts.country !== UNKNOWN_COUNTRY && !existingCountry) {
      // Slack/display country from a saved fallback, with no stronger guess.
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
      country: writeCountry ? guess.country : opts.country,
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

/** Fired once when an account (incl. anonymous guests) is first created. */
export const onBeforeCreate = beforeUserCreated(async (event) => {
  if (event.data) await record("signup", event.data, countryOf(event), deviceOf(event));
});

/** Fired on every sign-in (not token refresh). */
export const onBeforeSignIn = beforeUserSignedIn(async (event) => {
  if (event.data) await record("login", event.data, countryOf(event), deviceOf(event));
});
