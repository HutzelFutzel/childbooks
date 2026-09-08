"use client";

/**
 * What each image model can be asked for — and the two corrections worth making.
 *
 * This panel exists because the geometry policy was invisible. Which canvas a
 * page is generated at is decided by the model's capability entry, and until it
 * was shown here nobody could see that a landscape spread was being asked for
 * at 1536×1024 and then cropped by 42% to fit the page. So the read-only table
 * is the point of the screen, not the form: it renders the canvas the pipeline
 * would actually request for every trim we sell, both surfaces, live against
 * the unsaved draft.
 *
 * The editable part is deliberately narrow. `maxPixels` is a pure cost lever —
 * image tokens scale with area, and it never changes a shape — so it sits in
 * the open. Restricting ratios switches a model out of arbitrary sizing into
 * buckets, which trades away the exact fit the table is showing and also
 * narrows which layouts are offered, so it's behind a disclosure that says so.
 */
import { useMemo, useState } from "react";
import { ChevronDown, RotateCcw, TriangleAlert } from "lucide-react";
import { BOOK_PRODUCTS } from "../../../core/fulfillment";
import type { BookProduct } from "../../../core/fulfillment/types";
import { surfaceAspect } from "../../../core/book/grid";
import type { LayoutsConfig } from "../../../core/config/layouts";
import {
  capabilitiesFor,
  capabilityKey,
  sizingModeLabel,
  sizingReport,
  sizingSummary,
  MAX_ASPECT_MISMATCH,
  RATIO_VOCABULARY,
  type CapabilityOverride,
  type CapabilityOverrides,
  type SizingSurface,
} from "../../../core/config/modelCapabilities";
import { configuredModels } from "../../../core/config/modelConfig";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { Button } from "../../components/Button";
import { Field } from "../../components/Input";
import { useReadOnly } from "../../components/ReadOnlyContext";
import { Select } from "../../components/Select";
import { cn } from "../../lib/cn";
import { Section } from "./products/parts";

/**
 * Resolution ceilings offered as megapixels rather than a raw pixel count.
 *
 * A number field here would be asking an admin to type 2073600 and hope; the
 * table below shows what each choice actually produces, which is the number
 * they care about.
 */
const PIXEL_BUDGETS: { value: string; label: string }[] = [
  { value: "", label: "Shipped default" },
  { value: String(1_024 * 1_024), label: "1 MP — cheapest, screen only" },
  { value: String(1_600 * 1_200), label: "2 MP" },
  { value: String(2_048 * 1_536), label: "3 MP" },
  { value: String(2_560 * 1_440), label: "3.7 MP — reliability boundary" },
  { value: String(2_560 * 2_048), label: "5 MP" },
  { value: String(3_264 * 2_448), label: "8 MP — experimental" },
];

/**
 * Stable empty overlay. A fresh `{}` per render would be a new dependency for
 * the resolved-capability memos below, so the whole table would recompute on
 * every keystroke elsewhere in the tab.
 */
const NO_OVERRIDES: CapabilityOverrides = {};

/** Every trim we sell, as a page and as a spread. */
function previewSurfaces(): SizingSurface[] {
  const byTrim = new Map<string, BookProduct>();
  for (const product of BOOK_PRODUCTS) {
    const key = `${product.trim.widthIn} × ${product.trim.heightIn}″`;
    if (!byTrim.has(key)) byTrim.set(key, product);
  }
  const out: SizingSurface[] = [];
  for (const [key, product] of byTrim) {
    out.push({
      label: `${key} page`,
      aspect: surfaceAspect(product.aspect, "page"),
      widthIn: product.trim.widthIn,
    });
    out.push({
      label: `${key} spread`,
      aspect: surfaceAspect(product.aspect, "spread"),
      widthIn: product.trim.widthIn * 2,
    });
  }
  return out;
}

function ModelCard({
  provider,
  modelId,
  overrides,
  onChange,
}: {
  provider: "openai" | "google";
  modelId: string;
  overrides: CapabilityOverrides;
  onChange: (override: CapabilityOverride | null) => void;
}) {
  const readOnly = useReadOnly();
  const [advanced, setAdvanced] = useState(false);

  const key = capabilityKey(provider, modelId);
  const override = overrides[key] ?? {};
  const overridden = Object.keys(override).length > 0;

  // Resolved against the DRAFT, so the table moves as the form is edited.
  const caps = useMemo(
    () => capabilitiesFor({ provider, id: modelId }, overrides),
    [provider, modelId, overrides],
  );
  const shipped = useMemo(() => capabilitiesFor({ provider, id: modelId }), [provider, modelId]);
  const surfaces = useMemo(previewSurfaces, []);
  const rows = useMemo(() => sizingReport(caps, surfaces), [caps, surfaces]);

  const patch = (changes: Partial<CapabilityOverride>) => {
    const next: CapabilityOverride = { ...override, ...changes };
    for (const field of Object.keys(next) as (keyof CapabilityOverride)[]) {
      if (next[field] === undefined) delete next[field];
    }
    onChange(Object.keys(next).length > 0 ? next : null);
  };

  const toggleRatio = (token: string) => {
    const selected = new Set(override.ratios ?? []);
    if (selected.has(token)) selected.delete(token);
    else selected.add(token);
    // Kept in vocabulary order so the stored list is stable regardless of the
    // order the chips were clicked in.
    const ratios = RATIO_VOCABULARY.filter((r) => selected.has(r.token)).map((r) => r.token);
    patch({ ratios: ratios.length > 0 ? ratios : undefined });
  };

  const cropped = rows.filter((r) => !r.producible);
  const supportsBudget = caps.sizing.mode === "arbitrary";

  return (
    <div className="space-y-2.5 rounded-lg bg-white p-3 ring-1 ring-inset ring-ink-100">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-0.5">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-xs font-medium text-ink-700">{modelId}</span>
            <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[10px] font-medium text-ink-500">
              {sizingModeLabel(caps)}
            </span>
            {overridden && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                Overridden
              </span>
            )}
          </div>
          <p className="text-[11px] leading-relaxed text-ink-400">{sizingSummary(caps)}</p>
          {overridden && (
            <p className="text-[11px] leading-relaxed text-ink-400">
              Shipped: <span className="text-ink-500">{sizingSummary(shipped)}</span>
            </p>
          )}
        </div>
        {overridden && !readOnly && (
          <Button
            size="sm"
            variant="ghost"
            leftIcon={<RotateCcw className="size-3.5" />}
            onClick={() => onChange(null)}
          >
            Reset
          </Button>
        )}
      </div>

      {cropped.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] leading-relaxed text-amber-800">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {cropped.length === 1 ? "One surface" : `${cropped.length} surfaces`} can&apos;t be
            generated at their true shape by this model, so the artwork is cropped to fit the page.
            Layouts that need those shapes are withheld rather than shipped mis-framed.
          </span>
        </div>
      )}

      <div className="overflow-hidden rounded-lg ring-1 ring-inset ring-ink-100">
        <table className="w-full text-[11px]">
          <thead className="bg-ink-50 text-ink-500">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium">Surface</th>
              <th className="px-2 py-1.5 text-right font-medium">Wanted</th>
              <th className="px-2 py-1.5 text-right font-medium">Asked for</th>
              <th className="px-2 py-1.5 text-right font-medium">Cropped</th>
              <th className="px-2 py-1.5 text-right font-medium">Print</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {rows.map((row) => (
              <tr key={row.label} className={cn(!row.producible && "bg-amber-50/60")}>
                <td className="px-2 py-1.5 text-ink-600">{row.label}</td>
                <td className="px-2 py-1.5 text-right font-mono text-ink-400">
                  {row.target.toFixed(2)}
                </td>
                {/* A bucketed model is asked for a shape; its `size` is only a
                    carrier for that token, so showing the pixels would imply a
                    resolution we don't control. */}
                <td className="px-2 py-1.5 text-right font-mono text-ink-600">
                  {row.token ?? row.size}
                </td>
                <td
                  className={cn(
                    "px-2 py-1.5 text-right font-mono",
                    row.error > MAX_ASPECT_MISMATCH
                      ? "text-rose-600"
                      : row.error > 0.02
                        ? "text-amber-600"
                        : "text-emerald-600",
                  )}
                >
                  {row.error < 0.0005 ? "none" : `${(row.error * 100).toFixed(1)}%`}
                </td>
                <td className="px-2 py-1.5 text-right font-mono text-ink-400">
                  {row.dpi ? `${row.dpi} dpi` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Field
          label="Resolution ceiling"
          hint={
            supportsBudget
              ? "Cost scales with area. Never changes a shape."
              : "This model picks its own pixels, so there's nothing to cap."
          }
          className="min-w-56"
        >
          <Select
            value={override.maxPixels ? String(override.maxPixels) : ""}
            disabled={!supportsBudget}
            onChange={(e) =>
              patch({ maxPixels: e.target.value ? Number(e.target.value) : undefined })
            }
            options={PIXEL_BUDGETS}
          />
        </Field>
      </div>

      <button
        type="button"
        onClick={() => setAdvanced((v) => !v)}
        className="flex items-center gap-1 text-[11px] font-medium text-ink-500 hover:text-ink-700"
      >
        <ChevronDown className={cn("size-3.5 transition-transform", advanced && "rotate-180")} />
        Restrict shapes
      </button>

      {advanced && (
        <div className="space-y-2 rounded-lg bg-ink-50/60 p-2.5">
          <p className="text-[11px] leading-relaxed text-ink-500">
            Only for a model that demonstrably misbehaves at a shape it claims to support. Picking
            any ratio forces this model to use <em>only</em> those, which gives up the exact fit
            above and withholds the layouts that needed the shapes you drop. Leave everything
            unselected to use the shipped behaviour.
          </p>
          <div className="flex flex-wrap gap-1">
            {RATIO_VOCABULARY.map((option) => {
              const selected = (override.ratios ?? []).includes(option.token);
              return (
                <button
                  key={option.token}
                  type="button"
                  disabled={readOnly}
                  onClick={() => toggleRatio(option.token)}
                  className={cn(
                    "rounded px-1.5 py-1 font-mono text-[10px] ring-1 ring-inset transition-colors disabled:opacity-50",
                    selected
                      ? "bg-brand-500 text-white ring-brand-500"
                      : "bg-white text-ink-500 ring-ink-200 hover:bg-ink-50",
                  )}
                >
                  {option.token}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The panel. Lists every image model an admin has put in a slot, because that
 * is exactly the set that can reach a customer's page.
 */
export function ImageGeometryPanel({
  config,
  onChange,
}: {
  config: LayoutsConfig;
  onChange: (capabilities: CapabilityOverrides | undefined) => void;
}) {
  const modelConfig = useAppConfigStore((s) => s.modelConfig);
  const models = useMemo(
    () => configuredModels(modelConfig).filter((m) => m.modality === "image"),
    [modelConfig],
  );
  const overrides = config.capabilities ?? NO_OVERRIDES;

  const setModel = (key: string, override: CapabilityOverride | null) => {
    const next = { ...overrides };
    if (override) next[key] = override;
    else delete next[key];
    onChange(Object.keys(next).length > 0 ? next : undefined);
  };

  return (
    <Section
      title="Image model output geometry"
      hint="The canvas each model is asked for, per book size. Read this before changing it — the shapes below are what the page is composed from."
    >
      {models.length === 0 ? (
        <p className="text-[11px] text-ink-400">
          No image models are bound yet. Set one in Model config first.
        </p>
      ) : (
        <div className="space-y-2.5">
          {models.map((model) => (
            <ModelCard
              key={capabilityKey(model.provider, model.modelId)}
              provider={model.provider}
              modelId={model.modelId}
              overrides={overrides}
              onChange={(override) =>
                setModel(capabilityKey(model.provider, model.modelId), override)
              }
            />
          ))}
        </div>
      )}
    </Section>
  );
}
