/**
 * Firebase ID-token verification for the `api` function.
 *
 * The browser sends the current user's ID token in the `X-Auth-Token` header
 * (a dedicated header so it never collides with the `Authorization` the proxy
 * uses for upstream provider keys). `attachUser` verifies it with the Admin SDK
 * and stamps `req.uid`; `requireAuth` rejects requests that lack a valid token.
 *
 * Auth uses Application Default Credentials. Against the Auth emulator,
 * verifyIdToken works automatically because the Functions emulator sets
 * FIREBASE_AUTH_EMULATOR_HOST.
 */
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import type { NextFunction, Request, Response } from "express";
import { ensureAdmin } from "./storage";
import { refreshRuntimeEnv } from "./runtimeConfig";
import { patchLogContext } from "./logs";

/**
 * Why a request has no authenticated user. Lets the client pick the right
 * recovery (refresh vs. re-establish a session vs. ask the user to sign in)
 * instead of guessing from a bare 401.
 *   - missing:  no token was sent
 *   - expired:  the ID token is past its lifetime — a refresh fixes it
 *   - revoked:  the user's sessions were invalidated (password change, sign-out
 *               everywhere, or the Auth emulator being restarted with `--import`)
 *               — a refresh will NOT help, the user has to sign in again
 *   - disabled: the account was disabled
 *   - invalid:  malformed / wrong project / bad signature
 */
export type AuthFailure = "missing" | "expired" | "revoked" | "disabled" | "invalid";

export interface AuthedRequest extends Request {
  uid?: string;
  authToken?: DecodedIdToken;
  /** Set (instead of `uid`) when a token was missing or rejected. */
  authFailure?: AuthFailure;
}

/** Stable `error.code` values the browser switches on (see `platform/backend.ts`). */
const AUTH_FAILURE_CODES: Record<AuthFailure, string> = {
  missing: "auth_required",
  expired: "session_expired",
  revoked: "session_revoked",
  disabled: "account_disabled",
  invalid: "session_invalid",
};

function classifyAuthError(err: unknown): AuthFailure {
  switch ((err as { code?: string } | null)?.code) {
    case "auth/id-token-expired":
      return "expired";
    case "auth/id-token-revoked":
      return "revoked";
    case "auth/user-disabled":
      return "disabled";
    default:
      return "invalid";
  }
}

/**
 * Send the standard 401. The `code` tells the client WHY (see {@link AuthFailure});
 * the message stays human-readable for any caller that just shows it.
 */
export function unauthenticated(req: AuthedRequest, res: Response): void {
  const failure = req.authFailure ?? "missing";
  res.status(401).json({
    error: { message: "Authentication required.", code: AUTH_FAILURE_CODES[failure] },
  });
}

const AUTH_HEADER = "x-auth-token";

function extractToken(req: Request): string | null {
  const dedicated = req.get(AUTH_HEADER);
  if (dedicated) return dedicated.trim();
  // Fallback: Authorization: Bearer <token>
  const authz = req.get("authorization");
  if (authz?.toLowerCase().startsWith("bearer ")) return authz.slice(7).trim();
  return null;
}

/** Verify the token if present (never rejects). Stamps `req.uid` on success. */
export async function attachUser(
  req: AuthedRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  ensureAdmin();
  // Warm the sandbox↔live override cache (TTL-throttled) so the synchronous
  // serverConfig() consulted by downstream handlers reflects the active env.
  await refreshRuntimeEnv().catch(() => {});
  const token = extractToken(req);
  if (token) {
    try {
      const decoded = await getAuth().verifyIdToken(token);
      req.uid = decoded.uid;
      req.authToken = decoded;
      patchLogContext({ uid: decoded.uid });
    } catch (err) {
      // Invalid/expired token → treated as unauthenticated, but remember WHY so
      // the 401 can say so. Expiry is routine (the client refreshes); anything
      // else is worth a log line, since this used to fail silently.
      const failure = classifyAuthError(err);
      req.authFailure = failure;
      if (failure !== "expired") {
        console.warn(
          `[auth] rejected ID token (${failure}) on ${req.method} ${req.path}:`,
          (err as { code?: string; message?: string })?.code ?? (err as Error)?.message,
        );
      }
    }
  } else {
    req.authFailure = "missing";
  }
  next();
}

/** Reject the request unless a user is attached. */
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!req.uid) {
    unauthenticated(req, res);
    return;
  }
  next();
}

/**
 * Reject the request unless a VERIFIED, non-anonymous user is attached. Used to
 * guard the provider proxy and fulfillment: only fully signed-up users with a
 * verified email may spend provider credits or place print orders.
 */
export function requireVerified(req: AuthedRequest, res: Response, next: NextFunction): void {
  const token = req.authToken;
  if (!req.uid || !token) {
    unauthenticated(req, res);
    return;
  }
  // Dev convenience: the emulator can't send verification emails, so don't block
  // local testing — any signed-in caller is allowed when running emulated.
  if (process.env.FUNCTIONS_EMULATOR === "true") {
    next();
    return;
  }
  const provider = (token.firebase as { sign_in_provider?: string } | undefined)?.sign_in_provider;
  if (provider === "anonymous" || token.email_verified !== true) {
    res.status(403).json({ error: { message: "Please verify your email to continue." } });
    return;
  }
  next();
}

/** True when the verified token belongs to an anonymous (guest) session. */
export function isAnonymousToken(token: DecodedIdToken | undefined): boolean {
  const provider = (token?.firebase as { sign_in_provider?: string } | undefined)?.sign_in_provider;
  return provider === "anonymous";
}

/**
 * True when the token's email is verified. Mirrors {@link requireVerified}'s
 * emulator convenience: local testing can't send verification emails, so any
 * non-anonymous emulated caller counts as verified.
 */
export function isVerifiedToken(token: DecodedIdToken | undefined): boolean {
  if (!token || isAnonymousToken(token)) return false;
  if (process.env.FUNCTIONS_EMULATOR === "true") return true;
  return token.email_verified === true;
}

/**
 * Whether a uid belongs to an anonymous (guest) account — the Admin-SDK lookup
 * for paths that only have a uid (e.g. the job queue), not a request token.
 * Fails closed (treated as guest) so a lookup hiccup can't unlock credit.
 */
export async function isAnonymousUid(uid: string): Promise<boolean> {
  ensureAdmin();
  try {
    const user = await getAuth().getUser(uid);
    return user.providerData.length === 0;
  } catch {
    return true;
  }
}

/**
 * Reject the request unless the caller is an admin. The source of truth is a
 * Firestore `admins/{uid}` document (set in the Firebase console), read with the
 * Admin SDK. This is the authoritative gate for every admin write — the client
 * `isAdmin` flag is only cosmetic. Must run AFTER `attachUser`.
 */
export async function requireAdmin(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  ensureAdmin();
  if (!req.uid) {
    unauthenticated(req, res);
    return;
  }
  try {
    const snap = await getFirestore().doc(`admins/${req.uid}`).get();
    if (!snap.exists) {
      res.status(403).json({ error: { message: "Admin access required." } });
      return;
    }
  } catch {
    res.status(500).json({ error: { message: "Could not verify admin access." } });
    return;
  }
  next();
}

/** Whether the caller is an admin (no rejection); stamps nothing. */
export async function isAdminUid(uid: string): Promise<boolean> {
  ensureAdmin();
  try {
    const snap = await getFirestore().doc(`admins/${uid}`).get();
    return snap.exists;
  } catch {
    return false;
  }
}
