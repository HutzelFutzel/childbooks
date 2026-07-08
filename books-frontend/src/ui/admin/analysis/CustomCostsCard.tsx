"use client";

/**
 * Admin editor for custom operating costs — recurring or one-time expenses
 * that no automated source captures (email service, domain renewals, design
 * tools, …). Saving books all already-due periods immediately (idempotently),
 * so the Finance totals update right away; the nightly sweep keeps booking
 * future periods. Price changes only affect periods booked after the edit.
 */
import { useEffect, useState } from "react";
import { Loader2, Pencil, Plus, ReceiptText, Trash2, X } from "lucide-react";
import { useAdminFinance, type CustomCostCadence, type CustomCostRow } from "../../../state/adminFinanceStore";
import { useAdminAnalytics } from "../../../state/adminAnalyticsStore";
import { Button } from "../../components/Button";
import { Select } from "../../components/Select";
import { Toggle } from "../../components/Toggle";
import { cn } from "../../lib/cn";
import { notify } from "../../lib/notify";
import { fmtDateTime } from "./format";

const CADENCES: { value: CustomCostCadence; label: string }[] = [
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
  { value: "once", label: "One-time" },
];

interface Draft {
  id?: string;
  title: string;
  description: string;
  amount: string;
  currency: string;
  taxRatePct: string;
  cadence: CustomCostCadence;
  firstChargeAt: string; // yyyy-mm-dd
  endAt: string; // yyyy-mm-dd or ""
  active: boolean;
}

function emptyDraft(): Draft {
  return {
    title: "",
    description: "",
    amount: "",
    currency: "USD",
    taxRatePct: "",
    cadence: "monthly",
    firstChargeAt: new Date().toISOString().slice(0, 10),
    endAt: "",
    active: true,
  };
}

function toDraft(c: CustomCostRow): Draft {
  return {
    id: c.id,
    title: c.title,
    description: c.description,
    amount: String(c.amount),
    currency: c.currency,
    taxRatePct: c.taxRatePct > 0 ? String(c.taxRatePct) : "",
    cadence: c.cadence,
    firstChargeAt: new Date(c.firstChargeAt).toISOString().slice(0, 10),
    endAt: c.endAt ? new Date(c.endAt).toISOString().slice(0, 10) : "",
    active: c.active,
  };
}

function dateMs(s: string): number | null {
  const t = Date.parse(`${s}T12:00:00Z`);
  return Number.isFinite(t) ? t : null;
}

function cadenceLabel(c: CustomCostCadence): string {
  return CADENCES.find((x) => x.value === c)?.label ?? c;
}

export function CustomCostsCard() {
  const costs = useAdminFinance((s) => s.customCosts);
  const loading = useAdminFinance((s) => s.customCostsLoading);
  const load = useAdminFinance((s) => s.loadCustomCosts);
  const save = useAdminFinance((s) => s.saveCustomCost);
  const remove = useAdminFinance((s) => s.deleteCustomCost);

  const settings = useAdminAnalytics((s) => s.settings);
  const savingSettings = useAdminAnalytics((s) => s.savingSettings);
  const saveSettings = useAdminAnalytics((s) => s.saveSettings);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    if (!draft) return;
    const amount = Number(draft.amount);
    const firstChargeAt = dateMs(draft.firstChargeAt);
    if (!draft.title.trim()) return void notify.error("Give the cost a title.");
    if (!Number.isFinite(amount) || amount <= 0) return void notify.error("Enter a positive amount.");
    if (!/^[A-Za-z]{3}$/.test(draft.currency.trim())) return void notify.error("Currency must be a 3-letter code.");
    if (!firstChargeAt) return void notify.error("Pick a valid first charge date.");
    const endAt = draft.endAt ? dateMs(draft.endAt) : null;
    const taxRatePct = draft.taxRatePct ? Number(draft.taxRatePct) : 0;
    if (!Number.isFinite(taxRatePct) || taxRatePct < 0 || taxRatePct > 50) {
      return void notify.error("Tax rate must be between 0 and 50%.");
    }

    setSaving(true);
    try {
      await save({
        id: draft.id,
        title: draft.title.trim(),
        description: draft.description.trim(),
        amount,
        currency: draft.currency.trim().toUpperCase(),
        taxRatePct,
        cadence: draft.cadence,
        firstChargeAt,
        endAt,
        active: draft.active,
      });
      notify.success(draft.id ? "Cost updated — future periods use the new figures." : "Cost added and booked.");
      setDraft(null);
    } catch (err) {
      notify.error(err instanceof Error ? err.message : "Failed to save the cost.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-2xl border border-ink-100 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-4 py-3">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink-800">
            <ReceiptText className="size-4" /> Operating costs
          </h3>
          <p className="text-xs text-ink-500">
            Recurring or one-time expenses no automated source captures (email service, domains,
            tools). Booked into the “Operating costs” category on their charge dates — edit the
            amount when a price changes and future periods follow.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-ink-600">
            <Toggle
              checked={settings.ops.reclaimVat}
              disabled={savingSettings}
              onChange={(v) => void saveSettings({ ops: { reclaimVat: v } })}
              label="Book net amounts (VAT is reclaimed)"
            />
            Book net (I reclaim VAT)
          </label>
          <Button
            size="sm"
            variant="secondary"
            leftIcon={<Plus className="size-4" />}
            onClick={() => setDraft(emptyDraft())}
            disabled={draft !== null}
          >
            Add cost
          </Button>
        </div>
      </header>

      {draft && (
        <div className="border-b border-ink-100 bg-ink-50/60 px-4 py-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Title">
              <input
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="e.g. Email service"
                className={inputCls}
              />
            </Field>
            <Field label="Description (optional)">
              <input
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="What is this for?"
                className={inputCls}
              />
            </Field>
            <Field label="Amount (gross, per period)">
              <div className="flex gap-2">
                <input
                  value={draft.amount}
                  onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                  placeholder="12.99"
                  inputMode="decimal"
                  className={cn(inputCls, "flex-1")}
                />
                <input
                  value={draft.currency}
                  onChange={(e) => setDraft({ ...draft, currency: e.target.value.toUpperCase() })}
                  maxLength={3}
                  className={cn(inputCls, "w-16 text-center uppercase")}
                />
              </div>
            </Field>
            <Field label="Tax rate % in the amount (optional)">
              <input
                value={draft.taxRatePct}
                onChange={(e) => setDraft({ ...draft, taxRatePct: e.target.value })}
                placeholder="e.g. 19"
                inputMode="decimal"
                className={inputCls}
              />
            </Field>
            <Field label="Cadence">
              <Select
                value={draft.cadence}
                options={CADENCES}
                onChange={(e) => setDraft({ ...draft, cadence: e.target.value as CustomCostCadence })}
                className="h-9 rounded-lg"
              />
            </Field>
            <Field label={draft.cadence === "once" ? "Charge date" : "First charge date"}>
              <input
                type="date"
                value={draft.firstChargeAt}
                onChange={(e) => setDraft({ ...draft, firstChargeAt: e.target.value })}
                className={inputCls}
              />
            </Field>
            {draft.cadence !== "once" && (
              <Field label="Ends after (optional)">
                <input
                  type="date"
                  value={draft.endAt}
                  onChange={(e) => setDraft({ ...draft, endAt: e.target.value })}
                  className={inputCls}
                />
              </Field>
            )}
            <Field label="Active">
              <div className="flex h-9 items-center">
                <Toggle
                  checked={draft.active}
                  onChange={(v) => setDraft({ ...draft, active: v })}
                  label="Active"
                />
              </div>
            </Field>
          </div>
          <div className="mt-3 flex gap-2">
            <Button size="sm" loading={saving} onClick={() => void submit()}>
              {draft.id ? "Save changes" : "Add & book"}
            </Button>
            <Button size="sm" variant="ghost" leftIcon={<X className="size-4" />} onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {loading && costs.length === 0 ? (
        <div className="flex items-center gap-2 px-4 py-6 text-sm text-ink-500">
          <Loader2 className="size-4 animate-spin" /> Loading costs…
        </div>
      ) : costs.length === 0 ? (
        <p className="px-4 py-6 text-sm text-ink-400">
          No custom costs yet — add your first recurring expense to complete the P&L.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-400">
                <th className="px-4 py-2 font-medium">Cost</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
                <th className="px-4 py-2 font-medium">Cadence</th>
                <th className="px-4 py-2 font-medium">First charge</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {costs.map((c) => (
                <tr key={c.id} className="border-t border-ink-50">
                  <td className="px-4 py-2">
                    <p className="font-medium text-ink-700">{c.title}</p>
                    {c.description && <p className="text-xs text-ink-400">{c.description}</p>}
                  </td>
                  <td className="px-4 py-2 text-right text-ink-700">
                    {c.amount.toFixed(2)} {c.currency}
                    {c.taxRatePct > 0 && (
                      <span className="block text-xs text-ink-400">incl. {c.taxRatePct}% tax</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-ink-600">
                    {cadenceLabel(c.cadence)}
                    {c.endAt && (
                      <span className="block text-xs text-ink-400">
                        until {fmtDateTime(c.endAt).split(",")[0]}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-ink-600">{fmtDateTime(c.firstChargeAt).split(",")[0]}</td>
                  <td className="px-4 py-2">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs font-medium",
                        c.active ? "bg-emerald-100 text-emerald-700" : "bg-ink-100 text-ink-500",
                      )}
                    >
                      {c.active ? "Active" : "Paused"}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => setDraft(toDraft(c))}
                        className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-50 hover:text-ink-700"
                        aria-label={`Edit ${c.title}`}
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (!window.confirm(`Delete "${c.title}"? Already-booked periods stay in the books.`)) return;
                          void remove(c.id).catch((err) => notify.error(err));
                        }}
                        className="rounded-lg p-1.5 text-ink-400 hover:bg-rose-50 hover:text-rose-600"
                        aria-label={`Delete ${c.title}`}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const inputCls =
  "h-9 w-full rounded-lg bg-white px-3 text-sm text-ink-800 ring-1 ring-inset ring-ink-200 focus:outline-none focus:ring-2 focus:ring-brand-400";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-ink-600">{label}</span>
      {children}
    </label>
  );
}
