"use client";

import { useMemo, useState } from "react";
import { CloudDownload, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { useAdminAnalytics } from "../../../state/adminAnalyticsStore";
import { backendFetch } from "../../../platform/backend";
import { getFirebaseApp } from "../../../lib/firebase";
import { Button } from "../../components/Button";
import { Select } from "../../components/Select";
import { CardBody, CardHeader, CardTitle } from "../../components/Card";

const REFRESH_OPTIONS = [
  { value: "0", label: "Off" },
  { value: "30", label: "Every 30s" },
  { value: "60", label: "Every 60s" },
  { value: "300", label: "Every 5m" },
];

function timezoneOptions(current: string): { value: string; label: string }[] {
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let zones: string[] = [];
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    if (supported) zones = supported("timeZone");
  } catch {
    // ignore
  }
  const base = ["UTC", local, current];
  const all = Array.from(new Set([...base, ...zones])).filter(Boolean);
  return all.map((z) => ({ value: z, label: z === local ? `${z} (local)` : z }));
}

export function SettingsCard() {
  const settings = useAdminAnalytics((s) => s.settings);
  const saving = useAdminAnalytics((s) => s.savingSettings);
  const saveSettings = useAdminAnalytics((s) => s.saveSettings);

  const [emailDraft, setEmailDraft] = useState("");
  const [domainDraft, setDomainDraft] = useState("");
  const tzOptions = useMemo(() => timezoneOptions(settings.timezone), [settings.timezone]);

  const addEmail = () => {
    const e = emailDraft.trim().toLowerCase();
    if (!e || settings.excludedEmails.includes(e)) return;
    setEmailDraft("");
    void saveSettings({ excludedEmails: [...settings.excludedEmails, e] });
  };

  const addDomain = () => {
    const d = domainDraft.trim().toLowerCase().replace(/^@/, "");
    if (!d || settings.excludedDomains.includes(d)) return;
    setDomainDraft("");
    void saveSettings({ excludedDomains: [...settings.excludedDomains, d] });
  };

  const removeEmail = (email: string) =>
    saveSettings({ excludedEmails: settings.excludedEmails.filter((e) => e !== email) });
  const removeDomain = (domain: string) =>
    saveSettings({ excludedDomains: settings.excludedDomains.filter((d) => d !== domain) });

  return (
    <div className="rounded-2xl bg-white ring-1 ring-ink-100 shadow-soft">
      <CardHeader className="py-3.5">
        <CardTitle className="text-sm">Dashboard settings</CardTitle>
        <p className="mt-0.5 text-xs text-ink-400">
          Excluded users are removed from every count, chart and table. Saved for next time.
        </p>
      </CardHeader>
      <CardBody className="space-y-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <ExcludeList
            label="Excluded emails"
            placeholder="you@example.com"
            draft={emailDraft}
            setDraft={setEmailDraft}
            onAdd={addEmail}
            items={settings.excludedEmails}
            onRemove={removeEmail}
            disabled={saving}
          />
          <ExcludeList
            label="Excluded domains"
            placeholder="example.com"
            draft={domainDraft}
            setDraft={setDomainDraft}
            onAdd={addDomain}
            items={settings.excludedDomains}
            onRemove={removeDomain}
            disabled={saving}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-600">Timezone</span>
            <Select
              value={settings.timezone}
              options={tzOptions}
              disabled={saving}
              onChange={(e) => saveSettings({ timezone: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-600">Auto-refresh</span>
            <Select
              value={String(settings.autoRefreshSec ?? 0)}
              options={REFRESH_OPTIONS}
              disabled={saving}
              onChange={(e) => {
                const n = Number(e.target.value);
                saveSettings({ autoRefreshSec: n > 0 ? n : null });
              }}
            />
          </label>
        </div>

        <InfraCostSettingsBlock />
      </CardBody>
    </div>
  );
}

/**
 * Firebase/GCP cost tracking for the Finance dashboard. Preferred: the Cloud
 * Billing BigQuery export (exact, per-service). Fallback: a manual monthly
 * budget prorated daily. A daily job imports yesterday's spend either way.
 */
function InfraCostSettingsBlock() {
  const settings = useAdminAnalytics((s) => s.settings);
  const saving = useAdminAnalytics((s) => s.savingSettings);
  const saveSettings = useAdminAnalytics((s) => s.saveSettings);

  const [table, setTable] = useState<string | null>(null);
  const [budget, setBudget] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);

  const tableValue = table ?? settings.infra.bigQueryTable ?? "";
  const budgetValue = budget ?? (settings.infra.monthlyBudgetUsd?.toString() ?? "");
  const dirty = table !== null || budget !== null;
  const configured = Boolean(settings.infra.bigQueryTable) || Boolean(settings.infra.monthlyBudgetUsd);
  const showGuide = !configured || guideOpen;

  const save = () => {
    const monthly = Number(budgetValue);
    void saveSettings({
      infra: {
        bigQueryTable: tableValue.trim() || null,
        monthlyBudgetUsd: Number.isFinite(monthly) && monthly > 0 ? monthly : null,
      },
    }).then(() => {
      setTable(null);
      setBudget(null);
    });
  };

  const runImport = async () => {
    setImporting(true);
    try {
      const res = await backendFetch("/admin/finance/infra/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? "Import failed.");
      }
      const result = (await res.json()) as { mode: string; date: string; events: number; totalUsd: number };
      if (result.mode === "off") {
        toast.info("Infra cost tracking is off — set a BigQuery table or a monthly budget first.");
      } else {
        toast.success(
          `Imported ${result.events} cost line(s) for ${result.date} ($${result.totalUsd}) via ${
            result.mode === "bigquery" ? "the billing export" : "the prorated budget"
          }.`,
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="border-t border-ink-100 pt-4">
      <span className="mb-1 block text-xs font-medium text-ink-600">
        Infrastructure costs (Finance dashboard)
      </span>
      <p className="mb-2.5 text-xs text-ink-400">
        Feeds real Firebase/GCP spend into the “total win”. Best: enable the Cloud Billing export to
        BigQuery and paste its table below (exact, per-service, imported daily). No export? Enter an
        approximate monthly budget and a prorated slice is recorded each day instead.
      </p>

      {configured && (
        <p className="mb-2.5 flex flex-wrap items-center gap-x-2 text-xs">
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
            {settings.infra.bigQueryTable
              ? "Billing export connected"
              : `Budget fallback active ($${settings.infra.monthlyBudgetUsd}/month)`}
          </span>
          {settings.infra.bigQueryTable && (
            <code className="rounded bg-ink-50 px-1.5 py-0.5 text-[11px] text-ink-600">
              {settings.infra.bigQueryTable}
            </code>
          )}
          <button
            type="button"
            onClick={() => setGuideOpen((v) => !v)}
            className="font-medium text-brand-600 hover:underline"
          >
            {guideOpen ? "Hide setup guide" : "Show setup guide"}
          </button>
        </p>
      )}

      {showGuide && <InfraSetupGuide exportEnabled={Boolean(settings.infra.bigQueryTable)} />}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink-600">
            Billing export table (BigQuery)
          </span>
          <input
            value={tableValue}
            onChange={(e) => setTable(e.target.value)}
            placeholder="project.dataset.gcp_billing_export_v1_XXXXXX"
            disabled={saving}
            className="h-9 w-full rounded-lg bg-ink-50 px-3 text-sm text-ink-800 ring-1 ring-inset ring-ink-200 focus:outline-none focus:ring-2 focus:ring-brand-400"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink-600">
            Monthly budget fallback (USD)
          </span>
          <input
            value={budgetValue}
            onChange={(e) => setBudget(e.target.value)}
            placeholder="e.g. 50"
            inputMode="decimal"
            disabled={saving}
            className="h-9 w-full rounded-lg bg-ink-50 px-3 text-sm text-ink-800 ring-1 ring-inset ring-ink-200 focus:outline-none focus:ring-2 focus:ring-brand-400"
          />
        </label>
      </div>
      <div className="mt-2.5 flex gap-2">
        <Button size="sm" onClick={save} disabled={saving || !dirty}>
          Save
        </Button>
        <Button
          size="sm"
          variant="secondary"
          leftIcon={<CloudDownload className="size-4" />}
          loading={importing}
          onClick={() => void runImport()}
        >
          Run import now
        </Button>
      </div>
    </div>
  );
}

/**
 * Step-by-step Google Cloud setup for the exact billing import. Shown in full
 * until the connection is configured, then collapsible behind a toggle.
 */
function InfraSetupGuide({ exportEnabled }: { exportEnabled: boolean }) {
  const projectId = getFirebaseApp().options.projectId ?? "YOUR_PROJECT_ID";
  const steps: { title: string; body: React.ReactNode }[] = [
    {
      title: "Enable the Cloud Billing export",
      body: (
        <>
          Open{" "}
          <a
            href="https://console.cloud.google.com/billing/export"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-brand-600 hover:underline"
          >
            Google Cloud Console → Billing → Billing export
          </a>
          , pick the <em>BigQuery export</em> tab and enable <strong>Standard usage cost</strong>.
          Choose (or create) a dataset in this project, e.g. <Code>billing</Code>. Data starts
          flowing from the moment you enable it — Google does not backfill earlier days.
        </>
      ),
    },
    {
      title: "Copy the export table name",
      body: (
        <>
          After the first day lands, the dataset contains a table like{" "}
          <Code>gcp_billing_export_v1_XXXXXX_XXXXXX_XXXXXX</Code>. Paste its fully-qualified name
          (<Code>{projectId}.billing.gcp_billing_export_v1_…</Code>) into the field below.
        </>
      ),
    },
    {
      title: "Grant the import permission",
      body: (
        <>
          The nightly import runs as the Functions service account{" "}
          <Code>{projectId}@appspot.gserviceaccount.com</Code>. In{" "}
          <a
            href={`https://console.cloud.google.com/iam-admin/iam?project=${encodeURIComponent(projectId)}`}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-brand-600 hover:underline"
          >
            IAM
          </a>{" "}
          give it <strong>BigQuery Job User</strong> on the project and{" "}
          <strong>BigQuery Data Viewer</strong> on the billing dataset.
        </>
      ),
    },
    {
      title: "Verify",
      body: (
        <>
          Save, then click <strong>Run import now</strong> — it reports the imported cost lines or
          the exact BigQuery error. The scheduled job then imports every day at 03:15 UTC.
        </>
      ),
    },
  ];

  return (
    <div className="mb-3 rounded-xl border border-ink-100 bg-ink-50/50 p-3.5">
      <p className="mb-2 text-xs font-semibold text-ink-700">
        {exportEnabled
          ? "Google Cloud setup (for reference)"
          : "One-time Google Cloud setup for exact costs"}
      </p>
      <ol className="space-y-2">
        {steps.map((step, i) => (
          <li key={step.title} className="flex gap-2.5 text-xs text-ink-600">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[11px] font-semibold text-brand-700">
              {i + 1}
            </span>
            <span>
              <span className="font-medium text-ink-700">{step.title}.</span> {step.body}
            </span>
          </li>
        ))}
      </ol>
      {!exportEnabled && (
        <p className="mt-2.5 text-xs text-ink-400">
          Meanwhile, the monthly-budget field keeps the dashboard realistic — a prorated slice is
          booked daily until the export takes over.
        </p>
      )}
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="break-all rounded bg-white px-1 py-0.5 text-[11px] text-ink-700 ring-1 ring-ink-100">
      {children}
    </code>
  );
}

function ExcludeList({
  label,
  placeholder,
  draft,
  setDraft,
  onAdd,
  items,
  onRemove,
  disabled,
}: {
  label: string;
  placeholder: string;
  draft: string;
  setDraft: (v: string) => void;
  onAdd: () => void;
  items: string[];
  onRemove: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <div>
      <span className="mb-1.5 block text-xs font-medium text-ink-600">{label}</span>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onAdd();
        }}
        className="flex gap-2"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className="h-9 flex-1 rounded-lg bg-ink-50 px-3 text-sm text-ink-800 ring-1 ring-inset ring-ink-200 focus:outline-none focus:ring-2 focus:ring-brand-400"
        />
        <Button type="submit" variant="secondary" size="sm" leftIcon={<Plus className="size-4" />} disabled={disabled}>
          Add
        </Button>
      </form>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {items.length === 0 && <span className="text-xs text-ink-400">None</span>}
        {items.map((item) => (
          <span
            key={item}
            className="inline-flex items-center gap-1 rounded-full bg-ink-100 py-1 pl-2.5 pr-1 text-xs text-ink-700"
          >
            {item}
            <button
              type="button"
              onClick={() => onRemove(item)}
              disabled={disabled}
              className="rounded-full p-0.5 text-ink-400 hover:bg-ink-200 hover:text-ink-700"
              aria-label={`Remove ${item}`}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
