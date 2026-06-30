/**
 * Runtime sandbox↔live toggle.
 *
 * The active billing environment is normally fixed at deploy time via
 * `LULU_ENV` / `STRIPE_ENV`. To let an admin flip the whole backend (Stripe +
 * Lulu) between sandbox and live WITHOUT a redeploy, we persist an override in
 * Firestore (`appConfig/runtime.env`) and overlay it onto `serverConfig()`.
 *
 * `serverConfig()` is synchronous and called deep inside request handlers, so
 * we keep a short-lived in-memory cache here and refresh it once per request
 * (see `attachUser`). The cache is also updated synchronously the moment an
 * admin writes a new value, so the toggling instance sees it immediately; other
 * instances converge within {@link CACHE_TTL_MS}.
 *
 * NOTE: switching to "live" only works if the live secrets are actually bound
 * (deployed with `LIVE_ENABLED=true`). The go-live readiness check enforces this
 * before the toggle is allowed to flip.
 */
import { getFirestore } from "firebase-admin/firestore";
import { ensureAdmin } from "./storage";
import type { FulfillmentEnv } from "../../books-frontend/src/core/settings";

const DOC = "appConfig/runtime";
const CACHE_TTL_MS = 30_000;

let cache: { env: FulfillmentEnv | null; at: number } | null = null;

function coerce(value: unknown): FulfillmentEnv | null {
  return value === "live" ? "live" : value === "sandbox" ? "sandbox" : null;
}

/**
 * The cached env override, or null when none is set / not yet loaded. Synchronous
 * so `serverConfig()` can consult it. Falls back to env-var behavior when null.
 */
export function cachedRuntimeEnv(): FulfillmentEnv | null {
  return cache?.env ?? null;
}

/** Refresh the cache from Firestore (best-effort; TTL-throttled). */
export async function refreshRuntimeEnv(): Promise<FulfillmentEnv | null> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.env;
  ensureAdmin();
  let env: FulfillmentEnv | null = null;
  try {
    const snap = await getFirestore().doc(DOC).get();
    env = snap.exists ? coerce(snap.data()?.env) : null;
  } catch {
    env = null;
  }
  cache = { env, at: Date.now() };
  return env;
}

/** Force a fresh read on the next `refreshRuntimeEnv()` (ignores the TTL). */
export function invalidateRuntimeEnv(): void {
  cache = null;
}

/** Persist a new active environment and update the local cache immediately. */
export async function setRuntimeEnv(env: FulfillmentEnv, uid?: string): Promise<void> {
  ensureAdmin();
  await getFirestore()
    .doc(DOC)
    .set({ env, updatedAt: Date.now(), ...(uid ? { updatedBy: uid } : {}) }, { merge: true });
  cache = { env, at: Date.now() };
}

/** The resolved active environment (override if set, else the deploy default). */
export async function getRuntimeEnv(): Promise<FulfillmentEnv | null> {
  return refreshRuntimeEnv();
}
