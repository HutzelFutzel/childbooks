"use client";

/**
 * The owner-only Permissions page: who has access to this dashboard, at what
 * tier, and — for plain admins — exactly which sections/tabs they can read or
 * write. Never reachable by a plain admin (gated in `AdminApp.tsx` by
 * `useAdminAccess().isOwner()`, and the API refuses non-owners regardless).
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Crown,
  Eye,
  KeyRound,
  Loader2,
  Mail,
  Shield,
  ShieldCheck,
  Trash2,
  UserPlus,
} from "lucide-react";
import { Button } from "../../components/Button";
import { Card, CardBody, CardHeader, CardTitle } from "../../components/Card";
import { Field, Input } from "../../components/Input";
import { Select } from "../../components/Select";
import { Modal } from "../../components/Modal";
import { TabIntro, Section } from "./products/parts";
import { useAdminAccess, type AuditEntry } from "../../../state/adminAccessStore";
import {
  ADMIN_ROLE_LABELS,
  ALL_PERMISSION_KEYS,
  type AdminRecord,
  type AdminRole,
  type PermissionKey,
  type PermissionLevel,
} from "../../../core/config/permissions";
import { CONFIG_TAB_META, ANALYSIS_TAB_META, MARKETING_TAB_META, COMMUNICATION_TABS, LEGAL_TABS } from "../adminNav";

function tabLabel(key: PermissionKey): string {
  if (key === "analysis.users.pii") return "Reveal customer PII (real email)";
  const dot = key.indexOf(".");
  const prefix = key.slice(0, dot);
  const rest = key.slice(dot + 1);
  switch (prefix) {
    case "configuration":
      return CONFIG_TAB_META[rest as keyof typeof CONFIG_TAB_META]?.label ?? rest;
    case "marketing":
      return MARKETING_TAB_META[rest as keyof typeof MARKETING_TAB_META]?.label ?? rest;
    case "analysis":
      return ANALYSIS_TAB_META[rest as keyof typeof ANALYSIS_TAB_META]?.label ?? rest;
    case "communication":
      return COMMUNICATION_TABS.find((t) => t.id === rest)?.label ?? rest;
    case "legal":
      return LEGAL_TABS.find((t) => t.id === rest)?.label ?? rest;
    default:
      return rest;
  }
}

const SECTION_LABEL: Record<string, string> = {
  configuration: "Configuration",
  marketing: "Marketing",
  analysis: "Analysis",
  communication: "Communication",
  legal: "Legal & Privacy",
};

function sectionOf(key: PermissionKey): string {
  return key.slice(0, key.indexOf("."));
}

const GRANT_GROUPS = Array.from(new Set(ALL_PERMISSION_KEYS.map(sectionOf))).map((section) => ({
  section,
  label: SECTION_LABEL[section] ?? section,
  keys: ALL_PERMISSION_KEYS.filter((k) => sectionOf(k) === section),
}));

function RoleBadge({ role }: { role: AdminRole }) {
  const styles: Record<AdminRole, string> = {
    t1: "bg-amber-100 text-amber-800",
    t2: "bg-violet-100 text-violet-800",
    admin: "bg-ink-100 text-ink-600",
  };
  const Icon = role === "t1" ? Crown : role === "t2" ? ShieldCheck : Shield;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${styles[role]}`}>
      <Icon className="size-3" />
      {ADMIN_ROLE_LABELS[role]}
    </span>
  );
}

function accessSummary(record: AdminRecord): string {
  if (record.role !== "admin") return "Full access to every section";
  const entries = Object.values(record.grants);
  if (entries.length === 0) return "No access yet";
  const writes = entries.filter((v) => v === "write").length;
  return `${entries.length} section${entries.length === 1 ? "" : "s"} · ${writes} with write`;
}

function GrantsEditorModal({
  admin,
  onClose,
  onSaved,
}: {
  admin: AdminRecord;
  onClose: () => void;
  onSaved: () => void;
}) {
  const saveGrants = useAdminAccess((s) => s.saveGrants);
  const [grants, setGrants] = useState<Partial<Record<PermissionKey, PermissionLevel>>>(admin.grants);
  const [saving, setSaving] = useState(false);

  const setLevel = (key: PermissionKey, level: PermissionLevel | null) => {
    setGrants((g) => {
      const next = { ...g };
      if (level) next[key] = level;
      else delete next[key];
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      await saveGrants(admin.uid, grants);
      toast.success(`Updated access for ${admin.email ?? admin.uid}.`);
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save grants.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Access for ${admin.email ?? admin.uid}`}
      size="max-w-2xl"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={saving} onClick={() => void save()}>
            Save access
          </Button>
        </div>
      }
    >
      <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
        {GRANT_GROUPS.map((group) => (
          <Section key={group.section} title={group.label}>
            <div className="space-y-1.5">
              {group.keys.map((key) => {
                const level = grants[key] ?? null;
                return (
                  <div key={key} className="flex items-center justify-between gap-3 rounded-lg bg-white px-2.5 py-1.5">
                    <span className="text-sm text-ink-700">{tabLabel(key)}</span>
                    <div className="flex gap-1">
                      {(["none", "read", "write"] as const).map((opt) => {
                        const active = opt === "none" ? level === null : level === opt;
                        return (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => setLevel(key, opt === "none" ? null : opt)}
                            className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition ${
                              active
                                ? opt === "write"
                                  ? "bg-brand-600 text-white"
                                  : opt === "read"
                                    ? "bg-brand-100 text-brand-700"
                                    : "bg-ink-200 text-ink-600"
                                : "bg-ink-50 text-ink-400 hover:bg-ink-100"
                            }`}
                          >
                            {opt === "none" ? "None" : opt === "read" ? "Read" : "Write"}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        ))}
      </div>
    </Modal>
  );
}

function AuditLogCard() {
  const load = useAdminAccess((s) => s.loadAuditLog);
  const entries = useAdminAccess((s) => s.auditLog);
  const loading = useAdminAccess((s) => s.auditLoading);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const describe = (e: AuditEntry): string => {
    const who = e.actorEmail ?? e.actorUid;
    const whom = e.targetEmail ?? e.targetUid;
    switch (e.action) {
      case "invite_admin":
        return `${who} invited ${whom} as an admin`;
      case "attach_admin":
        return `${who} granted admin access to ${whom}`;
      case "remove_admin":
        return `${who} removed ${whom}'s access`;
      case "set_grants":
        return `${who} changed what ${whom} can access`;
      case "set_role": {
        const before = (e.details as { before?: string } | undefined)?.before;
        const after = (e.details as { after?: string } | undefined)?.after;
        return `${who} changed ${whom}'s role${before && after ? ` from ${before} to ${after}` : ""}`;
      }
      case "pii_reveal":
        return `${who} revealed ${whom}'s contact details`;
      default:
        return `${who} → ${e.action} → ${whom}`;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Audit log</CardTitle>
      </CardHeader>
      <CardBody className="space-y-2">
        {loading && entries.length === 0 ? (
          <div className="flex justify-center py-6">
            <Loader2 className="size-5 animate-spin text-ink-300" />
          </div>
        ) : entries.length === 0 ? (
          <p className="text-sm text-ink-400">Nothing recorded yet.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {entries.slice(0, 50).map((e) => (
              <li key={e.id} className="flex items-start justify-between gap-3 border-b border-ink-50 pb-1.5 last:border-0">
                <span className="text-ink-700">{describe(e)}</span>
                <span className="shrink-0 text-[11px] text-ink-400">{new Date(e.at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

export function PermissionsTab() {
  const me = useAdminAccess((s) => s.me);
  const isT1 = useAdminAccess((s) => s.isT1());
  const can = useAdminAccess((s) => s.can);
  const admins = useAdminAccess((s) => s.admins);
  const adminsLoading = useAdminAccess((s) => s.adminsLoading);
  const loadAdmins = useAdminAccess((s) => s.loadAdmins);
  const invite = useAdminAccess((s) => s.invite);
  const removeAdmin = useAdminAccess((s) => s.removeAdmin);
  const setRole = useAdminAccess((s) => s.setRole);
  const viewAsUid = useAdminAccess((s) => s.viewAsUid);
  const setViewAsUid = useAdminAccess((s) => s.setViewAsUid);

  const [email, setEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<AdminRecord | null>(null);

  useEffect(() => {
    void loadAdmins();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canManageAdmins = can("manage_admins");
  const canManageOwners = can("manage_owners");

  const sorted = useMemo(
    () => [...admins].sort((a, b) => (a.uid === me?.uid ? -1 : b.uid === me?.uid ? 1 : 0)),
    [admins, me?.uid],
  );

  const onInvite = async () => {
    if (!email.trim()) return;
    setInviting(true);
    try {
      const admin = await invite(email.trim());
      toast.success(
        admin.displayName || admin.email
          ? `${admin.email} now has admin access — set what they can see below.`
          : "Invited.",
      );
      setEmail("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not invite that person.");
    } finally {
      setInviting(false);
    }
  };

  const onRemove = async (record: AdminRecord) => {
    if (!window.confirm(`Remove ${record.email ?? record.uid}'s admin access?`)) return;
    try {
      await removeAdmin(record.uid);
      toast.success("Access removed.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove access.");
    }
  };

  const onRoleChange = async (record: AdminRecord, role: AdminRole) => {
    try {
      await setRole(record.uid, role);
      toast.success(`${record.email ?? record.uid} is now ${ADMIN_ROLE_LABELS[role]}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not change role.");
    }
  };

  return (
    <div className="space-y-5">
      <TabIntro
        elsewhere="This page controls WHO can reach every other page in this dashboard, and whether they can only look or also change things. Plain admins never see this page, even their own row."
      >
        T1 owners can do everything, including managing other owners, and are the only ones who ever
        see secrets. T2 owners have full read/write everywhere except secrets and can't touch the
        owner tier. Admins only see what's granted below.
      </TabIntro>

      {viewAsUid && (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-800 ring-1 ring-amber-100">
          <span className="flex items-center gap-2">
            <Eye className="size-4" />
            Previewing the dashboard as{" "}
            <strong>{admins.find((a) => a.uid === viewAsUid)?.email ?? viewAsUid}</strong> — every
            page is read-only while this is on.
          </span>
          <Button variant="secondary" size="sm" onClick={() => setViewAsUid(null)}>
            Exit preview
          </Button>
        </div>
      )}

      {canManageAdmins && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Invite an admin</CardTitle>
          </CardHeader>
          <CardBody>
            <div className="flex items-end gap-3">
              <Field label="Email" className="flex-1">
                <Input
                  type="email"
                  value={email}
                  placeholder="teammate@example.com"
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void onInvite()}
                />
              </Field>
              <Button loading={inviting} leftIcon={<UserPlus className="size-4" />} onClick={() => void onInvite()}>
                Invite
              </Button>
            </div>
            <p className="mt-2 text-xs text-ink-400">
              <Mail className="mr-1 inline size-3" />
              If they don't have an account yet, we create one and email them a link to set a
              password. They land with no access — grant it below.
            </p>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            Who has access <span className="font-normal text-ink-400">({admins.length})</span>
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-2">
          {adminsLoading && admins.length === 0 ? (
            <div className="flex justify-center py-8">
              <Loader2 className="size-5 animate-spin text-ink-300" />
            </div>
          ) : (
            sorted.map((record) => {
              const isSelf = record.uid === me?.uid;
              const isOwnerRow = record.role !== "admin";
              return (
                <div
                  key={record.uid}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-ink-50/60 px-3.5 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-ink-800">
                        {record.email ?? record.uid}
                        {isSelf && <span className="ml-1 text-ink-400">(you)</span>}
                      </span>
                      <RoleBadge role={record.role} />
                    </div>
                    <p className="text-[11px] text-ink-400">{accessSummary(record)}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {canManageOwners && !isSelf && record.role !== "t1" && (
                      <Select
                        className="h-9 w-40 text-xs"
                        value={record.role}
                        onChange={(e) => void onRoleChange(record, e.target.value as AdminRole)}
                        options={[
                          { value: "admin", label: "Admin" },
                          { value: "t2", label: "Owner (T2)" },
                          { value: "t1", label: "Owner (T1)" },
                        ]}
                      />
                    )}
                    {!isOwnerRow && canManageAdmins && (
                      <Button variant="secondary" size="sm" onClick={() => setEditing(record)}>
                        Edit access
                      </Button>
                    )}
                    {!isSelf && (
                      <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={<Eye className="size-3.5" />}
                        onClick={() => setViewAsUid(record.uid)}
                      >
                        View as
                      </Button>
                    )}
                    {!isSelf && record.role === "t1" ? null : !isSelf &&
                      (record.role === "admin" ? canManageAdmins : canManageOwners) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          leftIcon={<Trash2 className="size-3.5" />}
                          onClick={() => void onRemove(record)}
                        >
                          Remove
                        </Button>
                      )}
                  </div>
                </div>
              );
            })
          )}
        </CardBody>
      </Card>

      {isT1 && (
        <p className="flex items-center gap-1.5 text-xs text-ink-400">
          <KeyRound className="size-3.5" />
          As a T1 owner, you're the only one who can promote or remove other owners — and nobody,
          including you, can ever demote or remove a T1.
        </p>
      )}

      <AuditLogCard />

      {editing && (
        <GrantsEditorModal admin={editing} onClose={() => setEditing(null)} onSaved={() => void loadAdmins()} />
      )}
    </div>
  );
}
