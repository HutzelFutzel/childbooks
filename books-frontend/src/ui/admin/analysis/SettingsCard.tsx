"use client";

import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { useAdminAnalytics } from "../../../state/adminAnalyticsStore";
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
      </CardBody>
    </div>
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
