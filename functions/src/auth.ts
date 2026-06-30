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

export interface AuthedRequest extends Request {
  uid?: string;
  authToken?: DecodedIdToken;
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
    } catch {
      // Invalid/expired token → treated as unauthenticated.
    }
  }
  next();
}

/** Reject the request unless a user is attached. */
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!req.uid) {
    res.status(401).json({ error: { message: "Authentication required." } });
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
    res.status(401).json({ error: { message: "Authentication required." } });
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
    res.status(401).json({ error: { message: "Authentication required." } });
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
