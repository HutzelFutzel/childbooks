"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "../../../components/Button";
import { Field, Input, Textarea } from "../../../components/Input";
import { Toggle } from "../../../components/Toggle";
import { useAppConfigStore } from "../../../../state/appConfigStore";
import {
  COOKIE_BUTTON_LABEL_KEYS,
  COOKIE_CATEGORIES,
  MAX_ENTRANCE_DELAY_MS,
  type CookieButtonLabels,
  type CookieCategory,
  type CookieConfig,
} from "../../../../core/config/cookieConfig";
import { Section, TextField } from "../products/parts";

const CATEGORY_FIELD_LABELS: Record<CookieCategory, string> = {
  necessary: "Strictly necessary (always on)",
  analytics: "Analytics",
  marketing: "Marketing",
};

/** Admin-facing labels + a legal-safety hint for each button/link field. */
const BUTTON_LABEL_FIELDS: Record<keyof CookieButtonLabels, { label: string; hint?: string }> = {
  acceptAll: { label: "Accept-all button" },
  rejectAll: {
    label: "Reject-all button",
    hint:
      "Must keep reading as a real, one-click \"reject/refuse\" action — GDPR requires declining to be " +
      "as easy as accepting, so avoid vague wording that hides what this button does.",
  },
  customize: { label: "Customize link" },
  save: { label: "Save-choices link (shown while customizing)" },
  close: { label: "Close link (shown once a decision exists)" },
  learnMore: { label: "\"Learn more\" link text" },
};

/**
 * Legal & Privacy → Cookies. Edits the world-readable `appConfig/cookieConfig`:
 * the banner copy, per-category descriptions, and the consent version. Bumping
 * the consent version makes every visitor re-consent on their next visit.
 * Analytics (Google Analytics for Firebase) only loads once a visitor grants the
 * analytics category — the banner enforces this automatically.
 */
export function CookieConsentTab() {
  const stored = useAppConfigStore((s) => s.cookieConfig);
  const save = useAppConfigStore((s) => s.saveCookieConfig);

  const [draft, setDraft] = useState<CookieConfig>(stored);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!dirty) setDraft(stored);
  }, [stored, dirty]);

  const set = (patch: Partial<CookieConfig>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
  };
  const setCategory = (cat: CookieCategory, value: string) =>
    set({ categoryText: { ...draft.categoryText, [cat]: value } });
  const setCategoryLabel = (cat: CookieCategory, value: string) =>
    set({ categoryLabels: { ...draft.categoryLabels, [cat]: value } });
  const setButtonLabel = (key: keyof CookieButtonLabels, value: string) =>
    set({ buttonLabels: { ...draft.buttonLabels, [key]: value } });

  const maxDelaySeconds = MAX_ENTRANCE_DELAY_MS / 1000;
  const setEntranceDelaySeconds = (raw: string) => {
    const seconds = Number(raw);
    const ms = Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0;
    // Clamp client-side too so the field can't even display an out-of-range
    // value while typing — the backend enforces the same cap on save.
    set({ entranceDelayMs: Math.min(Math.max(ms, 0), MAX_ENTRANCE_DELAY_MS) });
  };

  const onSave = async () => {
    setSaving(true);
    try {
      await save(draft);
      setDirty(false);
      toast.success("Cookie settings saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  const bumpVersion = () => {
    const n = Number(draft.consentVersion);
    set({ consentVersion: Number.isFinite(n) ? String(n + 1) : `${draft.consentVersion}-2` });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-xs leading-relaxed text-ink-500">
          The first-party cookie banner. Analytics and marketing trackers stay off
          until a visitor grants them — no analytics cookies fire before consent.
          Bump the <strong>consent version</strong> after a material change to make
          everyone re-consent.
        </p>
        <div className="flex gap-2">
          {dirty && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDraft(stored);
                setDirty(false);
              }}
            >
              Discard
            </Button>
          )}
          <Button size="sm" onClick={onSave} loading={saving} disabled={!dirty}>
            Save cookie settings
          </Button>
        </div>
      </div>

      <Section title="Banner" hint="Master switch + the copy shown to visitors.">
        <label className="flex items-center gap-2 text-sm text-ink-700">
          <Toggle checked={draft.enabled} onChange={(v) => set({ enabled: v })} label="Banner enabled" />
          Banner enabled {draft.enabled ? "" : "— the banner is hidden and non-essential cookies stay off"}
        </label>
        <TextField label="Title" value={draft.title} onChange={(v) => set({ title: v })} />
        <Field label="Body">
          <Textarea rows={3} value={draft.body} onChange={(e) => set({ body: e.target.value })} />
        </Field>
        <Field
          label="Entrance delay"
          hint={
            `Wait this long after page load before showing the banner (0–${maxDelaySeconds}s). ` +
            "This only changes when the prompt appears, not whether tracking is allowed — analytics " +
            "and marketing stay off by default for the whole delay, and Accept/Reject remain equally " +
            "one-click once shown. Capped so it can't be used to effectively hide the notice."
          }
        >
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              max={maxDelaySeconds}
              step={0.5}
              value={draft.entranceDelayMs / 1000}
              onChange={(e) => setEntranceDelaySeconds(e.target.value)}
              className="h-9 w-24"
            />
            <span className="text-xs text-ink-500">seconds</span>
          </div>
        </Field>
      </Section>

      <Section
        title="Categories"
        hint="Display name + description shown in the banner's Customize panel."
      >
        {COOKIE_CATEGORIES.map((cat) => (
          <div key={cat} className="space-y-2 rounded-lg bg-white/60 p-2.5 ring-1 ring-inset ring-ink-100">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">
              {CATEGORY_FIELD_LABELS[cat]}
            </div>
            <TextField
              label="Display name"
              value={draft.categoryLabels[cat]}
              onChange={(v) => setCategoryLabel(cat, v)}
            />
            <Field label="Description">
              <Textarea
                rows={2}
                value={draft.categoryText[cat]}
                onChange={(e) => setCategory(cat, e.target.value)}
              />
            </Field>
          </div>
        ))}
      </Section>

      <Section
        title="Buttons & labels"
        hint="The exact text on every banner button/link. Keep wording clear and accurate — see the note on Reject-all."
      >
        {COOKIE_BUTTON_LABEL_KEYS.map((key) => (
          <Field key={key} label={BUTTON_LABEL_FIELDS[key].label} hint={BUTTON_LABEL_FIELDS[key].hint}>
            <Input value={draft.buttonLabels[key]} onChange={(e) => setButtonLabel(key, e.target.value)} />
          </Field>
        ))}
      </Section>

      <Section
        title="Consent version"
        hint="Bump this after a material change to your cookie use to force everyone to re-consent."
        action={
          <Button variant="secondary" size="sm" onClick={bumpVersion}>
            Bump version
          </Button>
        }
      >
        <Field label="Current version">
          <Input value={draft.consentVersion} onChange={(e) => set({ consentVersion: e.target.value })} />
        </Field>
      </Section>
    </div>
  );
}
