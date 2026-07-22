"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { AGE_RANGES } from "../../../core/config/options";
import { READING_MODES, type AgeBandId } from "../../../core/config/ageWritingCatalog";
import {
  DEFAULT_TYPOGRAPHY,
  recommendFontSize,
  resolveTypography,
  type FontBand,
  type TypographyConfig,
} from "../../../core/config/typography";
import { BOOK_PRODUCTS } from "../../../core/fulfillment";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { Button } from "../../components/Button";
import { Field, Input } from "../../components/Input";
import { Grid, Section, num } from "./products/parts";

const BAND_FIELDS: { key: keyof FontBand; label: string; hint: string }[] = [
  { key: "minPt", label: "Min (pt)", hint: "Smallest age-appropriate size." },
  { key: "idealPt", label: "Ideal (pt)", hint: "Suggested default size." },
  { key: "maxPt", label: "Max (pt)", hint: "Largest age-appropriate size." },
  { key: "cplMin", label: "Min chars/line", hint: "Caps the max size on narrow boxes." },
  { key: "cplMax", label: "Max chars/line", hint: "Comfortable line-length ceiling." },
];

export function TypographyTab() {
  const stored = useAppConfigStore((s) => s.typography);
  const save = useAppConfigStore((s) => s.saveTypography);

  const [draft, setDraft] = useState<TypographyConfig>(stored);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!dirty) setDraft(stored);
  }, [stored, dirty]);

  const resolved = useMemo(() => resolveTypography(draft), [draft]);

  // Unique trims across the catalog (many SKUs share a trim size).
  const trims = useMemo(() => {
    const seen = new Map<string, { widthIn: number; heightIn: number }>();
    for (const p of BOOK_PRODUCTS) {
      const key = `${p.trim.widthIn}x${p.trim.heightIn}`;
      if (!seen.has(key)) seen.set(key, p.trim);
    }
    return [...seen.values()].sort((a, b) => a.widthIn * a.heightIn - b.widthIn * b.heightIn);
  }, []);
  const hasOverride =
    draft.floorPt !== undefined ||
    draft.avgAdvanceEm !== undefined ||
    draft.readingModeScale !== undefined ||
    (draft.bands !== undefined && Object.keys(draft.bands).length > 0);

  const setBandField = (ageId: AgeBandId, key: keyof FontBand, value: number) => {
    setDraft((d) => ({
      ...d,
      bands: { ...d.bands, [ageId]: { ...d.bands?.[ageId], [key]: value } },
    }));
    setDirty(true);
  };

  const setGlobal = (patch: Partial<TypographyConfig>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
  };

  const onSave = async () => {
    setSaving(true);
    try {
      await save(draft);
      setDirty(false);
      toast.success("Typography settings saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save settings.");
    } finally {
      setSaving(false);
    }
  };

  const onReset = () => {
    setDraft({ version: 1 });
    setDirty(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-xs leading-relaxed text-ink-500">
          Recommended font sizes are shown in real points (1 pt = 1/72″) — the same
          absolute unit as Word and Canva — so text stays physically readable on any
          trim. Age drives the point range; a global accessibility floor prevents
          unreadable text on small books; the book format only caps the maximum via a
          characters-per-line target. Empty fields fall back to built-in defaults.
        </p>
        <div className="flex items-center gap-2">
          {hasOverride && (
            <Button variant="ghost" size="sm" leftIcon={<RotateCcw className="size-3.5" />} onClick={onReset}>
              Reset all
            </Button>
          )}
          <Button size="sm" loading={saving} disabled={!dirty} onClick={() => void onSave()}>
            Save changes
          </Button>
        </div>
      </div>

      <Section title="Global" hint="Applies across every age band and book format.">
        <Grid cols={3}>
          <Field label="Accessibility floor (pt)" hint="Never recommend below this size.">
            <Input
              type="number"
              value={resolved.floorPt}
              onChange={(e) => setGlobal({ floorPt: num(e.target.value) })}
            />
          </Field>
          <Field label="Avg glyph advance (em)" hint="Glyph-width factor for the chars/line math.">
            <Input
              type="number"
              step="0.05"
              value={resolved.avgAdvanceEm}
              onChange={(e) => setGlobal({ avgAdvanceEm: num(e.target.value) })}
            />
          </Field>
        </Grid>
      </Section>

      <Section title="Reading-mode multipliers" hint="Scale the band for 6–8 / 9–12 reading modes.">
        <Grid cols={3}>
          {READING_MODES.map((mode) => (
            <Field key={mode.id} label={mode.label}>
              <Input
                type="number"
                step="0.01"
                value={resolved.readingModeScale[mode.id]}
                onChange={(e) =>
                  setGlobal({
                    readingModeScale: { ...draft.readingModeScale, [mode.id]: num(e.target.value) },
                  })
                }
              />
            </Field>
          ))}
        </Grid>
      </Section>

      {AGE_RANGES.map((age) => (
        <Section key={age.id} title={age.label} hint={age.description}>
          <Grid cols={3}>
            {BAND_FIELDS.map((f) => (
              <Field key={f.key} label={f.label} hint={f.hint}>
                <Input
                  type="number"
                  step={f.key.startsWith("cpl") ? "1" : "0.5"}
                  value={resolved.bands[age.id as AgeBandId][f.key]}
                  onChange={(e) => setBandField(age.id as AgeBandId, f.key, num(e.target.value))}
                />
              </Field>
            ))}
          </Grid>
        </Section>
      ))}

      <Section
        title="Preview across formats"
        hint="Recommended range for a text column ~70% of the page width, read-aloud mode."
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-lg border-collapse text-[11px]">
            <thead>
              <tr className="text-left text-ink-400">
                <th className="py-1 pr-3 font-semibold">Format</th>
                {AGE_RANGES.map((a) => (
                  <th key={a.id} className="py-1 pr-3 font-semibold">
                    {a.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {trims.map((trim) => (
                <tr key={`${trim.widthIn}x${trim.heightIn}`} className="border-t border-ink-100 text-ink-600">
                  <td className="py-1 pr-3">
                    {trim.widthIn}″×{trim.heightIn}″
                  </td>
                  {AGE_RANGES.map((a) => {
                    const rec = recommendFontSize({
                      ageRangeId: a.id,
                      readingModeId: "read-aloud",
                      trim,
                      boxWidthIn: trim.widthIn * 0.7,
                      config: draft,
                    });
                    return (
                      <td key={a.id} className="py-1 pr-3 tabular-nums">
                        {rec.minPt}–{rec.maxPt}
                        <span className="text-ink-400"> ({rec.idealPt})</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-ink-400">
          Built-in defaults: floor {DEFAULT_TYPOGRAPHY.floorPt}pt · advance{" "}
          {DEFAULT_TYPOGRAPHY.avgAdvanceEm}em. Shown as min–max (ideal).
        </p>
      </Section>
    </div>
  );
}
