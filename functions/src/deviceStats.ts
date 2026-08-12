/**
 * Device + session tracking backend.
 *
 * Two things live here: the ingest beacon (`POST /session/ping`) and the storage
 * helpers for what it writes. The dashboard aggregation that reads it all back is
 * in `analytics.ts`, next to the other `compute*` functions — same split as
 * `blogStats.ts` (ingest + storage) versus the Analysis routes.
 *
 * WHAT A "SESSION" IS HERE, AND WHY IT ISN'T A COOKIE
 * --------------------------------------------------
 * Sessions are derived SERVER-SIDE from an idle gap: a ping more than
 * {@link SESSION_GAP_MS} after the previous one starts a new session, anything
 * sooner extends the current one. No session id is stored on the device — no
 * cookie, no `localStorage`, no `sessionStorage` — which keeps the whole feature
 * outside ePrivacy Art 5(3) and therefore outside the consent banner. It also
 * happens to be more robust than the alternative: a server-side session survives
 * the user clearing storage, and can't be forged by a client that fancies being
 * counted twice.
 *
 * The identity is the Firebase uid the request is already authenticated with
 * (guests included), so nothing new is being linked that wasn't linked before.
 *
 * WHAT GETS WRITTEN
 * -----------------
 *   - `users/{uid}.meta.device` — a fixed-size per-user rollup (last/first
 *     device, per-form-factor session counts, switch timestamp). This is what
 *     makes cross-device cohorts computable without an event log. Server-only:
 *     the form factor is read from the request's own headers, never from the
 *     body, because a field the measured party can set is not evidence.
 *   - `deviceStats/{YYYY-MM-DD}` — daily counters for the time series.
 *
 * Deliberately NOT written: a row per session. See `core/analytics/deviceStats.ts`
 * for why the aggregate is the right shape.
 */
import express, { type Express, type Request, type Response } from "express";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { ensureAdmin } from "./storage";
import type { AuthedRequest } from "./auth";
import { countryFromSignals, deviceFactsFromHeaders } from "./geo";
import {
  browserVersionKey,
  isUnknownDevice,
  viewportBucket,
  VIEWPORT_BUCKETS,
  type DeviceFacts,
} from "../../books-frontend/src/core/analytics/device";
import {
  normalizeDeviceDayStats,
  type DeviceDayStats,
} from "../../books-frontend/src/core/analytics/deviceStats";

const STATS_COLLECTION = "deviceStats";

/**
 * Idle gap that ends a session. Thirty minutes is the long-standing web
 * analytics convention (GA has used it since Urchin), which matters less for
 * being correct than for being COMPARABLE — a bespoke window would make every
 * number here incommensurable with any external benchmark.
 */
const SESSION_GAP_MS = 30 * 60 * 1000;

/**
 * Don't rewrite the profile doc more often than this while a session is simply
 * continuing. The client pings on mount and on tab focus, which for a long
 * studio sitting could be dozens of times; without a floor, a feature meant to
 * measure engagement would be billing for it. New sessions always write.
 */
const EXTEND_WRITE_MS = 5 * 60 * 1000;

/** UTC day key, `YYYY-MM-DD` — the daily aggregate's document id. */
function dayKey(at = Date.now()): string {
  return new Date(at).toISOString().slice(0, 10);
}

// ---- Per-user rollup --------------------------------------------------------

/** The subset of `meta.device` this module reads back to decide what to write. */
interface DeviceState {
  firstDevice: string | null;
  switchedAt: number | null;
  lastSeenAt: number | null;
  sessions: number;
}

function readState(raw: unknown): DeviceState {
  const meta = (raw ?? {}) as Record<string, unknown>;
  const device = ((meta.meta as Record<string, unknown> | undefined)?.device ?? {}) as Record<
    string,
    unknown
  >;
  return {
    firstDevice: typeof device.firstDevice === "string" ? device.firstDevice : null,
    switchedAt: typeof device.switchedAt === "number" ? device.switchedAt : null,
    lastSeenAt: typeof device.lastSeenAt === "number" ? device.lastSeenAt : null,
    sessions: typeof device.sessions === "number" ? device.sessions : 0,
  };
}

interface PingInput {
  uid: string;
  facts: DeviceFacts;
  /** Viewport bucket, or null when the client had no analytics consent. */
  viewport: string | null;
  country: string;
  at: number;
}

interface PingOutcome {
  /** True when this ping opened a new session (and so bumped the daily doc). */
  newSession: boolean;
}

/**
 * Apply one ping to the user's rollup.
 *
 * Read-then-merge rather than a transaction, on purpose: the only race is two
 * pings from the same person landing inside the same millisecond, whose worst
 * outcome is one double-counted session, and the profile doc is hot enough
 * (Sparks, preferences, referral state) that taking a lock on it to protect a
 * session counter would be a bad trade.
 */
async function applyToProfile(input: PingInput): Promise<PingOutcome> {
  const db = getFirestore();
  const ref = db.doc(`users/${input.uid}`);

  let state: DeviceState = { firstDevice: null, switchedAt: null, lastSeenAt: null, sessions: 0 };
  try {
    const snap = await ref.get();
    if (snap.exists) state = readState(snap.data());
  } catch {
    // Treated as a first-ever session. A duplicate "first" is a far smaller
    // error than dropping the ping entirely.
  }

  const newSession =
    state.lastSeenAt == null || input.at - state.lastSeenAt > SESSION_GAP_MS;
  if (!newSession && input.at - (state.lastSeenAt ?? 0) < EXTEND_WRITE_MS) {
    return { newSession: false };
  }

  // Every entry is a LEAF field path, never the whole `meta.device` map: an
  // `update` of a map-valued path REPLACES that map, which would silently take
  // `signupDevice` (written by the auth blocking functions) and `purchaseDevice`
  // (written at settlement) with it on every session.
  //
  // `meta.lastActiveAt` rides along because it's what the profile UI and the
  // admin table read for "last seen", and it was previously only refreshed by the
  // client on studio mount — so a guest browsing without opening the studio no
  // longer looks idle.
  const patch: Record<string, unknown> = {
    "meta.device.device": input.facts.device,
    "meta.device.os": input.facts.os,
    "meta.device.browser": input.facts.browser,
    "meta.device.browserMajor": input.facts.browserMajor,
    "meta.device.lastSeenAt": input.at,
    "meta.lastActiveAt": input.at,
  };
  if (input.viewport) patch["meta.device.viewport"] = input.viewport;

  if (newSession) {
    patch["meta.device.sessions"] = FieldValue.increment(1);
    patch["meta.device.sessionStartedAt"] = input.at;
    patch[`meta.device.counts.${input.facts.device}`] = FieldValue.increment(1);
    // Write-once: the entry device is the anchor the dashboard's device filter
    // selects on, so a later session on a different device must not rewrite it.
    if (!state.firstDevice) patch["meta.device.firstDevice"] = input.facts.device;
    // First time they've shown up on a different form factor — the moment the
    // cross-device switch happened. Also write-once: we want the FIRST switch,
    // not the most recent one, or the lag metric measures nothing.
    else if (state.switchedAt == null && state.firstDevice !== input.facts.device) {
      patch["meta.device.switchedAt"] = input.at;
    }
  }
  if (input.country && input.country !== "ZZ") patch.country = input.country;

  // Dotted field paths need `update`, which fails on a missing doc — so fall
  // back to a create for the very first ping of a brand-new identity. The
  // fallback spells out literal values instead of the increments above, since
  // there's nothing yet to increment.
  try {
    await ref.update(patch);
  } catch {
    await ref.set(
      {
        ...(input.country !== "ZZ" ? { country: input.country } : {}),
        meta: {
          lastActiveAt: input.at,
          device: {
            device: input.facts.device,
            os: input.facts.os,
            browser: input.facts.browser,
            browserMajor: input.facts.browserMajor,
            firstDevice: input.facts.device,
            counts: { [input.facts.device]: 1 },
            sessions: 1,
            sessionStartedAt: input.at,
            lastSeenAt: input.at,
            ...(input.viewport ? { viewport: input.viewport } : {}),
          },
        },
      },
      { merge: true },
    );
  }
  return { newSession };
}

// ---- Daily aggregate --------------------------------------------------------

/**
 * Bump the day's counters. Field-level increments rather than a read-modify-write
 * transaction: every key here is a counter in a closed set, so there's nothing
 * to reconcile and nothing to serialize on.
 *
 * Written as NESTED MAPS, not dotted keys: `set` takes its keys literally (only
 * `update` parses field paths), so a `byDevice.mobile` key here would create a
 * field whose name contains a dot instead of an entry in the `byDevice` map —
 * and every read of the series would come back empty. A `merge` still touches
 * only the leaves named below, so two form factors can't clobber each other.
 * Requires `set` rather than `update` because the day's doc won't exist yet at
 * its first session.
 */
async function bumpDay(facts: DeviceFacts, viewport: string | null, at: number): Promise<void> {
  const one = () => FieldValue.increment(1);
  const patch: Record<string, unknown> = {
    version: 1,
    date: dayKey(at),
    sessions: one(),
    byDevice: { [facts.device]: one() },
    byOs: { [facts.os]: one() },
    byBrowser: { [facts.browser]: one() },
    byBrowserVersion: { [browserVersionKey(facts)]: one() },
    updatedAt: at,
  };
  if (viewport) patch.byViewport = { [viewport]: one() };
  await getFirestore().doc(`${STATS_COLLECTION}/${dayKey(at)}`).set(patch, { merge: true });
}

/**
 * Record a completed purchase against the device checkout was started on, and
 * pin `meta.device.purchaseDevice` for the buyer.
 *
 * Counted EXACTLY ONCE per payment. Stripe redelivers a webhook after any
 * non-2xx, and every other effect in that handler is idempotent on the payment
 * id (deterministic document ids + `create`) — a blind counter increment is not,
 * so the day's tally is bumped in the same transaction that stamps
 * `payments/{ref}.deviceAttributedAt`, and a redelivery sees the stamp and
 * counts nothing.
 *
 * Write-once on the profile: the FIRST purchase device is what the cross-device
 * cohort needs ("they signed up on a phone and bought on a laptop"); overwriting
 * it on every repeat order would turn that into "wherever they last bought".
 */
export async function recordDevicePurchase(opts: {
  uid: string | null;
  /** Payment id — the same idempotency key the finance events use. */
  ref: string;
  device: string;
  revenueUsd: number;
  at?: number;
}): Promise<void> {
  const at = opts.at ?? Date.now();
  try {
    ensureAdmin();
    const db = getFirestore();
    const paymentRef = db.doc(`payments/${opts.ref}`);
    const dayRef = db.doc(`${STATS_COLLECTION}/${dayKey(at)}`);
    const counted = await db.runTransaction(async (tx) => {
      const snap = await tx.get(paymentRef);
      // A payment we can't see is a payment we can't dedupe against, and the
      // caller only reaches here having just read the record — so this is a
      // "shouldn't happen" that's better skipped than counted repeatedly.
      if (!snap.exists || snap.get("deviceAttributedAt")) return false;
      tx.set(
        dayRef,
        {
          version: 1,
          date: dayKey(at),
          // Nested, for the same reason as `bumpDay` above.
          purchasesByDevice: { [opts.device]: FieldValue.increment(1) },
          revenueUsdByDevice: {
            [opts.device]: FieldValue.increment(Math.round(opts.revenueUsd * 100) / 100),
          },
          updatedAt: at,
        },
        { merge: true },
      );
      tx.set(paymentRef, { deviceAttributedAt: at }, { merge: true });
      return true;
    });
    if (!counted || !opts.uid) return;
    const ref = db.doc(`users/${opts.uid}`);
    const snap = await ref.get();
    const existing = (
      (snap.data()?.meta as Record<string, unknown> | undefined)?.device as
        | Record<string, unknown>
        | undefined
    )?.purchaseDevice;
    if (typeof existing === "string" && existing) return;
    await ref.set({ meta: { device: { purchaseDevice: opts.device } } }, { merge: true });
  } catch {
    // Never let attribution break a paid order.
  }
}

/**
 * Read the daily aggregate docs covering [from, to] inclusive.
 *
 * Keyed reads by document id rather than a range query: the ids ARE the dates,
 * so this needs no index and — more usefully — returns a zero-filled row for a
 * day nothing happened, which a `where` query silently omits.
 */
export async function readDeviceDays(from: number, to: number): Promise<DeviceDayStats[]> {
  ensureAdmin();
  const DAY_MS = 24 * 60 * 60 * 1000;
  const keys: string[] = [];
  // Cap the fan-out. A year of daily docs is a sane ceiling for one request; a
  // wider window silently narrows rather than issuing 3000 reads.
  const start = Math.max(from, to - 366 * DAY_MS);
  for (let t = start; t <= to + DAY_MS; t += DAY_MS) {
    const key = dayKey(Math.min(t, to));
    if (!keys.includes(key)) keys.push(key);
  }
  if (keys.length === 0) return [];
  try {
    const db = getFirestore();
    const snaps = await db.getAll(
      ...keys.map((k) => db.doc(`${STATS_COLLECTION}/${k}`)),
    );
    return snaps.map((snap, i) =>
      normalizeDeviceDayStats(snap.exists ? snap.data() : { date: keys[i] }, keys[i]),
    );
  } catch {
    return keys.map((k) => normalizeDeviceDayStats({ date: k }, k));
  }
}

// ---- Ingest route -----------------------------------------------------------

/**
 * In-memory per-instance throttle. Complements the `EXTEND_WRITE_MS` floor
 * above by rejecting a flood before it costs a Firestore READ, not just a
 * write. Mirrors the blog beacon's approach (see `blogStats.ts`).
 */
const THROTTLE_MS = 30_000;
const lastPing = new Map<string, number>();

function throttled(uid: string, now: number): boolean {
  const prev = lastPing.get(uid) ?? 0;
  if (now - prev < THROTTLE_MS) return true;
  lastPing.set(uid, now);
  if (lastPing.size > 20_000) {
    for (const [k, v] of lastPing) if (now - v > SESSION_GAP_MS) lastPing.delete(k);
  }
  return false;
}

/**
 * `POST /session/ping` — authenticated (guests included), always 204.
 *
 * The body carries only signals the server can't derive itself: the browser
 * locale and timezone (for the market, exactly as the blog beacon does) and an
 * optional viewport width. Everything about the DEVICE comes from the request
 * headers instead, so the body can't be used to misreport a form factor.
 */
export function registerSessionRoutes(app: Express): void {
  const parse = express.json({ limit: "4kb" });

  app.post("/session/ping", parse, async (req: Request, res: Response) => {
    try {
      const uid = (req as AuthedRequest).uid;
      const now = Date.now();
      if (!uid || throttled(uid, now)) return;

      const facts = deviceFactsFromHeaders(req.headers);
      // Nothing readable about the client means nothing worth aggregating —
      // recording it would only inflate the "unknown" bucket with bots and
      // synthetic traffic that never reaches a real conclusion.
      if (isUnknownDevice(facts)) return;

      const body = (req.body ?? {}) as Record<string, unknown>;
      const country = countryFromSignals({
        headers: req.headers,
        locale: typeof body.locale === "string" ? body.locale : "",
        tz: typeof body.tz === "string" ? body.tz : "",
      });
      // Only present when the caller holds analytics consent (see the client
      // beacon). Validated against the closed bucket set so a hand-rolled
      // request can't introduce a new map key.
      const rawViewport = body.viewport;
      let viewport: string | null = null;
      if (typeof rawViewport === "number" && Number.isFinite(rawViewport)) {
        viewport = viewportBucket(rawViewport);
      } else if (
        typeof rawViewport === "string" &&
        (VIEWPORT_BUCKETS as readonly string[]).includes(rawViewport)
      ) {
        viewport = rawViewport;
      }

      ensureAdmin();
      const { newSession } = await applyToProfile({ uid, facts, viewport, country, at: now });
      if (newSession) await bumpDay(facts, viewport, now);
    } catch (err) {
      console.error("[session-ping] failed", err);
    } finally {
      res.status(204).end();
    }
  });
}
