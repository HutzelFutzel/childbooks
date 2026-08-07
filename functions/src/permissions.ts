/**
 * Admin roles + granular permissions — the backend source of truth.
 *
 * `admins/{uid}` now holds a role (`t1` | `t2` | `admin`) and, for plain
 * admins, a `grants` matrix (see `core/config/permissions.ts` for the shared
 * model). This module is the ONLY place that reads/writes that collection.
 *
 * Migration: this system shipped after admin access already existed for some
 * accounts (bare `admins/{uid}` docs with no `role` field). Rather than
 * require a one-off script to run before anything works, {@link getAdminRecord}
 * lazily promotes any such legacy doc to a permanent `t1` owner the first time
 * it's read — "initial T1 owner will be migrated from current admins" happens
 * automatically, and nobody is ever locked out waiting on a migration step.
 * `scripts/migrate-admins-to-owners.ts` does the same thing explicitly/in bulk
 * for anyone who wants to stamp every doc up front instead.
 */
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import type { NextFunction, Request, Response } from "express";
import { ensureAdmin } from "./storage";
import type { AuthedRequest } from "./auth";
import {
  ALL_PERMISSION_KEYS,
  hasCapability,
  hasPermission,
  isOwner,
  normalizeGrants,
  type AdminRecord,
  type AdminRole,
  type Capability,
  type PermissionKey,
  type PermissionLevel,
} from "../../books-frontend/src/core/config/permissions";

export type {
  AdminRecord,
  AdminRole,
  Capability,
  PermissionKey,
  PermissionLevel,
} from "../../books-frontend/src/core/config/permissions";

const COLLECTION = "admins";
const AUDIT_COLLECTION = "adminAuditLog";

/** Thrown by the CRUD helpers below; routes translate it to `status` + message. */
export class PermissionError extends Error {
  status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.status = status;
    this.name = "PermissionError";
  }
}

function isRole(v: unknown): v is AdminRole {
  return v === "t1" || v === "t2" || v === "admin";
}

function toRecord(uid: string, data: FirebaseFirestore.DocumentData | undefined): AdminRecord {
  const role: AdminRole = isRole(data?.role) ? data.role : "t1"; // legacy doc default
  return {
    uid,
    role,
    grants: normalizeGrants(data?.grants),
    email: typeof data?.email === "string" ? data.email : null,
    displayName: typeof data?.displayName === "string" ? data.displayName : null,
    createdAt: typeof data?.createdAt === "number" ? data.createdAt : Date.now(),
    createdBy: typeof data?.createdBy === "string" ? data.createdBy : "migration",
    updatedAt: typeof data?.updatedAt === "number" ? data.updatedAt : Date.now(),
    updatedBy: typeof data?.updatedBy === "string" ? data.updatedBy : "migration",
  };
}

/**
 * Read one admin's record. Returns null when the caller isn't an admin at
 * all. Backfills legacy (pre-role) docs to a permanent `t1` owner in place.
 */
export async function getAdminRecord(uid: string): Promise<AdminRecord | null> {
  ensureAdmin();
  const ref = getFirestore().doc(`${COLLECTION}/${uid}`);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data();
  const record = toRecord(uid, data);
  if (!isRole(data?.role)) {
    await ref
      .set(
        {
          role: record.role,
          grants: record.grants,
          createdAt: record.createdAt,
          createdBy: record.createdBy,
          updatedAt: Date.now(),
          updatedBy: "migration",
        },
        { merge: true },
      )
      .catch((err) => console.error("[permissions] legacy-doc migration write failed", err));
  }
  return record;
}

/** Every admin/owner, enriched with live Auth email/name for display. T1 first. */
export async function listAdmins(): Promise<AdminRecord[]> {
  ensureAdmin();
  const snap = await getFirestore().collection(COLLECTION).get();
  const records = await Promise.all(
    snap.docs.map(async (d) => {
      const record = toRecord(d.id, d.data());
      try {
        const user = await getAuth().getUser(d.id);
        record.email = user.email ?? record.email;
        record.displayName = user.displayName ?? record.displayName;
      } catch {
        // Auth account gone; keep whatever was last denormalized.
      }
      return record;
    }),
  );
  const order: Record<AdminRole, number> = { t1: 0, t2: 1, admin: 2 };
  return records.sort(
    (a, b) => order[a.role] - order[b.role] || (a.email ?? "").localeCompare(b.email ?? ""),
  );
}

export type AuditAction =
  | "invite_admin"
  | "attach_admin"
  | "remove_admin"
  | "set_grants"
  | "set_role"
  | "pii_reveal";

export interface AuditEntry {
  id: string;
  at: number;
  actorUid: string;
  actorEmail: string | null;
  action: AuditAction;
  targetUid: string;
  targetEmail: string | null;
  details?: Record<string, unknown>;
}

/** Append-only audit trail. Best-effort: a logging failure never blocks the action. */
export async function logAudit(
  actorUid: string,
  action: AuditAction,
  targetUid: string,
  details?: Record<string, unknown>,
): Promise<void> {
  ensureAdmin();
  try {
    const [actor, target] = await Promise.all([
      getAuth().getUser(actorUid).catch(() => null),
      getAuth().getUser(targetUid).catch(() => null),
    ]);
    await getFirestore().collection(AUDIT_COLLECTION).add({
      at: Date.now(),
      actorUid,
      actorEmail: actor?.email ?? null,
      action,
      targetUid,
      targetEmail: target?.email ?? null,
      details: details ?? {},
    });
  } catch (err) {
    console.error("[permissions] audit log write failed", err);
  }
}

export async function listAuditLog(limit = 200): Promise<AuditEntry[]> {
  ensureAdmin();
  const snap = await getFirestore()
    .collection(AUDIT_COLLECTION)
    .orderBy("at", "desc")
    .limit(Math.min(500, Math.max(1, limit)))
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AuditEntry, "id">) }));
}

/**
 * Invite someone by email. If they already have a Firebase Auth account
 * (any provider), they're simply attached as a plain admin with no grants —
 * an owner sets those afterward. If not, a new account is created and a
 * password-set link is emailed to them (see `email/triggers.ts`), so the very
 * first thing they do is choose a password; they land as a plain admin too.
 */
export async function inviteAdmin(actorUid: string, emailInput: string): Promise<AdminRecord> {
  ensureAdmin();
  const email = emailInput.trim().toLowerCase();
  if (!email || !email.includes("@")) throw new PermissionError("Provide a valid email address.", 400);

  let uid: string;
  let displayName: string | null = null;
  let isNewAccount = false;
  try {
    const user = await getAuth().getUserByEmail(email);
    uid = user.uid;
    displayName = user.displayName ?? null;
  } catch (err) {
    if ((err as { code?: string }).code !== "auth/user-not-found") throw err;
    const user = await getAuth().createUser({ email, emailVerified: false });
    uid = user.uid;
    isNewAccount = true;
  }

  const ref = getFirestore().doc(`${COLLECTION}/${uid}`);
  const existing = await ref.get();
  if (existing.exists) throw new PermissionError("That person already has admin access.", 409);

  const now = Date.now();
  const record: AdminRecord = {
    uid,
    role: "admin",
    grants: {},
    email,
    displayName,
    createdAt: now,
    createdBy: actorUid,
    updatedAt: now,
    updatedBy: actorUid,
  };
  await ref.set({
    role: record.role,
    grants: record.grants,
    email,
    displayName,
    createdAt: now,
    createdBy: actorUid,
    updatedAt: now,
    updatedBy: actorUid,
  });
  await logAudit(actorUid, isNewAccount ? "invite_admin" : "attach_admin", uid, { email });

  if (isNewAccount) {
    // Best-effort — the admin record exists either way; email delivery is
    // secondary (the owner can always share a login link manually).
    const { sendAdminInviteEmail } = await import("./email/triggers");
    await sendAdminInviteEmail({ uid, email }).catch((err) =>
      console.warn("[permissions] admin invite email failed", err),
    );
  }
  return record;
}

export async function setGrants(
  actorUid: string,
  targetUid: string,
  grantsInput: unknown,
): Promise<AdminRecord> {
  ensureAdmin();
  const ref = getFirestore().doc(`${COLLECTION}/${targetUid}`);
  const snap = await ref.get();
  if (!snap.exists) throw new PermissionError("No such admin.", 404);
  const current = toRecord(targetUid, snap.data());
  if (isOwner(current.role)) {
    throw new PermissionError("Owners have full access already — there's nothing to grant.", 400);
  }
  const clean = normalizeGrants(grantsInput);
  const now = Date.now();
  await ref.set({ grants: clean, updatedAt: now, updatedBy: actorUid }, { merge: true });
  await logAudit(actorUid, "set_grants", targetUid, { before: current.grants, after: clean });
  return { ...current, grants: clean, updatedAt: now, updatedBy: actorUid };
}

export async function removeAdmin(actorUid: string, targetUid: string): Promise<void> {
  ensureAdmin();
  if (actorUid === targetUid) throw new PermissionError("You can't remove your own admin access.", 400);
  const ref = getFirestore().doc(`${COLLECTION}/${targetUid}`);
  const snap = await ref.get();
  if (!snap.exists) throw new PermissionError("No such admin.", 404);
  const record = toRecord(targetUid, snap.data());
  if (record.role === "t1") throw new PermissionError("A T1 owner can never be removed.", 400);
  await ref.delete();
  await logAudit(actorUid, "remove_admin", targetUid, { role: record.role, email: record.email });
}

/** Change a target's role. Guards: no self-changes, no touching a T1's role. */
export async function setRole(actorUid: string, targetUid: string, role: AdminRole): Promise<AdminRecord> {
  ensureAdmin();
  if (actorUid === targetUid) throw new PermissionError("You can't change your own role.", 400);
  const ref = getFirestore().doc(`${COLLECTION}/${targetUid}`);
  const snap = await ref.get();
  if (!snap.exists) throw new PermissionError("No such admin.", 404);
  const current = toRecord(targetUid, snap.data());
  if (current.role === "t1") throw new PermissionError("A T1 owner's role can never be changed.", 400);
  const now = Date.now();
  // Grants only mean anything for plain admins; owners get implicit full
  // access, so clear the map on promotion (a later demotion starts blank
  // rather than silently reviving a stale, possibly-broad grant set).
  const grants = role === "admin" ? current.grants : {};
  await ref.set({ role, grants, updatedAt: now, updatedBy: actorUid }, { merge: true });
  await logAudit(actorUid, "set_role", targetUid, { before: current.role, after: role });
  return { ...current, role, grants, updatedAt: now, updatedBy: actorUid };
}

// ---- Express middleware -----------------------------------------------------

export interface PermissionedRequest extends AuthedRequest {
  admin?: AdminRecord;
}

function unauthorized(res: Response): void {
  res.status(401).json({ error: { message: "Authentication required." } });
}

async function loadCaller(req: PermissionedRequest): Promise<AdminRecord | null> {
  if (req.admin) return req.admin;
  if (!req.uid) return null;
  const record = await getAdminRecord(req.uid);
  if (record) req.admin = record;
  return record;
}

/** Require read/write on a specific matrix key. Owners always pass. */
export function requirePermission(key: PermissionKey, level: PermissionLevel) {
  return async (req: PermissionedRequest, res: Response, next: NextFunction): Promise<void> => {
    ensureAdmin();
    if (!req.uid) return unauthorized(res);
    try {
      const record = await loadCaller(req);
      if (!record) {
        res.status(403).json({ error: { message: "Admin access required." } });
        return;
      }
      if (!hasPermission(record, key, level)) {
        res.status(403).json({ error: { message: `You don't have ${level} access to ${key}.` } });
        return;
      }
      next();
    } catch (err) {
      res.status(500).json({ error: { message: (err as Error)?.message ?? "Could not verify access." } });
    }
  };
}

/** Require a role-gated capability (never grantable via the matrix). */
export function requireCapability(capability: Capability) {
  return async (req: PermissionedRequest, res: Response, next: NextFunction): Promise<void> => {
    ensureAdmin();
    if (!req.uid) return unauthorized(res);
    try {
      const record = await loadCaller(req);
      if (!record) {
        res.status(403).json({ error: { message: "Admin access required." } });
        return;
      }
      if (!hasCapability(record.role, capability)) {
        res.status(403).json({ error: { message: "You don't have permission to do this." } });
        return;
      }
      next();
    } catch (err) {
      res.status(500).json({ error: { message: (err as Error)?.message ?? "Could not verify access." } });
    }
  };
}

/** Require ANY owner tier (t1 or t2) — used by the whole Permissions page. */
export function requireOwner() {
  return async (req: PermissionedRequest, res: Response, next: NextFunction): Promise<void> => {
    ensureAdmin();
    if (!req.uid) return unauthorized(res);
    try {
      const record = await loadCaller(req);
      if (!record || !isOwner(record.role)) {
        res.status(403).json({ error: { message: "Owner access required." } });
        return;
      }
      next();
    } catch (err) {
      res.status(500).json({ error: { message: (err as Error)?.message ?? "Could not verify access." } });
    }
  };
}

// ---- Generic route → permission gate ---------------------------------------
//
// The permission matrix mirrors the admin nav (one key per tab), but the
// ~150 routes those tabs call were written before this system existed, spread
// across a dozen files. Rather than touch every handler, ONE table maps every
// route to the key/capability it needs, and ONE middleware (mounted once, in
// `app.ts`, right after the existing `requireAdmin` gate) enforces it for
// every request under `/admin/*`. Adding a brand-new admin route later means
// adding one line here — miss it, and the route 403s loudly instead of
// silently staying wide open (unmatched paths fail CLOSED, see the end).

type Gate =
  | { kind: "any" } // any admin/owner — no specific key or capability
  | { kind: "key"; key: PermissionKey; level?: PermissionLevel } // level: override the GET=read/else=write default
  | { kind: "capability"; capability: Capability };

interface RouteRule {
  test: RegExp;
  methods?: string[]; // omit = all methods
  gate: Gate;
}

function key(k: PermissionKey, level?: PermissionLevel): Gate {
  return { kind: "key", key: k, level };
}
function capability(c: Capability): Gate {
  return { kind: "capability", capability: c };
}
const ANY: Gate = { kind: "any" };

// Order matters: first match wins, most-specific first.
const ROUTE_RULES: RouteRule[] = [
  // The Permissions page and its API gate themselves (requireOwner /
  // requireCapability inside permissionsRoutes.ts) — never double-gated here.
  { test: /^\/admin\/permissions(\/|$)/, gate: ANY },

  // Bootstrap / low-risk shared endpoints — any admin, no matrix key.
  { test: /^\/admin\/me$/, gate: ANY },
  { test: /^\/admin\/settings$/, gate: ANY },

  // System Health: secret-binding status is T1-only; the sandbox↔live switch
  // and print-provider ops are "dangerous" (T1 + T2, per the explicit call
  // that T2 can flip billing envs and approve held payouts).
  { test: /^\/admin\/health$/, gate: capability("secrets") },
  { test: /^\/admin\/runtime$/, gate: capability("dangerous") },
  { test: /^\/admin\/readiness$/, gate: capability("dangerous") },
  { test: /^\/admin\/print\/webhooks(\/|$)/, gate: capability("dangerous") },
  { test: /^\/admin\/print\/sync$/, gate: capability("dangerous") },

  // GDPR: looking a user up is low-risk (needed just to navigate the tab);
  // export + erase are irreversible/highly sensitive → "dangerous".
  { test: /^\/admin\/users\/lookup$/, gate: key("legal.gdpr", "read") },
  { test: /^\/admin\/users\/[^/]+\/export$/, gate: capability("dangerous") },
  { test: /^\/admin\/users\/[^/]+$/, methods: ["DELETE"], gate: capability("dangerous") },
  { test: /^\/admin\/users\/[^/]+\/sparks$/, gate: key("analysis.users", "write") },

  // Held payouts / clawbacks — "approving held payouts" is explicitly dangerous.
  { test: /^\/admin\/campaigns\/redemptions\/[^/]+\/(release|void)$/, gate: capability("dangerous") },
  { test: /^\/admin\/referrals\/rewards\/[^/]+\/(release|decline)$/, gate: capability("dangerous") },
  { test: /^\/admin\/referrals\/void-unaccepted$/, gate: capability("dangerous") },

  // Configuration → AI.
  { test: /^\/admin\/config\/models$/, gate: key("configuration.models") },
  { test: /^\/admin\/config\/model-costs$/, gate: key("configuration.modelCosts") },
  { test: /^\/admin\/suggest-costs?$/, gate: key("configuration.modelCosts", "read") },
  { test: /^\/admin\/config\/prompts$/, gate: key("configuration.prompts") },
  { test: /^\/admin\/config$/, gate: key("configuration.modelCosts", "read") },

  // Configuration → Creative.
  { test: /^\/admin\/config\/art-styles$/, gate: key("configuration.artStyles") },
  { test: /^\/admin\/art-styles\/[^/]+\/image$/, gate: key("configuration.artStyles", "write") },
  { test: /^\/admin\/config\/layouts$/, gate: key("configuration.layouts") },
  { test: /^\/admin\/layouts\/[^/]+\/image$/, gate: key("configuration.layouts", "write") },
  { test: /^\/admin\/config\/age-writing$/, gate: key("configuration.ageWriting") },
  { test: /^\/admin\/config\/story-craft$/, gate: key("configuration.storyCraft") },
  { test: /^\/admin\/config\/typography$/, gate: key("configuration.typography") },

  // Configuration → Business.
  { test: /^\/admin\/config\/pricing-settings$/, gate: key("configuration.financial") },
  { test: /^\/admin\/config\/products\/margin-preview$/, gate: key("configuration.financial", "read") },
  { test: /^\/admin\/config\/products\/verify$/, gate: key("configuration.catalog", "read") },
  { test: /^\/admin\/config\/products(\/|$)/, gate: key("configuration.catalog") },
  { test: /^\/admin\/print\/sku\/check$/, gate: key("configuration.catalog", "read") },
  { test: /^\/admin\/print\/sku\/matrix$/, gate: key("configuration.catalog", "read") },
  { test: /^\/admin\/catalog\/media(\/|$)/, gate: key("configuration.catalog") },
  { test: /^\/admin\/config\/sparks$/, gate: key("configuration.sparks") },
  { test: /^\/admin\/config\/plans(\/|$)/, gate: key("configuration.memberships") },

  // Marketing → Growth.
  { test: /^\/admin\/config\/referral$/, gate: key("marketing.referrals") },
  { test: /^\/admin\/referrals\/invitations\/[^/]+\/block$/, gate: key("marketing.referrals", "write") },
  { test: /^\/admin\/referrals\/stats$/, gate: key("analysis.referrals", "read") },
  { test: /^\/admin\/config\/affiliates$/, gate: key("marketing.affiliates") },
  { test: /^\/admin\/affiliates\/overview$/, gate: key("analysis.affiliates", "read") },
  { test: /^\/admin\/affiliates\/sync$/, gate: key("analysis.affiliates", "write") },
  { test: /^\/admin\/config\/campaigns$/, gate: key("marketing.campaigns") },
  { test: /^\/admin\/campaigns\/simulate$/, gate: key("marketing.campaigns", "read") },
  { test: /^\/admin\/campaigns\/[^/]+\/report$/, gate: key("analysis.campaigns", "read") },
  { test: /^\/admin\/campaigns\/held$/, gate: key("analysis.campaigns", "read") },
  { test: /^\/admin\/config\/surveys$/, gate: key("marketing.surveys") },
  { test: /^\/admin\/surveys\/report$/, gate: key("analysis.surveys", "read") },

  // Marketing → Site & content.
  { test: /^\/admin\/config\/announcements$/, gate: key("marketing.announcements") },
  { test: /^\/admin\/config\/seo$/, gate: key("marketing.seo") },
  { test: /^\/admin\/blog\/stats$/, gate: key("marketing.blog", "read") },
  { test: /^\/admin\/blog\/[^/]+\/stats$/, gate: key("marketing.blog", "read") },
  { test: /^\/admin\/blog(\/|$)/, gate: key("marketing.blog") },
  { test: /^\/admin\/branding(\/|$)/, gate: key("marketing.branding") },
  { test: /^\/admin\/site-images?(\/|$)/, gate: key("marketing.branding") },
  { test: /^\/admin\/site-content(\/|$)/, gate: key("marketing.branding") },
  { test: /^\/admin\/qrcodes(\/|$)/, gate: key("marketing.qrCodes") },

  // Analysis (view-only surfaces the matrix still separately write-gates,
  // e.g. resolving an alert or importing a cost import).
  { test: /^\/admin\/analytics\/users\/[^/]+\/reveal$/, gate: key("analysis.users.pii", "read") },
  { test: /^\/admin\/analytics\/users$/, gate: key("analysis.users", "read") },
  { test: /^\/admin\/analytics\/overview$/, gate: key("analysis.users", "read") },
  { test: /^\/admin\/analytics\/funnel$/, gate: key("analysis.users", "read") },
  { test: /^\/admin\/analytics\/products$/, gate: key("analysis.products", "read") },
  { test: /^\/admin\/analytics\/action-costs$/, gate: key("analysis.costs", "read") },
  { test: /^\/admin\/projects(\/|$)/, gate: key("analysis.projects", "read") },
  { test: /^\/admin\/runs(\/|$)/, gate: key("analysis.projects", "read") },
  { test: /^\/admin\/finance\/summary$/, gate: key("analysis.finance", "read") },
  { test: /^\/admin\/finance\/print-calibration$/, gate: key("analysis.finance", "read") },
  { test: /^\/admin\/finance\/infra\/import$/, gate: key("analysis.finance", "write") },
  { test: /^\/admin\/finance\/custom-costs(\/|$)/, gate: key("analysis.finance") },
  { test: /^\/admin\/alerts\/[^/]+\/resolve$/, gate: key("analysis.finance", "write") },
  { test: /^\/admin\/alerts$/, gate: key("analysis.finance", "read") },
  { test: /^\/admin\/fulfillment\/retry$/, gate: key("analysis.finance", "write") },
  { test: /^\/admin\/payments\/[^/]+\/refund$/, gate: key("analysis.payments", "write") },
  { test: /^\/admin\/payments(\/|$)/, gate: key("analysis.payments", "read") },
  { test: /^\/admin\/stripe\/health$/, gate: key("analysis.payments", "read") },

  // Communication.
  { test: /^\/admin\/contact\/messages\/[^/]+\/handled$/, gate: key("communication.contact", "write") },
  { test: /^\/admin\/contact\/messages$/, gate: key("communication.contact", "read") },
  { test: /^\/admin\/contact\/test$/, gate: key("communication.contact", "write") },
  { test: /^\/admin\/config\/email$/, gate: key("communication.transactional-emails") },
  { test: /^\/admin\/email\/test$/, gate: key("communication.transactional-emails", "write") },
  { test: /^\/admin\/config\/slack$/, gate: key("communication.admin-slack") },
  { test: /^\/admin\/slack\/test$/, gate: key("communication.admin-slack", "write") },

  // Legal.
  { test: /^\/admin\/config\/legal$/, gate: key("legal.documents") },
  { test: /^\/admin\/legal\/notify$/, gate: key("legal.documents", "write") },
  { test: /^\/admin\/config\/cookies$/, gate: key("legal.cookies") },
];

function levelFor(method: string, override: PermissionLevel | undefined): PermissionLevel {
  if (override) return override;
  return method === "GET" || method === "HEAD" ? "read" : "write";
}

/**
 * Mounted once on `/admin` (after `requireVerified` + the base `requireAdmin`
 * gate). Looks up the request path in {@link ROUTE_RULES} and enforces the
 * matching key/capability; unmatched paths fail CLOSED (403 + a loud
 * server-side warning) rather than silently falling back to "any admin".
 */
export function permissionGate() {
  return async (req: PermissionedRequest, res: Response, next: NextFunction): Promise<void> => {
    // Express strips the `/admin` mount prefix from `req.path` for the
    // duration of a middleware mounted via `app.use("/admin", ...)` (it moves
    // into `req.baseUrl` instead) — every ROUTE_RULES entry is anchored on the
    // full `/admin/...` path, so it has to be reassembled here or NOTHING ever
    // matches and every request fails closed.
    const path = req.baseUrl + req.path;
    const rule = ROUTE_RULES.find(
      (r) => r.test.test(path) && (!r.methods || r.methods.includes(req.method)),
    );
    if (!rule) {
      console.warn(`[permissions] no route rule for ${req.method} ${path} — denying by default.`);
      res.status(403).json({
        error: { message: "This action isn't mapped to a permission yet. Ask a T1 owner to check the route table." },
      });
      return;
    }
    if (rule.gate.kind === "any") {
      next();
      return;
    }
    if (rule.gate.kind === "capability") {
      return requireCapability(rule.gate.capability)(req, res, next);
    }
    const level = levelFor(req.method, rule.gate.level);
    return requirePermission(rule.gate.key, level)(req, res, next);
  };
}
