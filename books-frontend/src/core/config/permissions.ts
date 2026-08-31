/**
 * The admin permission model — shared by the backend (route enforcement) and
 * the frontend (nav gating + read-only rendering). Pure data + pure functions
 * only: no Firebase, no React, so it's safe to import from either side of the
 * `functions/` ↔ `books-frontend/` boundary.
 *
 * Three roles:
 *   - `t1`  — the founder tier. Can do everything, including managing owners.
 *     Permanent: nobody (including another t1, including themselves) can ever
 *     demote or remove a t1 account. Migration promotes every admin that
 *     existed before this system shipped to t1 (see `functions/src/permissions.ts`).
 *   - `t2`  — a full operating owner. Same reach as an admin with every grant
 *     at `write`, plus managing admins (invite/grants/remove) — but CANNOT see
 *     secrets, and CANNOT touch the owner tier (create/remove/promote/demote
 *     t1 or t2). Cannot demote or remove themselves.
 *   - `admin` — only what's in their `grants` map, at the level granted there.
 *     Never sees secrets, never manages other admins, never sees this file's
 *     matrix for themselves (the Permissions page is owner-only).
 *
 * `grants` is ignored for t1/t2 (their access is implicit and total, modulo
 * the two role-gated capabilities above) — it only matters for `admin`.
 */

import type {
  ConfigTabId,
  MarketingTabId,
  AnalysisTabId,
  CommunicationTabId,
  LegalTabId,
} from "../../ui/admin/adminTabStore";

export type AdminRole = "t1" | "t2" | "admin";
export type PermissionLevel = "read" | "write";

export const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  t1: "Owner (T1)",
  t2: "Owner (T2)",
  admin: "Admin",
};

/**
 * One permission key per nav leaf, namespaced by top-level section so the same
 * domain can be gated differently for editing it (Marketing) vs. reading its
 * metrics (Analysis) — e.g. `marketing.campaigns` (can edit campaign rules) is
 * a different grant from `analysis.campaigns` (can see campaign results).
 *
 * Plus two extra, non-nav keys for capabilities that don't map to a whole tab:
 * `analysis.users.pii` unmasks row-level customer identity in the Users table
 * (see `functions/src/analytics.ts`); everything else on that tab (aggregate
 * counts, revenue, buyer-profile segments) only needs `analysis.users`.
 *
 * Hand-maintained (not derived from the nav arrays, to avoid pulling
 * React-bearing modules into the backend bundle) — kept in sync with
 * `adminTabStore.ts` by the compile-time exhaustiveness check right below and
 * `scripts/permission-invariants.ts`.
 */
export type PermissionKey =
  | `configuration.${ConfigTabId}`
  | `marketing.${MarketingTabId}`
  | `analysis.${AnalysisTabId}`
  | `communication.${CommunicationTabId}`
  | `legal.${LegalTabId}`
  | "analysis.users.pii";

// Each map below is a real object literal, so TypeScript enforces it has
// EXACTLY the keys of its tab-id union — add/remove/rename a tab in
// `adminTabStore.ts` without updating the matching map here and this file
// fails to compile. That's the compile-time trip wire; the arrays used to
// build `ALL_PERMISSION_KEYS` are just `Object.keys()` of these maps.
const CONFIG_TAB_EXHAUSTIVE: Record<ConfigTabId, true> = {
  overview: true,
  catalog: true,
  memberships: true,
  sparks: true,
  financial: true,
  discounts: true,
  markets: true,
  models: true,
  modelCosts: true,
  prompts: true,
  artStyles: true,
  layouts: true,
  ageWriting: true,
  storyCraft: true,
  bookLanguages: true,
  typography: true,
  system: true,
};
const MARKETING_TAB_EXHAUSTIVE: Record<MarketingTabId, true> = {
  referrals: true,
  affiliates: true,
  campaigns: true,
  surveys: true,
  announcements: true,
  seo: true,
  blog: true,
  branding: true,
  qrCodes: true,
};
const ANALYSIS_TAB_EXHAUSTIVE: Record<AnalysisTabId, true> = {
  users: true,
  projects: true,
  devices: true,
  costs: true,
  finance: true,
  payments: true,
  products: true,
  referrals: true,
  affiliates: true,
  campaigns: true,
  surveys: true,
};
const COMMUNICATION_TAB_EXHAUSTIVE: Record<CommunicationTabId, true> = {
  contact: true,
  "transactional-emails": true,
  "admin-slack": true,
};
const LEGAL_TAB_EXHAUSTIVE: Record<LegalTabId, true> = {
  documents: true,
  cookies: true,
  gdpr: true,
};

/**
 * `configuration.system` (System Health: secret-binding status, the
 * sandbox↔live switch, print-webhook plumbing) is deliberately NOT grantable
 * to a plain admin — it's owner-only by nature (split further into the
 * `secrets` and `dangerous` capabilities at the route level; see
 * `functions/src/permissions.ts`), so it's excluded from the matrix a T1/T2
 * owner would even offer an admin. T1/T2 still reach it via the `isOwner`
 * bypass in `hasPermission`.
 */
const NOT_GRANTABLE = new Set<PermissionKey>(["configuration.system"]);

/** Every permission key that exists (including the non-grantable ones). */
const EVERY_PERMISSION_KEY: PermissionKey[] = [
  ...(Object.keys(CONFIG_TAB_EXHAUSTIVE) as ConfigTabId[]).map((t) => `configuration.${t}` as PermissionKey),
  ...(Object.keys(MARKETING_TAB_EXHAUSTIVE) as MarketingTabId[]).map(
    (t) => `marketing.${t}` as PermissionKey,
  ),
  ...(Object.keys(ANALYSIS_TAB_EXHAUSTIVE) as AnalysisTabId[]).map((t) => `analysis.${t}` as PermissionKey),
  "analysis.users.pii",
  ...(Object.keys(COMMUNICATION_TAB_EXHAUSTIVE) as CommunicationTabId[]).map(
    (t) => `communication.${t}` as PermissionKey,
  ),
  ...(Object.keys(LEGAL_TAB_EXHAUSTIVE) as LegalTabId[]).map((t) => `legal.${t}` as PermissionKey),
];

/** Every grantable permission key, flattened for the Permissions-page matrix. */
export const ALL_PERMISSION_KEYS: PermissionKey[] = EVERY_PERMISSION_KEY.filter(
  (key) => !NOT_GRANTABLE.has(key),
);

/**
 * Role-gated capabilities that are NEVER part of the `grants` matrix — an
 * owner can't hand these to a plain admin just by ticking a "write" box, no
 * matter which section it's on.
 *
 *   - `manage_owners`   create/promote/demote/remove t1 or t2 accounts. t1 only.
 *   - `manage_admins`   invite/grant/remove plain admins. t1 + t2.
 *   - `secrets`         the handful of fields/actions that touch webhook
 *                       secrets or delivery credentials (email + Slack
 *                       integration config, their "send test" actions). t1 only.
 *   - `dangerous`       irreversible or money-moving actions that shouldn't be
 *                       gated by a simple write grant: the sandbox↔live
 *                       billing switch, GDPR export/erase, and releasing/
 *                       voiding held campaign or referral payouts. t1 + t2.
 */
export type Capability = "manage_owners" | "manage_admins" | "secrets" | "dangerous";

export function isOwner(role: AdminRole): boolean {
  return role === "t1" || role === "t2";
}

export function isT1(role: AdminRole): boolean {
  return role === "t1";
}

export function hasCapability(role: AdminRole, capability: Capability): boolean {
  switch (capability) {
    case "manage_owners":
      return role === "t1";
    case "secrets":
      return role === "t1";
    case "manage_admins":
    case "dangerous":
      return isOwner(role);
    default:
      return false;
  }
}

/** An admin/owner's full access record — the shape of `admins/{uid}`. */
export interface AdminRecord {
  uid: string;
  role: AdminRole;
  /** Ignored for t1/t2 (implicit full access to every matrix key). */
  grants: Partial<Record<PermissionKey, PermissionLevel>>;
  email: string | null;
  displayName: string | null;
  createdAt: number;
  createdBy: string;
  updatedAt: number;
  updatedBy: string;
}

/** Whether `record` can act at `level` on `key` — the one check every route asks. */
export function hasPermission(
  record: AdminRecord,
  key: PermissionKey,
  level: PermissionLevel,
): boolean {
  if (isOwner(record.role)) return true;
  const granted = record.grants[key];
  if (!granted) return false;
  return level === "read" ? true : granted === "write"; // write implies read
}

/** Read access to at least one key under a section (drives "hide the whole section"). */
export function hasAnySectionAccess(record: AdminRecord, prefix: string): boolean {
  if (isOwner(record.role)) return true;
  return ALL_PERMISSION_KEYS.some(
    (key) => key.startsWith(`${prefix}.`) && hasPermission(record, key, "read"),
  );
}

export function normalizeGrants(
  input: unknown,
): Partial<Record<PermissionKey, PermissionLevel>> {
  const out: Partial<Record<PermissionKey, PermissionLevel>> = {};
  if (!input || typeof input !== "object") return out;
  const record = input as Record<string, unknown>;
  for (const key of ALL_PERMISSION_KEYS) {
    const v = record[key];
    if (v === "read" || v === "write") out[key] = v;
  }
  return out;
}

/** A `mailto:`-safe, still-recognizable mask (`j***@example.com`) for PII rows. */
export function maskEmail(email: string | null): string | null {
  if (!email) return email;
  const at = email.indexOf("@");
  if (at <= 1) return "***" + email.slice(at);
  return email.slice(0, 1) + "***" + email.slice(at);
}

/** First-initial mask (`J. ***`) for a display name — enough to skim, not to dox. */
export function maskDisplayName(name: string | null): string | null {
  if (!name) return name;
  const trimmed = name.trim();
  if (!trimmed) return name;
  return trimmed.slice(0, 1).toUpperCase() + ". ***";
}
