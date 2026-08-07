/**
 * Client store for the admin permission system — every admin's own access
 * (fetched once per session) plus, for owners, the full roster + audit log
 * the Permissions page renders.
 *
 * The backend is the enforcement boundary (`functions/src/permissions.ts`);
 * this store only drives what the UI shows — hiding nav an admin can't reach,
 * rendering read-only where they can only read, and (for owners) the
 * grant-matrix editor. A stale or tampered client value can never grant real
 * access: every write still re-checks the caller's `admins/{uid}` doc.
 */
import { create } from "zustand";
import { backendFetch } from "../platform/backend";
import {
  hasCapability,
  hasPermission,
  isOwner as isOwnerRole,
  isT1 as isT1Role,
  type AdminRecord,
  type AdminRole,
  type Capability,
  type PermissionKey,
  type PermissionLevel,
} from "../core/config/permissions";

export interface AuditEntry {
  id: string;
  at: number;
  actorUid: string;
  actorEmail: string | null;
  action: string;
  targetUid: string;
  targetEmail: string | null;
  details?: Record<string, unknown>;
}

interface AdminAccessState {
  loading: boolean;
  loaded: boolean;
  error: string | null;
  me: AdminRecord | null;
  capabilities: Record<Capability, boolean>;
  admins: AdminRecord[];
  adminsLoading: boolean;
  adminsLoaded: boolean;
  auditLog: AuditEntry[];
  auditLoading: boolean;
  /**
   * Owner-only nav preview: render the dashboard as if it were this uid's
   * grants. Every real request still runs under the owner's OWN access
   * (impersonation never touches the backend), and while this is set every
   * `canWrite` check returns false — it's a look, not a login.
   */
  viewAsUid: string | null;

  init: () => Promise<void>;
  loadAdmins: () => Promise<void>;
  loadAuditLog: (limit?: number) => Promise<void>;
  invite: (email: string) => Promise<AdminRecord>;
  saveGrants: (
    uid: string,
    grants: Partial<Record<PermissionKey, PermissionLevel>>,
  ) => Promise<void>;
  removeAdmin: (uid: string) => Promise<void>;
  setRole: (uid: string, role: AdminRole) => Promise<void>;
  setViewAsUid: (uid: string | null) => void;

  canRead: (key: PermissionKey) => boolean;
  canWrite: (key: PermissionKey) => boolean;
  can: (capability: Capability) => boolean;
  isOwner: () => boolean;
  isT1: () => boolean;
  /** Who else can read/write a given key — for the owner-only "shared with" panel. */
  sharedWith: (key: PermissionKey) => { record: AdminRecord; level: PermissionLevel }[];
}

async function getJson<T>(path: string): Promise<T> {
  const res = await backendFetch(path);
  if (!res.ok) throw new Error((await safeError(res)) ?? "Request failed.");
  return (await res.json()) as T;
}

async function sendJson<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await backendFetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await safeError(res)) ?? "Request failed.");
  return (await res.json()) as T;
}

async function safeError(res: Response): Promise<string | null> {
  try {
    const json = (await res.json()) as { error?: { message?: string } };
    return json.error?.message ?? null;
  } catch {
    return null;
  }
}

const NO_CAPABILITIES: Record<Capability, boolean> = {
  manage_owners: false,
  manage_admins: false,
  secrets: false,
  dangerous: false,
};

export const useAdminAccess = create<AdminAccessState>((set, get) => ({
  loading: false,
  loaded: false,
  error: null,
  me: null,
  capabilities: NO_CAPABILITIES,
  admins: [],
  adminsLoading: false,
  adminsLoaded: false,
  auditLog: [],
  auditLoading: false,
  viewAsUid: null,

  async init() {
    if (get().loaded || get().loading) return;
    set({ loading: true, error: null });
    try {
      const data = await getJson<{
        admin: AdminRecord;
        capabilities: Record<Capability, boolean>;
      }>("/admin/permissions/me");
      set({ me: data.admin, capabilities: data.capabilities, loaded: true });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Could not load your admin access." });
    } finally {
      set({ loading: false });
    }
  },

  async loadAdmins() {
    if (!get().isOwner()) return;
    set({ adminsLoading: true });
    try {
      const data = await getJson<{ admins: AdminRecord[] }>("/admin/permissions/admins");
      set({ admins: data.admins, adminsLoaded: true });
    } finally {
      set({ adminsLoading: false });
    }
  },

  async loadAuditLog(limit = 200) {
    if (!get().isOwner()) return;
    set({ auditLoading: true });
    try {
      const data = await getJson<{ entries: AuditEntry[] }>(
        `/admin/permissions/audit-log?limit=${limit}`,
      );
      set({ auditLog: data.entries });
    } finally {
      set({ auditLoading: false });
    }
  },

  async invite(email) {
    const data = await sendJson<{ admin: AdminRecord }>("/admin/permissions/invite", "POST", { email });
    set({ admins: [...get().admins, data.admin] });
    return data.admin;
  },

  async saveGrants(uid, grants) {
    const data = await sendJson<{ admin: AdminRecord }>(
      `/admin/permissions/admins/${encodeURIComponent(uid)}/grants`,
      "PUT",
      { grants },
    );
    set({ admins: get().admins.map((a) => (a.uid === uid ? data.admin : a)) });
  },

  async removeAdmin(uid) {
    await sendJson(`/admin/permissions/admins/${encodeURIComponent(uid)}`, "DELETE");
    set({ admins: get().admins.filter((a) => a.uid !== uid) });
  },

  async setRole(uid, role) {
    const data = await sendJson<{ admin: AdminRecord }>(
      `/admin/permissions/admins/${encodeURIComponent(uid)}/role`,
      "POST",
      { role },
    );
    set({ admins: get().admins.map((a) => (a.uid === uid ? data.admin : a)) });
  },

  setViewAsUid(uid) {
    set({ viewAsUid: uid });
  },

  canRead(key) {
    const { me, admins, viewAsUid } = get();
    const effective = viewAsUid ? admins.find((a) => a.uid === viewAsUid) ?? me : me;
    if (!effective) return false;
    return hasPermission(effective, key, "read");
  },

  canWrite(key) {
    const { me, admins, viewAsUid } = get();
    if (viewAsUid) return false; // preview is look-only, never act-as
    if (!me) return false;
    return hasPermission(me, key, "write");
  },

  can(capability) {
    const { me, viewAsUid, admins } = get();
    const effective = viewAsUid ? admins.find((a) => a.uid === viewAsUid) ?? me : me;
    if (!effective) return false;
    return hasCapability(effective.role, capability);
  },

  isOwner() {
    const me = get().me;
    return Boolean(me && isOwnerRole(me.role));
  },

  isT1() {
    const me = get().me;
    return Boolean(me && isT1Role(me.role));
  },

  sharedWith(key) {
    const { admins } = get();
    const out: { record: AdminRecord; level: PermissionLevel }[] = [];
    for (const record of admins) {
      if (isOwnerRole(record.role)) {
        out.push({ record, level: "write" }); // owners always have full access
        continue;
      }
      const level = record.grants[key];
      if (level) out.push({ record, level });
    }
    return out;
  },
}));
