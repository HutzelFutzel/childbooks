"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "../../../components/Button";
import { Field, Input, Textarea } from "../../../components/Input";
import { Toggle } from "../../../components/Toggle";
import { useAppConfigStore } from "../../../../state/appConfigStore";
import {
  COOKIE_CATEGORIES,
  type CookieCategory,
  type CookieConfig,
} from "../../../../core/config/cookieConfig";
import { Section, TextField } from "../products/parts";

const CATEGORY_LABELS: Record<CookieCategory, string> = {
  necessary: "Strictly necessary (always on)",
  analytics: "Analytics",
  marketing: "Marketing",
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
      </Section>

      <Section title="Categories" hint="Descriptions shown in the banner's Customize panel.">
        {COOKIE_CATEGORIES.map((cat) => (
          <Field key={cat} label={CATEGORY_LABELS[cat]}>
            <Textarea
              rows={2}
              value={draft.categoryText[cat]}
              onChange={(e) => setCategory(cat, e.target.value)}
            />
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
