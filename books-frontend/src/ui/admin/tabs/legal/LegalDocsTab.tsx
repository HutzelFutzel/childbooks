"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Mail, Plus, Trash2 } from "lucide-react";
import { Button } from "../../../components/Button";
import { Field, Input } from "../../../components/Input";
import { Select } from "../../../components/Select";
import { Toggle } from "../../../components/Toggle";
import { useAppConfigStore } from "../../../../state/appConfigStore";
import {
  LEGAL_ROLES,
  newLegalLinkId,
  type LegalConfig,
  type LegalLink,
  type LegalRole,
} from "../../../../core/config/legal";
import { Grid, Section, TextField } from "../products/parts";

const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "None (extra document)" },
  ...LEGAL_ROLES.map((r) => ({ value: r, label: r[0].toUpperCase() + r.slice(1) })),
];

/**
 * Legal & Privacy → Documents. Edits the world-readable `appConfig/legal`: a
 * dynamic list of legal document links (Terms, Privacy, Refund, …). Each is a
 * label + URL, an optional role tag (so the signup line / cookie banner can find
 * a specific document), placement flags, and a version that drives re-consent.
 * Bump a document's version and use "Notify users" to email everyone about a
 * material change.
 */
export function LegalDocsTab() {
  const stored = useAppConfigStore((s) => s.legal);
  const save = useAppConfigStore((s) => s.saveLegal);
  const notify = useAppConfigStore((s) => s.notifyPolicyUpdate);

  const [draft, setDraft] = useState<LegalConfig>(stored);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notifying, setNotifying] = useState<string | null>(null);

  useEffect(() => {
    if (!dirty) setDraft(stored);
  }, [stored, dirty]);

  const update = (id: string, patch: Partial<LegalLink>) => {
    setDraft((d) => ({
      ...d,
      links: d.links.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    }));
    setDirty(true);
  };

  const add = () => {
    setDraft((d) => ({
      ...d,
      links: [
        ...d.links,
        {
          id: newLegalLinkId(),
          label: "",
          url: "",
          role: null,
          version: "1",
          effectiveDate: "",
          showInFooter: true,
          showAtSignup: false,
          euOnly: false,
        },
      ],
    }));
    setDirty(true);
  };

  const remove = (id: string) => {
    setDraft((d) => ({ ...d, links: d.links.filter((l) => l.id !== id) }));
    setDirty(true);
  };

  const onSave = async () => {
    setSaving(true);
    try {
      await save(draft);
      setDirty(false);
      toast.success("Legal documents saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  const onNotify = async (role: LegalRole, label: string) => {
    if (dirty) {
      toast.error("Save your changes first, then notify users.");
      return;
    }
    if (
      !window.confirm(
        `Email ALL users about the updated "${label}"? This sends the "Policy update" email once per user for the current version.`,
      )
    )
      return;
    setNotifying(role);
    try {
      const { recipients, sent } = await notify(role);
      toast.success(`Notified users — ${sent} sent of ${recipients} accounts.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send notifications.");
    } finally {
      setNotifying(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-xs leading-relaxed text-ink-500">
          Legal documents shown in the footer + signup. Each is just a label and a
          URL (host the actual text wherever you like). Tag a document with a{" "}
          <strong>role</strong> so the signup consent line and cookie banner can
          link to the right one. Bump a document&apos;s <strong>version</strong> when
          it changes materially, then use <em>Notify users</em> to email everyone.
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
            Save documents
          </Button>
        </div>
      </div>

      <Section
        title="EU mode"
        hint="Turn on when you launch in the EU. EU-only documents (like the Imprint / Impressum) stay hidden until this is on — so you can prepare them while testing in the US."
      >
        <label className="flex items-center gap-2 text-sm text-ink-700">
          <Toggle
            checked={draft.euMode}
            onChange={(v) => {
              setDraft((d) => ({ ...d, euMode: v }));
              setDirty(true);
            }}
            label="EU mode enabled"
          />
          EU mode {draft.euMode ? "on — EU-only documents are visible" : "off — EU-only documents are hidden"}
        </label>
      </Section>

      <div className="space-y-2">
        {draft.links.map((link) => (
          <Section key={link.id} title={link.label || "Untitled document"}>
            <Grid cols={2}>
              <TextField label="Label" value={link.label} onChange={(v) => update(link.id, { label: v })} />
              <TextField
                label="URL"
                value={link.url}
                placeholder="https://…"
                onChange={(v) => update(link.id, { url: v })}
              />
            </Grid>
            <Grid cols={3}>
              <Field label="Role">
                <Select
                  value={link.role ?? ""}
                  options={ROLE_OPTIONS}
                  onChange={(e) =>
                    update(link.id, { role: (e.target.value || null) as LegalRole | null })
                  }
                />
              </Field>
              <TextField
                label="Version"
                value={link.version}
                onChange={(v) => update(link.id, { version: v })}
              />
              <Field label="Effective date (optional)">
                <Input
                  type="date"
                  value={link.effectiveDate}
                  onChange={(e) => update(link.id, { effectiveDate: e.target.value })}
                />
              </Field>
            </Grid>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <label className="flex items-center gap-2 text-sm text-ink-700">
                <Toggle
                  checked={link.showInFooter}
                  onChange={(v) => update(link.id, { showInFooter: v })}
                  label="Show in footer"
                />
                Show in footer
              </label>
              <label className="flex items-center gap-2 text-sm text-ink-700">
                <Toggle
                  checked={link.showAtSignup}
                  onChange={(v) => update(link.id, { showAtSignup: v })}
                  label="Show at signup"
                />
                Show at signup
              </label>
              <label className="flex items-center gap-2 text-sm text-ink-700">
                <Toggle
                  checked={link.euOnly}
                  onChange={(v) => update(link.id, { euOnly: v })}
                  label="EU only"
                />
                EU only
              </label>
              <div className="ml-auto flex gap-2">
                {link.role && (
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<Mail className="size-3.5" />}
                    loading={notifying === link.role}
                    onClick={() => onNotify(link.role as LegalRole, link.label)}
                  >
                    Notify users
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<Trash2 className="size-3.5" />}
                  onClick={() => remove(link.id)}
                >
                  Remove
                </Button>
              </div>
            </div>
          </Section>
        ))}
      </div>

      <Button variant="secondary" size="sm" leftIcon={<Plus className="size-3.5" />} onClick={add}>
        Add document
      </Button>
    </div>
  );
}
