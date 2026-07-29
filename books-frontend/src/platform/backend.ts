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
import { signInAnonymously } from "firebase/auth";
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
 * Recover a usable session after the backend rejects a request with 401. The two
 * common causes in practice are:
 *   - the cached ID token expired and simply needs a refresh, or
 *   - the local Auth emulator was restarted (e.g. `--import`), which revokes the
 *     previously-issued tokens and strands the already-open tab.
 *
 * Force-refreshing fixes the first; for the second we re-establish a guest
 * session (the studio is guest-first, so a fresh anonymous user is acceptable).
 * A signed-in *real* account whose session is dead is NOT silently downgraded to
 * a guest — we return false so the 401 surfaces and the user can re-authenticate.
 *
 * Returns true if a fresh token should now be available for a retry.
 */
async function recoverSession(): Promise<boolean> {
  try {
    const auth = getFirebaseAuth();
    const user = auth.currentUser;
    if (user) {
      try {
        await user.getIdToken(true); // force refresh
        return true;
      } catch {
        if (!user.isAnonymous) return false; // real account → require re-login
      }
    }
    await signInAnonymously(auth);
    return Boolean(auth.currentUser);
  } catch {
    return false;
  }
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

/**
 * When `recoverSession()` gives up, it's specifically because a real
 * (non-anonymous) account's token truly can't be refreshed — the one case
 * where the user actually needs to type credentials again. Rather than let
 * that surface as a bare failed request, pop the global sign-in dialog right
 * where the user already is: it's a modal, so whatever they were doing (an
 * open project, a half-filled form) never unmounts, and once they sign back in
 * they can just retry. Dynamically imported to avoid a static import cycle
 * with `state/authStore.ts` (which imports `backendFetch` from this module).
 * Best-effort: must never throw and mask the real 401.
 */
async function promptReauth(): Promise<void> {
  try {
    const { useAuthStore } = await import("../state/authStore");
    const { user, dialogOpen } = useAuthStore.getState();
    if (user && !user.isAnonymous && !dialogOpen) {
      useAuthStore
        .getState()
        .openAuthDialog("Your session ended. Sign in again to pick up right where you left off.");
    }
  } catch {
    // Best-effort UX nudge only — the caller still gets the failed response.
  }
}

export async function backendFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(backendUrl(path), {
    ...init,
    headers: await withAuthHeaders(init?.headers),
  });
  // A 401 in dev usually means the cached token expired or the Auth emulator was
  // restarted out from under the tab. Recover the session once and retry so a
  // backend restart doesn't strand the user mid-action. This is safe even for
  // POSTs: `requireVerified` rejects before the route handler runs, so the first
  // (rejected) attempt has no side effects.
  if (res.status === 401) {
    if (await recoverSession()) {
      return fetch(backendUrl(path), {
        ...init,
        headers: await withAuthHeaders(init?.headers),
      });
    }
    void promptReauth();
  }
  return res;
}
