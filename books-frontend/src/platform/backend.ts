/**
 * Base URL of the Firebase Functions backend (the `api` function) and helpers
 * to call it. All AI provider traffic and print fulfillment go through here, so
 * the browser never holds an API key.
 *
 *   - Production: set NEXT_PUBLIC_BACKEND_URL (App Hosting env / apphosting.yaml)
 *     to e.g. https://us-central1-<project>.cloudfunctions.net/api
 *   - Development: defaults to the local Functions emulator.
 *
 * Every backend request carries the current user's Firebase ID token in the
 * `X-Auth-Token` header (when signed in). The backend verifies it and rejects
 * unauthenticated calls to `/proxy/*` and `/print/*`. A dedicated header is used
 * (not `Authorization`) so it never collides with the provider key the proxy
 * injects for upstream calls.
 */
import { signInAnonymously } from "firebase/auth";
import { getFirebaseAuth } from "../lib/firebase";

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "childbook-60f89";
const EMULATOR_DEFAULT = `http://127.0.0.1:5001/${PROJECT_ID}/us-central1/api`;

/** Header the backend reads the Firebase ID token from. */
export const AUTH_TOKEN_HEADER = "X-Auth-Token";

export const BACKEND_BASE: string = (() => {
  const explicit = process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, "");
  if (explicit) return explicit;
  if (process.env.NODE_ENV !== "production") return EMULATOR_DEFAULT;
  // Fail FAST: a production bundle without a backend URL would send every API
  // call to the app's own origin and 404. NEXT_PUBLIC_* is inlined at build
  // time, so this throws during `next build` — the deploy fails loudly instead
  // of shipping a silently broken app. Set it in apphosting.yaml.
  throw new Error(
    "NEXT_PUBLIC_BACKEND_URL is not set for a production build. " +
      "Set it in apphosting.yaml (env → NEXT_PUBLIC_BACKEND_URL) to the deployed Functions origin.",
  );
})();

export function backendUrl(path: string): string {
  return BACKEND_BASE + (path.startsWith("/") ? path : `/${path}`);
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
 * Merge the auth token header into an existing `HeadersInit`. Use this for any
 * request that targets the backend so it carries the caller's identity.
 */
export async function withAuthHeaders(headers?: HeadersInit): Promise<Headers> {
  const merged = new Headers(headers);
  const token = await currentIdToken();
  if (token) merged.set(AUTH_TOKEN_HEADER, token);
  return merged;
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
  if (res.status === 401 && (await recoverSession())) {
    return fetch(backendUrl(path), {
      ...init,
      headers: await withAuthHeaders(init?.headers),
    });
  }
  return res;
}
