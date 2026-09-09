"use client";

import { useMemo } from "react";
import { ChevronDown, RotateCcw, TriangleAlert } from "lucide-react";
import { BOOK_PRODUCTS } from "../../../core/fulfillment";
import type { BookProduct } from "../../../core/fulfillment/types";
import { surfaceAspect } from "../../../core/book/grid";
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
import {
  configuredModels,
  type ModelConfig,
} from "../../../core/config/modelConfig";
import { Button } from "../../components/Button";
import { Field, Input } from "../../components/Input";
import { useReadOnly } from "../../components/ReadOnlyContext";
import { Select } from "../../components/Select";
import { cn } from "../../lib/cn";
import { Section } from "./products/parts";

const NO_OVERRIDES: CapabilityOverrides = {};
const BOOLEAN_OPTIONS = [
  { value: "", label: "Use detected value" },
  { value: "yes", label: "Supported" },
  { value: "no", label: "Not supported" },
];
const PIXEL_BUDGETS = [
  { value: "", label: "Use detected value" },
  { value: String(1_024 * 1_024), label: "1 MP" },
  { value: String(1_600 * 1_200), label: "2 MP" },
  { value: String(2_048 * 1_536), label: "3 MP" },
  { value: String(2_560 * 1_440), label: "3.7 MP" },
  { value: String(2_560 * 2_048), label: "5 MP" },
  { value: String(3_264 * 2_448), label: "8 MP" },
];

function previewSurfaces(): SizingSurface[] {
  const byTrim = new Map<string, BookProduct>();
  for (const product of BOOK_PRODUCTS) {
    const key = `${product.trim.widthIn} × ${product.trim.heightIn}″`;
    if (!byTrim.has(key)) byTrim.set(key, product);
  }
  return [...byTrim].flatMap(([label, product]) => [
    {
      label: `${label} page`,
      aspect: surfaceAspect(product.aspect, "page"),
      widthIn: product.trim.widthIn,
    },
    {
      label: `${label} spread`,
      aspect: surfaceAspect(product.aspect, "spread"),
      widthIn: product.trim.widthIn * 2,
    },
  ]);
}

function compact<T extends object>(value: T): T | undefined {
  const next = { ...value } as Record<string, unknown>;
  for (const key of Object.keys(next)) {
    if (next[key] === undefined) delete next[key];
  }
  return Object.keys(next).length > 0 ? (next as T) : undefined;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">
        {label}
      </div>
      <div className="mt-0.5 text-xs leading-relaxed text-ink-700">{value}</div>
    </div>
  );
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
  const key = capabilityKey(provider, modelId);
  const override = overrides[key] ?? {};
  const overridden = Object.keys(override).length > 0;
  const caps = useMemo(
    () => capabilitiesFor({ provider, id: modelId }, overrides),
    [provider, modelId, overrides],
  );
  const rows = useMemo(
    () => sizingReport(caps, previewSurfaces()),
    [caps],
  );
  const cropped = rows.filter((row) => !row.producible);

  const patch = (changes: Partial<CapabilityOverride>) => {
    const next: CapabilityOverride = { ...override, ...changes };
    for (const field of Object.keys(next) as (keyof CapabilityOverride)[]) {
      if (next[field] === undefined) delete next[field];
    }
    onChange(Object.keys(next).length > 0 ? next : null);
  };
  const patchOperations = (
    changes: Partial<NonNullable<CapabilityOverride["operations"]>>,
  ) =>
    patch({
      operations: compact({ ...override.operations, ...changes }),
    });
  const patchInputs = (
    changes: Partial<NonNullable<CapabilityOverride["inputs"]>>,
  ) =>
    patch({
      inputs: compact({ ...override.inputs, ...changes }),
    });
  const patchOutputs = (
    changes: Partial<NonNullable<CapabilityOverride["outputs"]>>,
  ) =>
    patch({
      outputs: compact({ ...override.outputs, ...changes }),
    });
  const setBoolean = (
    value: string,
    apply: (next: boolean | undefined) => void,
  ) => apply(value === "" ? undefined : value === "yes");

  const transparentOverride = override.outputs?.backgrounds
    ? override.outputs.backgrounds.includes("transparent")
      ? "yes"
      : "no"
    : "";
  const quality = caps.outputs.qualityLevels.length
    ? caps.outputs.qualityLevels.join(", ")
    : "Provider-managed";
  const resolutions = caps.outputs.resolutions.length
    ? caps.outputs.resolutions.join(", ")
    : "Derived from canvas";

  return (
    <details className="group rounded-xl bg-white ring-1 ring-inset ring-ink-100">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate font-mono text-xs font-semibold text-ink-800">
              {modelId}
            </span>
            <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700">
              {caps.profile}
            </span>
            {overridden && (
              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                Custom
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-500">
            <span>
              {caps.outputs.backgrounds.includes("transparent")
                ? "Transparent output"
                : "Opaque output"}
            </span>
            <span>
              {caps.operations.maskEditing ? "Masked edits" : "Reference edits"}
            </span>
            <span>{caps.inputs.maxReferenceImages} references</span>
            <span>{caps.outputs.formats.map((value) => value.toUpperCase()).join(", ")}</span>
          </div>
        </div>
        <ChevronDown className="size-4 shrink-0 text-ink-400 transition-transform group-open:rotate-180" />
      </summary>

      <div className="space-y-4 border-t border-ink-100 px-4 py-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Fact
            label="Operations"
            value={[
              caps.operations.referenceEditing ? "Reference editing" : "",
              caps.operations.maskEditing ? "Masks" : "",
              caps.operations.outpainting ? "Outpainting" : "",
            ]
              .filter(Boolean)
              .join(", ") || "Generation only"}
          />
          <Fact
            label="Formats"
            value={caps.outputs.formats.map((value) => value.toUpperCase()).join(", ")}
          />
          <Fact label="Quality" value={quality} />
          <Fact label="Resolution" value={resolutions} />
          <Fact
            label="Input handling"
            value={`${caps.inputs.referenceBinding} binding · ${caps.inputs.formats
              .map((value) => value.toUpperCase())
              .join(", ")}`}
          />
          <Fact label="Text rendering" value={caps.traits.textRendering} />
          <Fact label="Reference consistency" value={caps.traits.referenceConsistency} />
          <Fact label="Typical latency" value={caps.traits.latency} />
        </div>

        {cropped.length > 0 && (
          <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {cropped.length} sold {cropped.length === 1 ? "surface is" : "surfaces are"} outside
              this model&apos;s reliable shape range. Incompatible layouts are withheld.
            </span>
          </div>
        )}

        <details className="rounded-lg bg-ink-50/60 ring-1 ring-inset ring-ink-100">
          <summary className="cursor-pointer px-3 py-2 text-[11px] font-semibold text-ink-600">
            Output geometry
          </summary>
          <div className="overflow-x-auto border-t border-ink-100">
            <table className="w-full min-w-136 text-[11px]">
              <thead className="text-ink-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Surface</th>
                  <th className="px-3 py-2 text-right font-medium">Wanted</th>
                  <th className="px-3 py-2 text-right font-medium">Asked for</th>
                  <th className="px-3 py-2 text-right font-medium">Crop</th>
                  <th className="px-3 py-2 text-right font-medium">Print</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {rows.map((row) => (
                  <tr key={row.label} className={cn(!row.producible && "bg-amber-50/60")}>
                    <td className="px-3 py-2 text-ink-600">{row.label}</td>
                    <td className="px-3 py-2 text-right font-mono text-ink-400">
                      {row.target.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-ink-600">
                      {row.token ?? row.size}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2 text-right font-mono",
                        row.error > MAX_ASPECT_MISMATCH
                          ? "text-rose-600"
                          : row.error > 0.02
                            ? "text-amber-600"
                            : "text-emerald-600",
                      )}
                    >
                      {row.error < 0.0005 ? "none" : `${(row.error * 100).toFixed(1)}%`}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-ink-400">
                      {row.dpi ? `${row.dpi} dpi` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>

        {!readOnly && (
          <details className="rounded-lg bg-ink-50/60 ring-1 ring-inset ring-ink-100">
            <summary className="cursor-pointer px-3 py-2 text-[11px] font-semibold text-ink-600">
              Override detected values
            </summary>
            <div className="space-y-4 border-t border-ink-100 p-3">
              <p className="text-[11px] leading-relaxed text-ink-500">
                Use only when the provider&apos;s documented behavior differs from the detected
                profile. Model routing does not need changes here.
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Transparent output">
                  <Select
                    value={transparentOverride}
                    onChange={(event) =>
                      setBoolean(event.target.value, (supported) => {
                        if (supported === undefined) {
                          patchOutputs({ backgrounds: undefined });
                          return;
                        }
                        const backgrounds: Array<"opaque" | "transparent" | "auto"> =
                          caps.outputs.backgrounds.filter(
                            (value) => value !== "transparent",
                          );
                        if (supported) backgrounds.push("transparent");
                        patchOutputs({ backgrounds });
                      })
                    }
                    options={BOOLEAN_OPTIONS}
                  />
                </Field>
                <Field label="Masked editing">
                  <Select
                    value={
                      override.operations?.maskEditing === undefined
                        ? ""
                        : override.operations.maskEditing
                          ? "yes"
                          : "no"
                    }
                    onChange={(event) =>
                      setBoolean(event.target.value, (maskEditing) =>
                        patchOperations({ maskEditing }),
                      )
                    }
                    options={BOOLEAN_OPTIONS}
                  />
                </Field>
                <Field label="Reference limit">
                  <Input
                    type="number"
                    min="0"
                    max="64"
                    value={override.inputs?.maxReferenceImages ?? ""}
                    placeholder={String(caps.inputs.maxReferenceImages)}
                    onChange={(event) =>
                      patchInputs({
                        maxReferenceImages: event.target.value
                          ? Number(event.target.value)
                          : undefined,
                      })
                    }
                  />
                </Field>
                <Field
                  label="Resolution ceiling"
                  hint={
                    caps.sizing.mode === "arbitrary"
                      ? "Cost scales with area."
                      : "This model controls its output pixels."
                  }
                >
                  <Select
                    value={override.maxPixels ? String(override.maxPixels) : ""}
                    disabled={caps.sizing.mode !== "arbitrary"}
                    onChange={(event) =>
                      patch({
                        maxPixels: event.target.value
                          ? Number(event.target.value)
                          : undefined,
                      })
                    }
                    options={PIXEL_BUDGETS}
                  />
                </Field>
              </div>

              <details>
                <summary className="cursor-pointer text-[11px] font-medium text-ink-500">
                  Restrict output shapes
                </summary>
                <div className="mt-2 flex flex-wrap gap-1">
                  {RATIO_VOCABULARY.map((option) => {
                    const selected = (override.ratios ?? []).includes(option.token);
                    return (
                      <button
                        key={option.token}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => {
                          const next = new Set(override.ratios ?? []);
                          if (next.has(option.token)) next.delete(option.token);
                          else next.add(option.token);
                          const ratios = RATIO_VOCABULARY.filter((ratio) =>
                            next.has(ratio.token),
                          ).map((ratio) => ratio.token);
                          patch({ ratios: ratios.length ? ratios : undefined });
                        }}
                        className={cn(
                          "rounded px-1.5 py-1 font-mono text-[10px] ring-1 ring-inset focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
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
              </details>

              {overridden && (
                <Button
                  size="sm"
                  variant="ghost"
                  leftIcon={<RotateCcw className="size-3.5" />}
                  onClick={() => onChange(null)}
                >
                  Reset all overrides
                </Button>
              )}
            </div>
          </details>
        )}
      </div>
    </details>
  );
}

export function ImageCapabilitiesPanel({
  config,
  onChange,
}: {
  config: ModelConfig;
  onChange: (capabilities: CapabilityOverrides | undefined) => void;
}) {
  const models = useMemo(
    () => configuredModels(config).filter((model) => model.modality === "image"),
    [config],
  );
  const overrides = config.capabilities ?? NO_OVERRIDES;

  const setModel = (key: string, override: CapabilityOverride | null) => {
    const next = { ...overrides };
    if (override) next[key] = override;
    else delete next[key];
    onChange(Object.keys(next).length ? next : undefined);
  };

  return (
    <Section
      title="Image capabilities"
      hint="Loaded automatically from each validated model profile. Expand a model only when you need details."
    >
      {models.length === 0 ? (
        <p className="text-xs text-ink-400">Add an image model above to see its capabilities.</p>
      ) : (
        <div className="space-y-2">
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
