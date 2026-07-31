"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { RotateCcw, Upload } from "lucide-react";
import {
  allBookLayouts,
  COMPOSITION_MODE_LABELS,
  COMPOSITION_MODES,
  type BookLayout,
  type CompositionMode,
} from "../../../core/book/layouts";
import { layoutAvailability, layoutFindings, resolveLayout } from "../../../core/book/layoutCatalog";
import { REGION_TREATMENTS, getTreatment } from "../../../core/book/treatments";
import { BOOK_PRODUCTS } from "../../../core/fulfillment";
import { bookSizeFromAspect, type BookSize } from "../../../core/config/options";
import type { LayoutOverride, LayoutsConfig } from "../../../core/config/layouts";
import { DEFAULT_LAYOUT_QUALITY } from "../../../core/config/layouts";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { Button } from "../../components/Button";
import { Field, Input, Textarea } from "../../components/Input";
import { Select } from "../../components/Select";
import { Toggle } from "../../components/Toggle";
import { LayoutSchematic } from "../../design/LayoutSchematic";
import { cn } from "../../lib/cn";
import { Section } from "./products/parts";

/** Read a File as bare base64 (no data: prefix) + its mime type. */
function readBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(",");
      resolve({
        base64: comma >= 0 ? result.slice(comma + 1) : result,
        mimeType: file.type || "image/png",
      });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const SHAPES: BookSize[] = ["square", "landscape", "portrait"];

/** One product per distinct trim, for the size-availability matrix. */
function representativeProducts() {
  const seen = new Map<string, (typeof BOOK_PRODUCTS)[number]>();
  for (const p of BOOK_PRODUCTS) {
    const key = `${p.trim.widthIn}x${p.trim.heightIn}`;
    if (!seen.has(key)) seen.set(key, p);
  }
  return [...seen.entries()];
}

/**
 * Live availability across every trim we sell.
 *
 * This is the part that makes size rules safe to edit: the readability floor
 * and the aspect guards live in code, so a rule that would leave a 1.4″ text
 * column shows up here as a refusal before anyone's book is affected.
 */
function AvailabilityMatrix({
  layout,
  config,
  mode,
}: {
  layout: BookLayout;
  config: LayoutsConfig;
  mode: CompositionMode;
}) {
  const rows = useMemo(() => {
    return representativeProducts().map(([key, product]) => {
      const resolved = resolveLayout(layout, config, bookSizeFromAspect(product.aspect));
      const availability = layoutAvailability(resolved, { product, config, mode });
      return { key, product, availability };
    });
  }, [layout, config, mode]);

  return (
    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
      {rows.map(({ key, product, availability }) => (
        <div
          key={key}
          className="flex items-center justify-between gap-2 rounded-lg bg-ink-50 px-2.5 py-1.5 text-[11px]"
        >
          <span className="font-medium text-ink-600">
            {key.replace("x", " × ")}″ · {bookSizeFromAspect(product.aspect)}
          </span>
          {availability.ok ? (
            <span className="text-emerald-600">Available</span>
          ) : (
            <span className="text-right text-amber-600">{availability.reason}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function ExampleGallery({ layoutId }: { layoutId: string }) {
  const examples = useAppConfigStore((s) => s.layouts.overrides[layoutId]?.examples ?? []);
  const upload = useAppConfigStore((s) => s.uploadLayoutImage);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [shape, setShape] = useState<BookSize | "">("");
  const [side, setSide] = useState<"" | "left" | "right" | "spread">("");

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const { base64, mimeType } = await readBase64(file);
      await upload(layoutId, base64, mimeType, {
        ...(shape ? { shape } : {}),
        ...(side ? { side } : {}),
      });
      toast.success("Showcase image added.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Page shape" hint="Shown when the reader's book matches.">
          <Select
            value={shape}
            onChange={(e) => setShape(e.target.value as BookSize | "")}
            options={[
              { value: "", label: "Any shape" },
              ...SHAPES.map((s) => ({ value: s, label: s })),
            ]}
          />
        </Field>
        <Field label="Page side">
          <Select
            value={side}
            onChange={(e) => setSide(e.target.value as typeof side)}
            options={[
              { value: "", label: "Any side" },
              { value: "left", label: "Left" },
              { value: "right", label: "Right" },
              { value: "spread", label: "Spread" },
            ]}
          />
        </Field>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => void onPick(e.target.files?.[0])}
        />
        <Button
          variant="secondary"
          size="sm"
          loading={busy}
          leftIcon={<Upload className="size-4" />}
          onClick={() => inputRef.current?.click()}
        >
          Add image
        </Button>
      </div>

      {examples.length === 0 ? (
        <p className="text-[11px] text-ink-400">
          No showcase images yet — the picker falls back to a schematic drawn from the layout's own
          geometry. For a real comparison, upload the same page of the same story in each layout, so
          only the layout differs.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {examples.map((ex) => (
            <div
              key={ex.storagePath ?? ex.imageUrl}
              className="relative w-28 overflow-hidden rounded-lg ring-1 ring-inset ring-ink-200"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={ex.imageUrl} alt={ex.alt ?? ""} className="h-20 w-full object-cover" />
              <div className="px-1.5 py-1 text-[10px] text-ink-500">
                {[ex.shape ?? "any", ex.side ?? "any"].join(" · ")}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LayoutEditor({
  layout,
  config,
  override,
  onChange,
}: {
  layout: BookLayout;
  config: LayoutsConfig;
  override: LayoutOverride;
  onChange: (patch: LayoutOverride) => void;
}) {
  const resolved = resolveLayout(layout, config);
  const [previewShape, setPreviewShape] = useState<BookSize>("square");
  const previewProduct =
    BOOK_PRODUCTS.find((p) => bookSizeFromAspect(p.aspect) === previewShape) ?? BOOK_PRODUCTS[0];

  const slots = layout.spec
    ? [...new Map(Object.values(layout.spec.slots).flat().map((s) => [s.id, s])).values()]
    : [];

  return (
    <Section
      title={resolved.label}
      hint={resolved.description}
      action={
        <Toggle
          checked={override.enabled !== false}
          onChange={(enabled: boolean) => onChange({ ...override, enabled })}
          label="Offered"
        />
      }
    >
      <div className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row">
          <div className="shrink-0 space-y-2">
            <LayoutSchematic
              layout={layout}
              product={previewProduct}
              mode={resolved.defaultMode}
              showSafeArea
              className="w-56"
            />
            <Select
              value={previewShape}
              onChange={(e) => setPreviewShape(e.target.value as BookSize)}
              options={SHAPES.map((s) => ({ value: s, label: `Preview on ${s} pages` }))}
            />
          </div>

          <div className="min-w-0 flex-1 space-y-3">
            <Field label="Title" hint="Shown to readers in the layout picker.">
              <div className="flex items-center gap-2">
                <Input
                  value={override.label ?? layout.label}
                  onChange={(e) => onChange({ ...override, label: e.target.value })}
                  placeholder={layout.label}
                />
                {override.label != null && (
                  <Button
                    variant="ghost"
                    size="sm"
                    leftIcon={<RotateCcw className="size-3.5" />}
                    onClick={() => onChange({ ...override, label: undefined })}
                  >
                    Reset
                  </Button>
                )}
              </div>
            </Field>
            <Field label="Description">
              <Textarea
                rows={2}
                value={override.description ?? layout.description}
                onChange={(e) => onChange({ ...override, description: e.target.value })}
              />
            </Field>
          </div>
        </div>

        <Field
          label="Book sizes"
          hint="Leave all ticked to offer this layout wherever it physically fits. The readability floor below still applies."
        >
          <div className="flex flex-wrap gap-3">
            {SHAPES.map((shape) => {
              const allowed = override.sizes?.shapes;
              const checked = !allowed || allowed.includes(shape);
              return (
                <label key={shape} className="flex items-center gap-1.5 text-xs text-ink-600">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const base = allowed ?? SHAPES;
                      const next = e.target.checked
                        ? [...new Set([...base, shape])]
                        : base.filter((s) => s !== shape);
                      onChange({
                        ...override,
                        sizes: { ...override.sizes, shapes: next.length === SHAPES.length ? undefined : next },
                      });
                    }}
                  />
                  {shape}
                </label>
              );
            })}
          </div>
        </Field>

        <Field label="Art placement" hint="Which composition modes readers may choose.">
          <div className="flex flex-wrap gap-3">
            {COMPOSITION_MODES.filter((m) => layout.supportedModes.includes(m)).map((mode) => {
              const allowed = override.modes?.allowed;
              const checked = !allowed || allowed.includes(mode);
              return (
                <label key={mode} className="flex items-center gap-1.5 text-xs text-ink-600">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const base = allowed ?? layout.supportedModes;
                      const next = e.target.checked
                        ? [...new Set([...base, mode])]
                        : base.filter((m) => m !== mode);
                      // An empty list would offer nothing at all, so the last
                      // one standing can't be unticked.
                      if (next.length === 0) return;
                      onChange({ ...override, modes: { ...override.modes, allowed: next } });
                    }}
                  />
                  {COMPOSITION_MODE_LABELS[mode]}
                </label>
              );
            })}
          </div>
        </Field>

        {slots.length > 0 && (
          <Field
            label="Text regions"
            hint="How the artwork is treated where each text block sits. Prompt-directed treatments fall back to their deterministic equivalent on models with weak negative-space control."
          >
            <div className="space-y-2">
              {slots.map((slot) => {
                const current =
                  override.slots?.[slot.id]?.treatmentId ?? slot.treatmentId ?? "calm";
                const treatment = getTreatment(current);
                return (
                  <div key={slot.id} className="flex flex-wrap items-center gap-2">
                    <span className="w-28 shrink-0 text-xs text-ink-500">
                      {slot.label ?? slot.id}
                    </span>
                    <Select
                      value={current}
                      onChange={(e) =>
                        onChange({
                          ...override,
                          slots: {
                            ...override.slots,
                            [slot.id]: { ...override.slots?.[slot.id], treatmentId: e.target.value },
                          },
                        })
                      }
                      className="max-w-xs"
                      options={REGION_TREATMENTS.map((t) => ({
                        value: t.id,
                        label: `${t.label} (${t.mechanism})`,
                      }))}
                    />
                    <span className="min-w-0 flex-1 text-[11px] text-ink-400">
                      {treatment.description}
                      {treatment.mechanism === "prompt" && treatment.fallback
                        ? ` Falls back to “${getTreatment(treatment.fallback).label}”.`
                        : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          </Field>
        )}

        <Field label="Showcase images">
          <ExampleGallery layoutId={layout.id} />
        </Field>

        <Field label="Availability by book size" hint="Computed live from the rules above.">
          <AvailabilityMatrix layout={layout} config={config} mode={resolved.defaultMode} />
        </Field>
      </div>
    </Section>
  );
}

export function LayoutsTab() {
  const stored = useAppConfigStore((s) => s.layouts);
  const save = useAppConfigStore((s) => s.saveLayouts);

  const [draft, setDraft] = useState<LayoutsConfig>(stored);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Showcase images upload immediately and land in `stored`; pull them into the
  // draft so saving text edits can't wipe an image added moments earlier.
  useEffect(() => {
    if (!dirty) setDraft(stored);
  }, [stored, dirty]);

  const setOverride = (layoutId: string, override: LayoutOverride) => {
    setDraft((prev) => ({
      ...prev,
      overrides: { ...prev.overrides, [layoutId]: override },
    }));
    setDirty(true);
  };

  const onSave = async () => {
    setSaving(true);
    try {
      // Examples are owned by the upload route, so always save the stored ones.
      const overrides = Object.fromEntries(
        Object.entries(draft.overrides).map(([id, o]) => [
          id,
          { ...o, examples: stored.overrides[id]?.examples },
        ]),
      );
      await save({ ...draft, overrides });
      setDirty(false);
      toast.success("Layout settings saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save layouts.");
    } finally {
      setSaving(false);
    }
  };

  const quality = { ...DEFAULT_LAYOUT_QUALITY, ...(draft.quality ?? {}) };
  const findings = useMemo(() => layoutFindings(draft, BOOK_PRODUCTS), [draft]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-xs leading-relaxed text-ink-500">
          Layouts themselves are defined in code — where the text sits is the same geometry the
          image prompt is compiled from, so it can't be edited here without the two drifting apart.
          What you control is how each one is presented and where it's offered.
        </p>
        <Button size="sm" loading={saving} disabled={!dirty} onClick={() => void onSave()}>
          Save changes
        </Button>
      </div>

      {findings.length > 0 && (
        <Section title="Checks" hint="Run live against the book sizes you sell.">
          <ul className="space-y-1.5">
            {findings.map((f, i) => (
              <li key={i} className="flex items-start gap-2 text-[11px] leading-relaxed">
                <span
                  className={cn(
                    "mt-1 size-1.5 shrink-0 rounded-full",
                    f.severity === "error"
                      ? "bg-rose-500"
                      : f.severity === "warning"
                        ? "bg-amber-500"
                        : "bg-ink-300",
                  )}
                />
                <span>
                  <span className="font-medium text-ink-600">{f.title}</span>{" "}
                  <span className="text-ink-400">{f.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section
        title="Calm-region check"
        hint="Every page is measured where its text sits, after the artwork is generated."
      >
        <div className="flex flex-wrap items-end gap-3">
          <Field
            label="Busyness limit"
            hint="0 = perfectly flat, 1 = maximally busy. Above this, the region is treated as failed."
          >
            <Input
              type="number"
              step="0.01"
              min="0"
              max="1"
              value={quality.maxTextRegionBusyness}
              onChange={(e) => {
                setDraft((prev) => ({
                  ...prev,
                  quality: { ...prev.quality, maxTextRegionBusyness: Number(e.target.value) },
                }));
                setDirty(true);
              }}
            />
          </Field>
          <Field label="When a page fails">
            <Select
              value={quality.onFail}
              onChange={(e) => {
                setDraft((prev) => ({
                  ...prev,
                  quality: { ...prev.quality, onFail: e.target.value as typeof quality.onFail },
                }));
                setDirty(true);
              }}
              options={[
                { value: "ignore", label: "Do nothing" },
                { value: "warn", label: "Flag the page for the reader" },
                { value: "scrim", label: "Apply the fallback treatment automatically" },
                { value: "retry-once", label: "Re-generate once, then flag" },
              ]}
            />
          </Field>
        </div>
      </Section>

      <div className="space-y-3">
        {allBookLayouts().map((layout) => (
          <LayoutEditor
            key={layout.id}
            layout={layout}
            config={draft}
            override={draft.overrides[layout.id] ?? {}}
            onChange={(patch) => setOverride(layout.id, patch)}
          />
        ))}
      </div>
    </div>
  );
}