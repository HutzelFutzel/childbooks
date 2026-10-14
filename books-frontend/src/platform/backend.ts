/**
 * Base URL of the Firebase Functions backend (the `api` function) and helpers
 * to call it. All AI provider traffic and print fulfillment go through here, so
 * the browser never holds an API key.
 *
 *   - Production: set NEXT_PUBLIC_BACKEND_URL (App Hosting env / apphosting.yaml)
 *     to e.g. https://us-central1-<project>.cloudfunctions.net/api. CI builds
 *     load the same value out of apphosting.yaml (scripts/apphosting-env.mjs).
 *   - Development: defaults to the local Functions emulator.
 *
 * Every backend request carries the current user's Firebase ID token in the
 * `X-Auth-Token` header (when signed in). The backend verifies it and rejects
 * unauthenticated calls to `/proxy/*` and `/print/*`. A dedicated header is used
 * (not `Authorization`) so it never collides with the provider key the proxy
 * injects for upstream calls.
 */
import { appCheckToken, getFirebaseAuth } from "../lib/firebase";

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "childbook-60f89";
const EMULATOR_DEFAULT = `http://127.0.0.1:5001/${PROJECT_ID}/us-central1/api`;

/** Header the backend reads the Firebase ID token from. */
export const AUTH_TOKEN_HEADER = "X-Auth-Token";

/**
 * Header the backend reads the App Check attestation from. The standard name the
 * Firebase SDKs use — already allowlisted in `cors.json`.
 */
export const APP_CHECK_HEADER = "X-Firebase-AppCheck";

/**
 * Resolved lazily, on the first request — NOT at module scope. This module is
 * pulled into the server bundle of every page (the root layout mounts
 * `AuthInit` → `authStore` → here), so throwing while the module evaluates
 * would crash `next build` on any statically prerendered page that never even
 * talks to the backend. Missing config is instead caught by
 * `scripts/check-env.mjs`, which both CI and the deploy pipeline run.
 */
export function backendBase(): string {
  const explicit = process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, "");
  if (explicit) return explicit;
  if (process.env.NODE_ENV !== "production") return EMULATOR_DEFAULT;
  // Fail loudly rather than silently: a production bundle without a backend URL
  // would send every API call to the app's own origin and 404.
  throw new Error(
    "NEXT_PUBLIC_BACKEND_URL is not set for a production build. " +
      "Set it in apphosting.yaml (env → NEXT_PUBLIC_BACKEND_URL) to the deployed Functions origin.",
  );
}

export function backendUrl(path: string): string {
  return backendBase() + (path.startsWith("/") ? path : `/${path}`);
}

/** The current user's ID token, or null when signed out / unavailable. */
async function currentIdToken(forceRefresh = false): Promise<string | null> {
  try {
    const user = getFirebaseAuth().currentUser;
    return user ? await user.getIdToken(forceRefresh) : null;
  } catch {
    return null;
  }
}

/**
 * Session recovery after a 401
 * ----------------------------
 * The backend says WHY it rejected a token (`error.code`, see
 * `functions/src/auth.ts`), and `backendFetch` climbs a ladder, stopping at the
 * first rung that gets the request through:
 *
 *   1. Stale credentials   — another request already refreshed the session, or
 *                            we sent no token because sign-in was still in
 *                            flight. Just retry with the current token.
 *   2. Refresh the token   — fixes `session_expired`.
 *   3. Re-establish        — the session is dead (`session_revoked`, a refresh
 *                            that throws, ...) and a refresh can't help:
 *                              · guest → quietly mint a new guest session
 *                              · real account → open the sign-in dialog, WAIT
 *                                for the user, then replay the request with
 *                                their fresh token. Nothing they were doing
 *                                unmounts; the call simply resumes.
 *
 * Why the ladder instead of "refresh, then retry once": the Auth emulator
 * (restarted with `--import`) revokes every session but still happily
 * REFRESHES them — to a token the backend rejects again. A refresh that
 * "succeeds" proves nothing; only the backend's verdict on the retry does.
 *
 * Each rung is single-flight, so a burst of parallel 401s shares one refresh /
 * one guest re-mint / one dialog instead of racing each other.
 *
 * Replaying is safe, including POSTs: every `requireAuth` / `requireVerified`
 * rejection happens before the route handler runs, so the rejected attempt had
 * no side effects.
 */

/** `error.code` values from `functions/src/auth.ts` that mean "this session is dead". */
const DEAD_SESSION_CODES = new Set(["session_revoked", "account_disabled", "session_invalid"]);

const SESSION_ENDED_REASON = "Your session ended. Sign in again to pick up right where you left off.";

const inFlight = new Map<string, Promise<unknown>>();

/** Share one run of `fn` among every caller that arrives while it's pending. */
function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const run = fn().finally(() => inFlight.delete(key));
  inFlight.set(key, run);
  return run;
}

/** Reject as soon as `signal` aborts, so a cancelled request never hangs on a dialog. */
function abortable<T>(promise: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return promise;
  const abort = () => new DOMException("The operation was aborted.", "AbortError");
  if (signal.aborted) return Promise.reject(abort());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abort());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

/** The backend's machine-readable reason for a 401, or null if it gave none. */
async function authFailureCode(res: Response): Promise<string | null> {
  try {
    const body = (await res.clone().json()) as { error?: { code?: unknown } };
    return typeof body?.error?.code === "string" ? body.error.code : null;
  } catch {
    return null;
  }
}

type RefreshOutcome = "ok" | "dead" | "offline";

/** Force a token refresh. `offline` is deliberately NOT treated as a dead session. */
function refreshToken(): Promise<RefreshOutcome> {
  return singleFlight("refresh", async () => {
    const user = getFirebaseAuth().currentUser;
    if (!user) return "dead";
    try {
      await user.getIdToken(true);
      return "ok";
    } catch (err) {
      const code = (err as { code?: string })?.code;
      return code === "auth/network-request-failed" ? "offline" : "dead";
    }
  });
}

/**
 * Get a session at all. Covers a request that raced the initial guest sign-in
 * and went out with no token: wait for auth to settle, mint a guest only if
 * nobody is signed in by then.
 */
function ensureSession(): Promise<boolean> {
  return singleFlight("ensure", async () => {
    try {
      const { ensureGuestSession } = await import("../state/authStore");
      return await ensureGuestSession();
    } catch {
      return false;
    }
  });
}

/**
 * The current session is dead and can't be refreshed. A guest has nothing to
 * type, so they get a new guest session; a real account is asked to sign in and
 * we resolve once they have (false if they dismiss the dialog).
 *
 * Dynamically imported to avoid a static cycle with `state/authStore.ts`, which
 * imports `backendFetch` from this module.
 */
function reestablishSession(wasRealAccount: boolean): Promise<boolean> {
  return singleFlight("reestablish", async () => {
    try {
      const store = await import("../state/authStore");
      if (wasRealAccount) return await store.requestReauth(SESSION_ENDED_REASON);
      console.warn(
        "[auth] The guest session was rejected by the backend (revoked or unrefreshable); " +
          "starting a new guest session. Drafts saved under the old guest account stay under that uid.",
      );
      return await store.resetGuestSession();
    } catch (err) {
      console.error("[auth] Could not re-establish the session", err);
      return false;
    }
  });
}

/**
 * Walk the ladder for a request that just came back 401. Returns the response
 * to hand the caller — the retried one if recovery worked, otherwise the
 * original rejection so existing error handling still sees the 401.
 */
async function recoverFromUnauthorized(
  first: Attempt,
  send: () => Promise<Attempt>,
  opts: { background: boolean; signal?: AbortSignal | null },
): Promise<Response> {
  let last = first;
  /** Resend; the response if it got through, null if the backend still refused. */
  const retry = async (): Promise<Response | null> => {
    last = await send();
    return last.res.status === 401 ? null : last.res;
  };

  // Who sent the rejected token — read before any rung below can swap the user.
  const user = getFirebaseAuth().currentUser;
  const wasRealAccount = Boolean(user && !user.isAnonymous);
  let code = await authFailureCode(first.res);

  // Rung 1 — stale credentials.
  if (!first.token || code === "auth_required") {
    if (await ensureSession()) {
      const ok = await retry();
      if (ok) return ok;
      code = await authFailureCode(last.res);
    }
  } else if ((await currentIdToken()) !== first.token) {
    const ok = await retry();
    if (ok) return ok;
    code = await authFailureCode(last.res);
  }

  // Rung 2 — refresh. Skipped when the backend already told us a refresh can't help.
  let refreshDead = false;
  if (!code || !DEAD_SESSION_CODES.has(code)) {
    const outcome = await refreshToken();
    if (outcome === "offline") return last.res;
    if (outcome === "ok") {
      const ok = await retry();
      if (ok) return ok;
      code = await authFailureCode(last.res);
    } else {
      refreshDead = true;
    }
  }

  // Rung 3 — re-establish. Only on positive evidence the session is dead: an
  // unrecognised 401 (no code) must not log anyone out or open a dialog.
  const sessionIsDead = refreshDead || (code !== null && DEAD_SESSION_CODES.has(code));
  if (!sessionIsDead) return last.res;
  // A background beacon may tell a real account its session ended (that's the
  // page-load check doing its job) but must not replace a guest session: that
  // abandons the guest's uid, and analytics isn't worth that. The guest's next
  // real action re-mints it.
  if (opts.background && !wasRealAccount) return last.res;

  const recovered = await abortable(reestablishSession(wasRealAccount), opts.signal);
  if (recovered) {
    const ok = await retry();
    if (ok) return ok;
  }
  return last.res;
}

/**
 * Merge the auth + App Check headers into an existing `HeadersInit`. Use this for
 * any request that targets the backend so it carries the caller's identity and
 * proof that it came from a real instance of this app.
 *
 * Both are attached whenever available and both are optional: the ID token is
 * absent when signed out, and the App Check token is absent when App Check isn't
 * configured. Fetched in parallel so an unattested request never pays twice.
 */
export async function withAuthHeaders(headers?: HeadersInit): Promise<Headers> {
  const merged = new Headers(headers);
  const [token, attestation] = await Promise.all([currentIdToken(), appCheckToken()]);
  if (token) merged.set(AUTH_TOKEN_HEADER, token);
  if (attestation) merged.set(APP_CHECK_HEADER, attestation);
  return merged;
}

export interface BackendFetchInit extends RequestInit {
  /**
   * Mark a telemetry / beacon call (session ping, attribution, "seen" flags).
   * On a 401 it gets the same cheap, invisible recovery (retry, token refresh)
   * and, for a real account whose session is dead, the same sign-in prompt — but
   * it never REPLACES a guest session, since that abandons the guest's uid and
   * analytics isn't worth that.
   */
  background?: boolean;
}

/** One send of a request: the response plus the ID token it carried. */
interface Attempt {
  res: Response;
  token: string | null;
}

/**
 * `fetch` against the backend with the caller's identity attached. A 401 is
 * recovered transparently where possible (see "Session recovery" above); if the
 * user has to sign in again, this call waits for them and then resumes — the
 * caller just sees the eventual response.
 */
export async function backendFetch(path: string, init?: BackendFetchInit): Promise<Response> {
  const { background = false, ...rest } = init ?? {};
  const send = async (): Promise<Attempt> => {
    const headers = await withAuthHeaders(rest.headers);
    const res = await fetch(backendUrl(path), { ...rest, headers });
    return { res, token: headers.get(AUTH_TOKEN_HEADER) };
  };

  const first = await send();
  if (first.res.status !== 401) return first.res;
  return recoverFromUnauthorized(first, send, { background, signal: rest.signal });
}
