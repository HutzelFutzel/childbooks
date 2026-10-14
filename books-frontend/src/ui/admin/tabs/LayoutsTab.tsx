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
import type {
  LayoutCompositionConfig,
  LayoutExample,
  LayoutOverride,
  LayoutsConfig,
} from "../../../core/config/layouts";
import {
  DEFAULT_LAYOUT_QUALITY,
  PICTURE_SCALE_RANGE,
  resolveLayoutComposition,
  TEXT_WIDTH_RANGE,
} from "../../../core/config/layouts";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { Button } from "../../components/Button";
import { Field, Input, Textarea } from "../../components/Input";
import { Select } from "../../components/Select";
import { Toggle } from "../../components/Toggle";
import { LayoutSchematic } from "../../design/LayoutSchematic";
import { cn } from "../../lib/cn";
import { Section } from "./products/parts";
import { ImageMasksPanel } from "./ImageMasksPanel";

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

/** Stable empty result for layouts with no showcase images. See below. */
const NO_EXAMPLES: LayoutExample[] = [];

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
  // Shared constant, not a fresh `[]`: a store selector is a snapshot getter,
  // so returning a new reference for a layout that has no examples yet makes
  // every read look like a change and React reports a possible infinite loop.
  const examples = useAppConfigStore((s) => s.layouts.overrides[layoutId]?.examples ?? NO_EXAMPLES);
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

/** Whole-number percent from a 0..1 share; empty string when unset. */
const pctText = (v: number | undefined) => (typeof v === "number" ? String(Math.round(v * 100)) : "");

const clampShare = (v: number, range: { min: number; max: number }) =>
  Math.min(range.max, Math.max(range.min, v));

/**
 * What the two page-shape settings do, drawn to scale: the page, the picture
 * at its chosen size, and the story text box inside its reserved area.
 */
function PageShapePreview({ pictureScale, textWidth }: { pictureScale: number; textWidth: number }) {
  const inset = ((1 - pictureScale) / 2) * 100;
  // The default layout reserves the outer third of the page for the words.
  const column = { left: 5.9, width: 29.5 };
  const boxW = column.width * textWidth;
  const boxLeft = column.left + (column.width - boxW) / 2;
  return (
    <div
      className="relative aspect-square w-40 shrink-0 border border-ink-200 bg-[#f4ecd8]"
      role="img"
      aria-label={`Page preview: picture at ${Math.round(pictureScale * 100)}% of the page, text box at ${Math.round(textWidth * 100)}% of its area`}
    >
      <div
        className="absolute bg-sky-200/80"
        style={{ left: `${inset}%`, top: `${inset}%`, right: `${inset}%`, bottom: `${inset}%` }}
      />
      <div
        className="absolute border border-dashed border-ink-400"
        style={{ left: `${column.left}%`, width: `${column.width}%`, top: "30%", height: "40%" }}
      />
      <div
        className="absolute border border-ink-700 bg-white/85"
        style={{ left: `${boxLeft}%`, width: `${boxW}%`, top: "38%", height: "24%" }}
      />
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

        <Field
          label="Story text width (% of its text area)"
          hint={`Leave empty to use the book-wide setting (${Math.round(resolveLayoutComposition(config).textWidth * 100)}%). 100 fills the reserved area; less leaves even room on both sides. Only affects text boxes created from now on.`}
        >
          <Input
            type="number"
            step="1"
            min={Math.round(TEXT_WIDTH_RANGE.min * 100)}
            max={Math.round(TEXT_WIDTH_RANGE.max * 100)}
            className="max-w-[10rem]"
            placeholder={String(Math.round(resolveLayoutComposition(config).textWidth * 100))}
            value={pctText(override.textWidth)}
            onChange={(e) => {
              const next = { ...override };
              if (e.target.value === "") delete next.textWidth;
              else next.textWidth = Number(e.target.value) / 100;
              onChange(next);
            }}
          />
        </Field>

        <Field
          label="Inset artwork background"
          hint="Used only when this layout places art beside the text. Full-bleed pages and covers remain opaque."
        >
          <Select
            value={override.imageGeneration?.background ?? "default"}
            onChange={(event) => {
              const background = event.target.value;
              const next = { ...override };
              if (background === "default") {
                const imageGeneration = { ...next.imageGeneration };
                delete imageGeneration.background;
                if (Object.keys(imageGeneration).length > 0) {
                  next.imageGeneration = imageGeneration;
                } else {
                  delete next.imageGeneration;
                }
              } else {
                next.imageGeneration = {
                  ...next.imageGeneration,
                  background: "prefer-transparent",
                };
              }
              onChange(next);
            }}
            options={[
              { value: "default", label: "Inherit from art style" },
              {
                value: "prefer-transparent",
                label: "Transparent when supported",
              },
            ]}
          />
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
      // Number fields hold whatever was typed so editing isn't fought; bring
      // the two page-shape settings inside their limits before saving.
      const composition = draft.composition ? { ...draft.composition } : undefined;
      if (composition?.pictureScale != null) {
        composition.pictureScale = clampShare(composition.pictureScale, PICTURE_SCALE_RANGE);
      }
      if (composition?.textWidth != null) {
        composition.textWidth = clampShare(composition.textWidth, TEXT_WIDTH_RANGE);
      }
      for (const o of Object.values(overrides)) {
        if (o.textWidth != null) o.textWidth = clampShare(o.textWidth, TEXT_WIDTH_RANGE);
      }
      await save({ ...draft, overrides, ...(composition ? { composition } : {}) });
      setDirty(false);
      toast.success("Layout settings saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save layouts.");
    } finally {
      setSaving(false);
    }
  };

  const quality = { ...DEFAULT_LAYOUT_QUALITY, ...(draft.quality ?? {}) };
  const compositionSettings = resolveLayoutComposition(draft);
  const setComposition = (patch: LayoutCompositionConfig) => {
    setDraft((prev) => ({ ...prev, composition: { ...prev.composition, ...patch } }));
    setDirty(true);
  };
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

      <ImageMasksPanel />

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
                { value: "warn", label: "Record it on the page only" },
                { value: "scrim", label: "Put a soft plate under the words" },
                { value: "retry-once", label: "Redraw once with a larger calm area, then plate" },
              ]}
            />
          </Field>
        </div>
        <p className="mt-2 max-w-2xl text-[11px] leading-relaxed text-ink-400">
          A redraw is never charged to the reader who triggered it. Its cost is part of the page's
          full cost, so with the &ldquo;full cost&rdquo; basis in Sparks pricing it reaches the price
          as part of the window&rsquo;s average.
        </p>
      </Section>

      <Section
        title="Page shape"
        hint="How big the picture is on each inside page and how wide the story text starts out. Covers always fill the page."
      >
        <div className="flex flex-wrap items-start gap-6">
          <PageShapePreview
            pictureScale={compositionSettings.pictureScale}
            textWidth={compositionSettings.textWidth}
          />
          <div className="min-w-0 flex-1 space-y-4">
            <Field
              label="Picture size on the page (%)"
              hint="100 fills the page edge to edge. 95 shrinks the picture evenly toward the middle, so a thin strip of the page color shows on all four sides. The picture is never cropped."
            >
              <Input
                type="number"
                step="1"
                min={Math.round(PICTURE_SCALE_RANGE.min * 100)}
                max={Math.round(PICTURE_SCALE_RANGE.max * 100)}
                className="max-w-[10rem]"
                value={pctText(draft.composition?.pictureScale ?? compositionSettings.pictureScale)}
                onChange={(e) =>
                  setComposition({ pictureScale: e.target.value === "" ? undefined : Number(e.target.value) / 100 })
                }
                onBlur={() => {
                  const raw = draft.composition?.pictureScale;
                  if (raw != null && raw !== compositionSettings.pictureScale) {
                    setComposition({ pictureScale: compositionSettings.pictureScale });
                  }
                }}
              />
            </Field>
            <p className="max-w-2xl text-[11px] leading-relaxed text-ink-500">
              {compositionSettings.pictureScale >= 1
                ? "The picture fills the whole page."
                : `The picture covers ${Math.round(compositionSettings.pictureScale * 100)}% of the page width and height. ` +
                  representativeProducts()
                    .map(([, p]) => {
                      const sideIn = ((1 - compositionSettings.pictureScale) / 2) * p.trim.widthIn;
                      const topIn = ((1 - compositionSettings.pictureScale) / 2) * p.trim.heightIn;
                      return `On ${p.trim.widthIn} × ${p.trim.heightIn} in, the page color shows ${sideIn.toFixed(2)} in at the sides and ${topIn.toFixed(2)} in top and bottom.`;
                    })
                    .join(" ")}{" "}
              Set the page color in the book&rsquo;s design. Only pictures placed from now on use this;
              pages already in a book keep their size.
            </p>
            <Field
              label="Story text width (% of its text area)"
              hint="100 makes the text box as wide as the area its layout reserves; 80 leaves a tenth of that area free on each side. A layout can override this in its own settings below."
            >
              <Input
                type="number"
                step="1"
                min={Math.round(TEXT_WIDTH_RANGE.min * 100)}
                max={Math.round(TEXT_WIDTH_RANGE.max * 100)}
                className="max-w-[10rem]"
                value={pctText(draft.composition?.textWidth ?? compositionSettings.textWidth)}
                onChange={(e) =>
                  setComposition({ textWidth: e.target.value === "" ? undefined : Number(e.target.value) / 100 })
                }
                onBlur={() => {
                  const raw = draft.composition?.textWidth;
                  if (raw != null && raw !== compositionSettings.textWidth) {
                    setComposition({ textWidth: compositionSettings.textWidth });
                  }
                }}
              />
            </Field>
          </div>
        </div>
      </Section>

      <Section
        title="Composition margins"
        hint="Keeps faces out of the edges that frames and print trimming cut, and gives the words room."
      >
        <div className="flex flex-wrap items-end gap-3">
          <Field
            label="Subject-free edge (%)"
            hint="Share of each side kept free of faces and important subjects. Background still runs to the edge."
          >
            <Input
              type="number"
              step="1"
              min="0"
              max="25"
              value={Math.round(compositionSettings.subjectSafeInset * 100)}
              onChange={(e) => setComposition({ subjectSafeInset: Number(e.target.value) / 100 })}
            />
          </Field>
          <Field
            label="Widen for frames"
            hint="Use the book's frame, or the deepest starter frame before one is chosen, when it cuts further in."
          >
            <Select
              value={compositionSettings.frameAware ? "on" : "off"}
              onChange={(e) => setComposition({ frameAware: e.target.value === "on" })}
              options={[
                { value: "on", label: "Yes" },
                { value: "off", label: "No" },
              ]}
            />
          </Field>
          <Field label="Frame margin cap (%)" hint="An ornate frame never pushes the margin past this.">
            <Input
              type="number"
              step="1"
              min="0"
              max="30"
              value={Math.round(compositionSettings.maxSafeInset * 100)}
              onChange={(e) => setComposition({ maxSafeInset: Number(e.target.value) / 100 })}
            />
          </Field>
          <Field
            label="Calm-area overshoot (%)"
            hint="How much larger than the text box the calm area is asked to be."
          >
            <Input
              type="number"
              step="1"
              min="0"
              max="20"
              value={Math.round(compositionSettings.calmOvershoot * 100)}
              onChange={(e) => setComposition({ calmOvershoot: Number(e.target.value) / 100 })}
            />
          </Field>
          <Field label="Overshoot on redraw (%)" hint="Used for the one redraw after a failed check.">
            <Input
              type="number"
              step="1"
              min="0"
              max="30"
              value={Math.round(compositionSettings.retryCalmOvershoot * 100)}
              onChange={(e) => setComposition({ retryCalmOvershoot: Number(e.target.value) / 100 })}
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