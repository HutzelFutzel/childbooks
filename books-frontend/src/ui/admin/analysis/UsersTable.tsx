"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, EyeOff, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import type { AnalyticsUserRow, UserSort } from "../../../core/analytics/types";
import { useAdminAnalytics } from "../../../state/adminAnalyticsStore";
import { Button } from "../../components/Button";
import { Toggle } from "../../components/Toggle";
import { Modal } from "../../components/Modal";
import { Input, Field } from "../../components/Input";
import { Select } from "../../components/Select";
import { CardHeader, CardTitle } from "../../components/Card";
import { fmtDateTime, fmtMoney, fmtNumber, fmtRelative, fmtSparks, fmtUsd, sourceLabel } from "./format";

const COLUMNS: { key: UserSort; label: string; sortable: boolean; align?: "right" }[] = [
  { key: "email", label: "User", sortable: true },
  { key: "plan", label: "Plan", sortable: true },
  { key: "sparks", label: "Sparks", sortable: true, align: "right" },
  { key: "revenue", label: "Revenue", sortable: true, align: "right" },
  { key: "spend", label: "AI spend", sortable: true, align: "right" },
  { key: "created", label: "Signed up", sortable: true },
  { key: "lastActive", label: "Last active", sortable: true },
  { key: "events", label: "Events", sortable: true, align: "right" },
];

export function UsersTable() {
  const users = useAdminAnalytics((s) => s.users);
  const total = useAdminAnalytics((s) => s.usersTotal);
  const loading = useAdminAnalytics((s) => s.usersLoading);
  const sort = useAdminAnalytics((s) => s.sort);
  const dir = useAdminAnalytics((s) => s.dir);
  const search = useAdminAnalytics((s) => s.search);
  const includeGuests = useAdminAnalytics((s) => s.includeGuests);
  const planFilter = useAdminAnalytics((s) => s.planFilter);
  const cadenceFilter = useAdminAnalytics((s) => s.cadenceFilter);
  const setUserQuery = useAdminAnalytics((s) => s.setUserQuery);
  const excludeEmail = useAdminAnalytics((s) => s.excludeEmail);

  const [draft, setDraft] = useState(search);
  const [adjustTarget, setAdjustTarget] = useState<AnalyticsUserRow | null>(null);

  const onSort = (key: UserSort) => {
    if (key === sort) setUserQuery({ dir: dir === "desc" ? "asc" : "desc" });
    else setUserQuery({ sort: key, dir: "desc" });
  };

  const onExclude = async (row: AnalyticsUserRow) => {
    if (!row.email) {
      toast.error("This account has no email to exclude.");
      return;
    }
    await excludeEmail(row.email);
    toast.success(`Excluded ${row.email} from analytics.`);
  };

  return (
    <div className="rounded-2xl bg-white ring-1 ring-ink-100 shadow-soft">
      <CardHeader className="flex flex-wrap items-center justify-between gap-3 py-3.5">
        <CardTitle className="text-sm">
          Users <span className="font-normal text-ink-400">({fmtNumber(total)})</span>
        </CardTitle>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-ink-500">
            <Toggle checked={includeGuests} onChange={(v) => setUserQuery({ includeGuests: v })} />
            Include guests
          </label>
          <Select
            aria-label="Subscription filter"
            value={planFilter}
            onChange={(e) => setUserQuery({ planFilter: e.target.value as typeof planFilter })}
            className="h-9 w-36"
            options={[
              { value: "all", label: "All plans" },
              { value: "paid", label: "Subscribers" },
              { value: "free", label: "Free / none" },
            ]}
          />
          <Select
            aria-label="Billing cadence filter"
            value={cadenceFilter}
            onChange={(e) => setUserQuery({ cadenceFilter: e.target.value as typeof cadenceFilter })}
            className="h-9 w-32"
            options={[
              { value: "all", label: "Any cadence" },
              { value: "month", label: "Monthly" },
              { value: "year", label: "Annual" },
            ]}
          />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setUserQuery({ search: draft });
            }}
            className="relative"
          >
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Search email / name"
              className="h-9 w-52 rounded-lg bg-ink-50 pl-8 pr-3 text-sm text-ink-800 ring-1 ring-inset ring-ink-200 focus:outline-none focus:ring-2 focus:ring-brand-400"
            />
          </form>
        </div>
      </CardHeader>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink-100 text-left text-xs font-medium text-ink-500">
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  className={`px-4 py-2.5 ${c.align === "right" ? "text-right" : ""}`}
                >
                  <button
                    type="button"
                    onClick={() => c.sortable && onSort(c.key)}
                    className={`inline-flex items-center gap-1 ${c.sortable ? "hover:text-ink-800" : "cursor-default"} ${c.align === "right" ? "flex-row-reverse" : ""}`}
                  >
                    {c.label}
                    {sort === c.key &&
                      (dir === "desc" ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
                  </button>
                </th>
              ))}
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className={loading ? "opacity-50" : ""}>
            {users.map((u) => (
              <tr key={u.uid} className="border-b border-ink-50 last:border-0 hover:bg-ink-50/40">
                <td className="px-4 py-2.5">
                  <div className="font-medium text-ink-800">{u.email ?? "—"}</div>
                  <div className="flex items-center gap-1.5 text-xs text-ink-400">
                    {u.displayName && <span>{u.displayName}</span>}
                    <SourceBadge source={u.source} isAnonymous={u.isAnonymous} />
                    {!u.isAnonymous && !u.emailVerified && (
                      <span className="text-amber-500">unverified</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-2.5">
                  <PlanCell row={u} />
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-ink-700">{fmtSparks(u.sparkBalance)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-ink-700">
                  {fmtMoney(u.revenue, u.revenueCurrency)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-ink-700">{fmtUsd(u.spendUsd)}</td>
                <td className="px-4 py-2.5 text-ink-600">{fmtDateTime(u.createdAt)}</td>
                <td className="px-4 py-2.5 text-ink-600" title={fmtDateTime(u.lastActiveAt)}>
                  {fmtRelative(u.lastActiveAt)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-ink-700">{fmtNumber(u.events)}</td>
                <td className="px-4 py-2.5 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      leftIcon={<Sparkles className="size-3.5" />}
                      onClick={() => setAdjustTarget(u)}
                      title="Adjust this user's Sparks wallet"
                    >
                      Sparks
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      leftIcon={<EyeOff className="size-3.5" />}
                      onClick={() => onExclude(u)}
                      disabled={!u.email}
                      title="Exclude this user from analytics"
                    >
                      Exclude
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {users.length === 0 && !loading && (
              <tr>
                <td colSpan={COLUMNS.length + 1} className="px-4 py-10 text-center text-sm text-ink-400">
                  No users match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <AdjustSparksModal target={adjustTarget} onClose={() => setAdjustTarget(null)} />
    </div>
  );
}

function PlanCell({ row }: { row: AnalyticsUserRow }) {
  if (!row.isSubscribed) {
    return <span className="text-xs text-ink-400">{row.planName ?? "Free"}</span>;
  }
  const cadence = row.billingCadence === "year" ? "Annual" : row.billingCadence === "month" ? "Monthly" : null;
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1.5">
        <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-700">
          {row.planName ?? "Subscribed"}
        </span>
        {cadence && <span className="text-[11px] text-ink-500">{cadence}</span>}
      </div>
      <div className="flex items-center gap-1.5 text-[11px] text-ink-400">
        {row.subscriptionAmount != null && (
          <span>{fmtMoney(row.subscriptionAmount, row.subscriptionCurrency)}</span>
        )}
        {row.subscriptionStatus && row.subscriptionStatus !== "active" && (
          <span className="text-amber-500">{row.subscriptionStatus}</span>
        )}
      </div>
    </div>
  );
}

function AdjustSparksModal({
  target,
  onClose,
}: {
  target: AnalyticsUserRow | null;
  onClose: () => void;
}) {
  const adjustSparks = useAdminAnalytics((s) => s.adjustSparks);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const open = target !== null;

  const reset = () => {
    setAmount("");
    setReason("");
    setSaving(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    if (!target) return;
    const delta = Number(amount);
    if (!Number.isFinite(delta) || delta === 0) {
      toast.error("Enter a non-zero amount (use a negative number to deduct).");
      return;
    }
    setSaving(true);
    try {
      const res = await adjustSparks(target.uid, delta, reason.trim() || "Admin adjustment");
      toast.success(
        `${delta > 0 ? "Added" : "Removed"} ${fmtSparks(Math.abs(delta))} Sparks. New balance: ${fmtSparks(res.balance)}.`,
      );
      close();
    } catch (err) {
      toast.error((err as Error)?.message ?? "Failed to adjust Sparks.");
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Adjust Sparks wallet"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={() => void submit()} loading={saving}>
            Apply adjustment
          </Button>
        </>
      }
    >
      {target && (
        <div className="space-y-4">
          <div className="rounded-xl bg-ink-50 px-3.5 py-3 text-sm">
            <div className="font-medium text-ink-800">{target.email ?? target.uid}</div>
            <div className="text-xs text-ink-500">
              Current balance: <span className="font-semibold">{fmtSparks(target.sparkBalance)}</span> Sparks
            </div>
          </div>
          <Field
            label="Amount"
            hint="Positive to credit, negative to deduct (e.g. 500 or -200)."
          >
            <Input
              type="number"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="500"
              autoFocus
            />
          </Field>
          <Field label="Reason" hint="Recorded in the user's Sparks ledger for the audit trail.">
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Goodwill credit for support ticket #1234"
            />
          </Field>
          {amount !== "" && Number.isFinite(Number(amount)) && Number(amount) !== 0 && (
            <p className="text-xs text-ink-500">
              New balance will be{" "}
              <span className="font-semibold text-ink-700">
                {fmtSparks((target.sparkBalance ?? 0) + Number(amount))}
              </span>{" "}
              Sparks.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

function SourceBadge({ source, isAnonymous }: { source: string | null; isAnonymous: boolean }) {
  const label = sourceLabel(source);
  const tone = isAnonymous
    ? "bg-ink-100 text-ink-500"
    : source === "google.com"
      ? "bg-sky-100 text-sky-700"
      : "bg-emerald-100 text-emerald-700";
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tone}`}>
      {label}
    </span>
  );
}
