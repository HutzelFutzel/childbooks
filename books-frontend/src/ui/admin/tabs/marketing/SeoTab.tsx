"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Search, Share2 } from "lucide-react";
import { Button } from "../../../components/Button";
import { Field, Input, Textarea } from "../../../components/Input";
import { Select } from "../../../components/Select";
import { Toggle } from "../../../components/Toggle";
import { useAppConfigStore } from "../../../../state/appConfigStore";
import type { SeoConfig, SeoFaqItem } from "../../../../core/config/seo";
import { Grid, Section, TextField } from "../products/parts";

/** Recommended meta-description length window (Google typically truncates ~160). */
const DESC_MIN = 120;
const DESC_MAX = 160;

/** Recommended <title> pixel-ish length window (roughly 50–60 chars). */
const TITLE_MAX = 60;

/**
 * Editor for the **marketing SEO** config (`appConfig/seo`). Owns the landing
 * page's title/description, canonical + social metadata, robots indexing,
 * search-console verification, Organization structured data, and the FAQ that
 * feeds both the on-page accordion and the FAQPage rich result. Reads live from
 * the public config doc; saves through the admin backend route.
 */
export function SeoTab() {
  const stored = useAppConfigStore((s) => s.seo);
  const ogImage = useAppConfigStore((s) => s.branding.ogImage);
  const save = useAppConfigStore((s) => s.saveSeoConfig);

  const [draft, setDraft] = useState<SeoConfig>(stored);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!dirty) setDraft(stored);
  }, [stored, dirty]);

  const set = (patch: Partial<SeoConfig>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
  };

  const setFaq = (idx: number, patch: Partial<SeoFaqItem>) => {
    set({ faq: draft.faq.map((f, i) => (i === idx ? { ...f, ...patch } : f)) });
  };

  const addFaq = () => set({ faq: [...draft.faq, { question: "", answer: "" }] });
  const removeFaq = (idx: number) => set({ faq: draft.faq.filter((_, i) => i !== idx) });

  const keywordsText = useMemo(() => draft.keywords.join(", "), [draft.keywords]);
  const sameAsText = useMemo(() => draft.organization.sameAs.join("\n"), [draft.organization.sameAs]);

  const onSave = async () => {
    setSaving(true);
    try {
      await save(draft);
      setDirty(false);
      toast.success("SEO settings saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save SEO settings.");
    } finally {
      setSaving(false);
    }
  };

  const descLen = draft.description.length;
  const titleLen = draft.titleDefault.length;
  const canonicalUrl = `${draft.siteUrl}${draft.canonicalPath}`;
  const displayHost = draft.siteUrl.replace(/^https?:\/\//, "");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-xs leading-relaxed text-ink-500">
          Everything that controls how the public landing page appears in search
          results and social shares. Changes are stored in Firebase and picked up
          on the next page render — no deploy needed.
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
            Save SEO settings
          </Button>
        </div>
      </div>

      {/* ---- General ---- */}
      <Section
        title="General"
        hint="Core identity and the default page title/description used across the site."
      >
        <Grid cols={2}>
          <TextField label="Site name" value={draft.siteName} onChange={(v) => set({ siteName: v })} />
          <TextField
            label="Site URL"
            value={draft.siteUrl}
            placeholder="https://childbook.studio"
            onChange={(v) => set({ siteUrl: v })}
          />
        </Grid>

        <Field
          label="Default title"
          hint={`${titleLen} characters — aim for under ${TITLE_MAX} so it isn't truncated.`}
        >
          <div className="relative">
            <Input
              value={draft.titleDefault}
              onChange={(e) => set({ titleDefault: e.target.value })}
              className={titleLen > TITLE_MAX ? "ring-amber-400" : undefined}
            />
          </div>
        </Field>

        <Grid cols={2}>
          <TextField
            label="Title template"
            value={draft.titleTemplate}
            placeholder="%s · Childbook Studio"
            onChange={(v) => set({ titleTemplate: v })}
          />
          <TextField
            label="Canonical path"
            value={draft.canonicalPath}
            placeholder="/"
            onChange={(v) => set({ canonicalPath: v })}
          />
        </Grid>

        <Field
          label="Meta description"
          hint={`${descLen} characters — the sweet spot is ${DESC_MIN}–${DESC_MAX}.`}
        >
          <Textarea
            rows={3}
            value={draft.description}
            onChange={(e) => set({ description: e.target.value })}
            className={descLen > DESC_MAX ? "ring-amber-400" : undefined}
          />
        </Field>

        <Field label="Keywords" hint="Comma-separated. Minor ranking factor, but harmless.">
          <Input
            value={keywordsText}
            placeholder="children's books, AI illustration, picture book maker"
            onChange={(e) =>
              set({ keywords: e.target.value.split(",").map((k) => k.trim()).filter(Boolean) })
            }
          />
        </Field>
      </Section>

      {/* ---- Social / Twitter ---- */}
      <Section
        title="Social sharing"
        hint="Text metadata for shares. The share image, logo, favicon and theme color live under Marketing → Branding."
      >
        <Grid cols={2}>
          <TextField
            label="Twitter handle"
            value={draft.twitterHandle}
            placeholder="@childbook"
            onChange={(v) => set({ twitterHandle: v })}
          />
          <Field label="Twitter card">
            <Select
              value={draft.twitterCard}
              options={[
                { value: "summary_large_image", label: "Large image" },
                { value: "summary", label: "Summary" },
              ]}
              onChange={(e) => set({ twitterCard: e.target.value as SeoConfig["twitterCard"] })}
            />
          </Field>
        </Grid>
      </Section>

      {/* ---- Indexing & verification ---- */}
      <Section
        title="Indexing & verification"
        hint="Turn indexing off for staging. Verification tokens connect the site to search-engine webmaster tools."
      >
        <div className="flex flex-wrap gap-6">
          <label className="flex items-center gap-2 text-sm text-ink-700">
            <Toggle
              checked={draft.robots.index}
              onChange={(v) => set({ robots: { ...draft.robots, index: v } })}
              label="Allow indexing"
            />
            Allow indexing
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-700">
            <Toggle
              checked={draft.robots.follow}
              onChange={(v) => set({ robots: { ...draft.robots, follow: v } })}
              label="Follow links"
            />
            Follow links
          </label>
        </div>
        <Grid cols={2}>
          <TextField
            label="Google verification token"
            value={draft.verification.google}
            onChange={(v) => set({ verification: { ...draft.verification, google: v } })}
          />
          <TextField
            label="Bing verification token"
            value={draft.verification.bing}
            onChange={(v) => set({ verification: { ...draft.verification, bing: v } })}
          />
        </Grid>
      </Section>

      {/* ---- Organization (structured data) ---- */}
      <Section
        title="Organization (structured data)"
        hint="Powers the Organization JSON-LD that search engines use for your brand knowledge panel. The logo comes from Marketing → Branding."
      >
        <TextField
          label="Organization name"
          value={draft.organization.name}
          onChange={(v) => set({ organization: { ...draft.organization, name: v } })}
        />
        <Field label="Social / profile URLs" hint="One per line (schema.org sameAs).">
          <Textarea
            rows={3}
            value={sameAsText}
            placeholder={"https://twitter.com/childbook\nhttps://instagram.com/childbook"}
            onChange={(e) =>
              set({
                organization: {
                  ...draft.organization,
                  sameAs: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean),
                },
              })
            }
          />
        </Field>
      </Section>

      {/* ---- FAQ (single source of truth) ---- */}
      <Section
        title="FAQ"
        hint="Shown on the landing page AND emitted as FAQPage structured data (rich results). One source of truth."
        action={
          <Button variant="secondary" size="sm" leftIcon={<Plus className="size-3.5" />} onClick={addFaq}>
            Add question
          </Button>
        }
      >
        <div className="space-y-2">
          {draft.faq.map((item, idx) => (
            <div key={idx} className="space-y-2 rounded-lg bg-white p-2.5 ring-1 ring-inset ring-ink-100">
              <div className="flex items-start gap-2">
                <Input
                  value={item.question}
                  placeholder="Question"
                  onChange={(e) => setFaq(idx, { question: e.target.value })}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<Trash2 className="size-3.5" />}
                  onClick={() => removeFaq(idx)}
                />
              </div>
              <Textarea
                rows={2}
                value={item.answer}
                placeholder="Answer"
                onChange={(e) => setFaq(idx, { answer: e.target.value })}
              />
            </div>
          ))}
          {draft.faq.length === 0 && <p className="text-xs text-ink-400">No FAQ entries yet.</p>}
        </div>
      </Section>

      {/* ---- Live previews ---- */}
      <Section title="Previews" hint="Approximate how the page appears in search and social.">
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Google result */}
          <div className="space-y-1.5 rounded-lg bg-white p-4 ring-1 ring-inset ring-ink-100">
            <div className="flex items-center gap-1.5 text-xs text-ink-400">
              <Search className="size-3.5" /> Search result
            </div>
            <div className="truncate text-xs text-ink-500">{canonicalUrl}</div>
            <div className="truncate text-lg leading-tight text-[#1a0dab]">
              {draft.titleDefault || "Untitled"}
            </div>
            <p className="line-clamp-2 text-sm text-ink-600">{draft.description}</p>
          </div>

          {/* Social card */}
          <div className="space-y-2 rounded-lg bg-white p-4 ring-1 ring-inset ring-ink-100">
            <div className="flex items-center gap-1.5 text-xs text-ink-400">
              <Share2 className="size-3.5" /> Social card
            </div>
            <div className="overflow-hidden rounded-lg ring-1 ring-ink-100">
              <div className="aspect-1200/630 w-full bg-linear-to-br from-brand-100 to-accent-100">
                {ogImage?.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={ogImage.imageUrl} alt={ogImage.alt ?? ""} className="size-full object-cover" />
                ) : (
                  <div className="flex size-full items-center justify-center px-4 text-center text-xs text-ink-500">
                    Set a share image under Marketing → Branding
                  </div>
                )}
              </div>
              <div className="space-y-0.5 p-3">
                <div className="text-[11px] uppercase tracking-wide text-ink-400">{displayHost}</div>
                <div className="truncate text-sm font-semibold text-ink-800">{draft.titleDefault}</div>
                <p className="line-clamp-2 text-xs text-ink-500">{draft.description}</p>
              </div>
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
}
