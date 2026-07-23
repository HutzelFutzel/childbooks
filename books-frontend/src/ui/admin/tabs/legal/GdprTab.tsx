"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Download, Search, ShieldAlert, Trash2 } from "lucide-react";
import { Button } from "../../../components/Button";
import { Field, Input } from "../../../components/Input";
import { backendFetch } from "../../../../platform/backend";
import { Section } from "../products/parts";

interface AuthSummary {
  uid: string;
  email: string | null;
  displayName: string | null;
  emailVerified: boolean;
  disabled: boolean;
  providers: string[];
  createdAt: string | null;
  lastSignInAt: string | null;
}

async function readError(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: { message?: string } };
    return j.error?.message ?? "Request failed.";
  } catch {
    return "Request failed.";
  }
}

/**
 * Legal & Privacy → Data requests. Handles GDPR data-subject requests: look up a
 * user by email, EXPORT their full data (right to access / portability), and
 * ERASE the account (right to be forgotten). Erasure hard-deletes the account +
 * all app data + storage, and anonymizes retained financial records (kept for
 * tax/accounting law). Every deletion is written to an append-only audit log.
 */
export function GdprTab() {
  const [email, setEmail] = useState("");
  const [looking, setLooking] = useState(false);
  const [user, setUser] = useState<AuthSummary | null>(null);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const lookup = async () => {
    if (!email.trim()) return;
    setLooking(true);
    setUser(null);
    setConfirmText("");
    try {
      const res = await backendFetch(`/admin/users/lookup?email=${encodeURIComponent(email.trim())}`);
      if (!res.ok) throw new Error(await readError(res));
      const j = (await res.json()) as { user: AuthSummary };
      setUser(j.user);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Lookup failed.");
    } finally {
      setLooking(false);
    }
  };

  const exportData = async () => {
    if (!user) return;
    setExporting(true);
    try {
      const res = await backendFetch(`/admin/users/${encodeURIComponent(user.uid)}/export`);
      if (!res.ok) throw new Error(await readError(res));
      const bundle = await res.json();
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `user-${user.uid}-export.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Export downloaded.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  };

  const erase = async () => {
    if (!user) return;
    setDeleting(true);
    try {
      const res = await backendFetch(`/admin/users/${encodeURIComponent(user.uid)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(await readError(res));
      const result = (await res.json()) as {
        errors: string[];
        ordersAnonymized: number;
        paymentsAnonymized: number;
      };
      if (result.errors.length > 0) {
        toast.error(`Erased with issues: ${result.errors.join("; ")}`);
      } else {
        toast.success(
          `Account erased. Anonymized ${result.ordersAnonymized} order(s), ${result.paymentsAnonymized} payment(s).`,
        );
      }
      setUser(null);
      setEmail("");
      setConfirmText("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erasure failed.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-xs leading-relaxed text-ink-500">
        Handle GDPR data-subject requests. A user contacts support; find them here
        by email, then export their data or erase their account. Erasure deletes
        the account, all app data and stored files, and{" "}
        <strong>anonymizes</strong> orders/payments (kept for accounting law).
        Every deletion is recorded in an audit log.
      </p>

      <Section title="Find a user" hint="Look up by the email on their account.">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Email" className="min-w-[16rem] flex-1">
            <Input
              type="email"
              value={email}
              placeholder="user@example.com"
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && lookup()}
            />
          </Field>
          <Button size="sm" leftIcon={<Search className="size-3.5" />} loading={looking} onClick={lookup}>
            Look up
          </Button>
        </div>
      </Section>

      {user && (
        <Section title="Account">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
            <Detail label="Email" value={user.email ?? "—"} />
            <Detail label="Name" value={user.displayName ?? "—"} />
            <Detail label="UID" value={user.uid} mono />
            <Detail label="Verified" value={user.emailVerified ? "Yes" : "No"} />
            <Detail label="Providers" value={user.providers.join(", ") || "—"} />
            <Detail
              label="Created"
              value={user.createdAt ? new Date(user.createdAt).toLocaleDateString() : "—"}
            />
          </dl>

          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Download className="size-3.5" />}
              loading={exporting}
              onClick={exportData}
            >
              Export data (JSON)
            </Button>
          </div>

          {/* Danger zone — typed confirmation before an irreversible erase. */}
          <div className="mt-2 space-y-2 rounded-lg border border-red-200 bg-red-50 p-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-red-700">
              <ShieldAlert className="size-4" />
              Erase account &amp; data (irreversible)
            </div>
            <p className="text-[11px] leading-relaxed text-red-700/80">
              Type the account email <strong>{user.email}</strong> to confirm.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <Input
                value={confirmText}
                placeholder={user.email ?? ""}
                onChange={(e) => setConfirmText(e.target.value)}
                className="max-w-xs"
              />
              <Button
                variant="danger"
                size="sm"
                leftIcon={<Trash2 className="size-3.5" />}
                loading={deleting}
                disabled={!user.email || confirmText.trim().toLowerCase() !== user.email.toLowerCase()}
                onClick={erase}
              >
                Erase permanently
              </Button>
            </div>
          </div>
        </Section>
      )}
    </div>
  );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-ink-400">{label}</dt>
      <dd className={`truncate text-ink-800 ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}
