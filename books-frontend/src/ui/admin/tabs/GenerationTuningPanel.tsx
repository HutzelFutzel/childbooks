"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Gauge,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import {
  createDefaultGenerationTuningConfig,
  PROVIDER_DEFAULT,
  type ActionGenerationTuning,
  type GenerationTuningConfig,
} from "../../../core/config/generationTuning";
import { IMAGE_ACTIONS, type ImageActionId } from "../../../core/ai/actions";
import {
  CUSTOMER_IMAGE_TIER,
  resolveBoundImageModel,
} from "../../../core/config/modelConfig";
import { capabilitiesFor } from "../../../core/config/modelCapabilities";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { Button } from "../../components/Button";
import { Field, Input } from "../../components/Input";
import { useReadOnly } from "../../components/ReadOnlyContext";
import { Select } from "../../components/Select";
import { cn } from "../../lib/cn";

const ACTION_COPY: Record<ImageActionId, { short: string; description: string }> = {
  anchorImage: {
    short: "Anchors",
    description: "Character, place, and object reference sheets.",
  },
  pageIllustration: {
    short: "Pages",
    description: "Interior page and spread artwork.",
  },
  coverIllustration: {
    short: "Covers",
    description: "Front and back cover artwork.",
  },
};

function numberFrom(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function Toggle({
  checked,
  label,
  description,
  disabled,
  onChange,
}: {
  checked: boolean;
  label: string;
  description: string;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={cn(
        "flex min-h-14 items-start gap-3 rounded-xl px-3 py-2.5",
        "ring-1 ring-inset ring-ink-100 transition-colors",
        checked ? "bg-brand-50/50" : "bg-white",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-ink-50",
      )}
    >
      <input
        type="checkbox"
        className="mt-0.5 size-4 rounded border-ink-300 text-brand-600 focus:ring-brand-400"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink-800">{label}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-ink-500">
          {description}
        </span>
      </span>
    </label>
  );
}

export function GenerationTuningPanel() {
  const readOnly = useReadOnly();
  const {
    generationTuning,
    loadGenerationTuning,
    saveGenerationTuning,
    modelConfig,
  } = useAppConfigStore();
  const [draft, setDraft] = useState<GenerationTuningConfig>(generationTuning);
  const [action, setAction] = useState<ImageActionId>("pageIllustration");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void loadGenerationTuning()
      .then((config) => {
        if (active) setDraft(config);
      })
      .catch((error) => {
        const message =
          error instanceof Error ? error.message : "Could not load image settings.";
        setLoadError(message);
        toast.error(message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [loadGenerationTuning]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(generationTuning);
  const current = draft.actions[action];
  const selectedModel = resolveBoundImageModel(
    modelConfig,
    action,
    CUSTOMER_IMAGE_TIER,
  );
  const capabilities = useMemo(
    () => capabilitiesFor(selectedModel, modelConfig.capabilities),
    [selectedModel, modelConfig.capabilities],
  );
  const patchAction = (patch: Partial<ActionGenerationTuning>) => {
    setDraft((value) => ({
      ...value,
      actions: {
        ...value.actions,
        [action]: { ...value.actions[action], ...patch },
      },
    }));
  };

  const patchReferences = (
    patch: Partial<ActionGenerationTuning["references"]>,
  ) => {
    patchAction({ references: { ...current.references, ...patch } });
  };

  const patchQualityControl = (
    patch: Partial<ActionGenerationTuning["qualityControl"]>,
  ) => {
    patchAction({
      qualityControl: { ...current.qualityControl, ...patch },
    });
  };

  const resetAction = () => {
    const defaults = createDefaultGenerationTuningConfig();
    setDraft((value) => ({
      ...value,
      actions: { ...value.actions, [action]: defaults.actions[action] },
    }));
  };

  const save = async () => {
    setSaving(true);
    try {
      await saveGenerationTuning(draft);
      toast.success("Image generation settings saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save image settings.");
    } finally {
      setSaving(false);
    }
  };

  const qc = current.qualityControl;
  const modelName = selectedModel?.id ?? "No production model selected";
  const qualityOptions = [
    { value: PROVIDER_DEFAULT, label: "Provider default" },
    ...(!capabilities.outputs.qualityLevels.includes(
      current.quality as Exclude<typeof current.quality, typeof PROVIDER_DEFAULT>,
    ) && current.quality !== PROVIDER_DEFAULT
      ? [{ value: current.quality, label: `${current.quality} · unsupported`, disabled: true }]
      : []),
    ...capabilities.outputs.qualityLevels.map((quality) => ({
      value: quality,
      label: quality === "auto" ? "Auto" : quality[0].toUpperCase() + quality.slice(1),
    })),
  ];
  const repairQualityOptions = [
    ...(!capabilities.outputs.qualityLevels.includes(qc.repairQuality)
      ? [{ value: qc.repairQuality, label: `${qc.repairQuality} · ignored by model` }]
      : []),
    ...capabilities.outputs.qualityLevels.map((quality) => ({
      value: quality,
      label: quality[0].toUpperCase() + quality.slice(1),
    })),
  ];
  const fidelityOptions = [
    { value: PROVIDER_DEFAULT, label: "Provider default" },
    ...(!capabilities.inputs.inputFidelityLevels.includes(
      current.inputFidelity as "low" | "high",
    ) && current.inputFidelity !== PROVIDER_DEFAULT
      ? [{
          value: current.inputFidelity,
          label: `${current.inputFidelity} · unsupported`,
          disabled: true,
        }]
      : []),
    ...capabilities.inputs.inputFidelityLevels.map((level) => ({
      value: level,
      label: level === "low" ? "Low · faster" : "High · closer match",
    })),
  ];
  const formatOptions = [
    { value: PROVIDER_DEFAULT, label: "Provider default" },
    ...(!capabilities.outputs.formats.includes(
      current.outputFormat as Exclude<typeof current.outputFormat, typeof PROVIDER_DEFAULT>,
    ) && current.outputFormat !== PROVIDER_DEFAULT
      ? [{
          value: current.outputFormat,
          label: `${current.outputFormat.toUpperCase()} · unsupported`,
          disabled: true,
        }]
      : []),
    ...capabilities.outputs.formats.map((format) => ({
      value: format,
      label: format.toUpperCase(),
    })),
  ];

  return (
    <section className="overflow-hidden rounded-2xl bg-white ring-1 ring-inset ring-ink-100">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-100 px-4 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <SlidersHorizontal className="size-4.5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-ink-900">
              Image speed &amp; quality
            </h2>
            <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-ink-500">
              Set the generation payload and cap optional quality checks. Changes apply to newly
              started renders within about 30 seconds.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <span className="rounded-full bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700">
              Unsaved
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<RotateCcw className="size-3.5" />}
            onClick={resetAction}
            disabled={loading || saving || readOnly}
          >
            Reset {ACTION_COPY[action].short.toLowerCase()}
          </Button>
        </div>
      </div>

      <div className="border-b border-ink-100 bg-ink-50/50 px-4 pt-3">
        <div className="flex gap-1" role="tablist" aria-label="Artwork type">
          {IMAGE_ACTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`generation-tab-${item.id}`}
              aria-controls={`generation-panel-${item.id}`}
              aria-selected={action === item.id}
              tabIndex={action === item.id ? 0 : -1}
              className={cn(
                "-mb-px min-h-10 border-b-2 px-3 text-sm font-medium transition-colors",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400",
                action === item.id
                  ? "border-brand-500 text-brand-700"
                  : "border-transparent text-ink-500 hover:text-ink-800",
              )}
              onClick={() => setAction(item.id)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                event.preventDefault();
                const index = IMAGE_ACTIONS.findIndex((candidate) => candidate.id === item.id);
                const offset = event.key === "ArrowRight" ? 1 : -1;
                const next = IMAGE_ACTIONS[
                  (index + offset + IMAGE_ACTIONS.length) % IMAGE_ACTIONS.length
                ];
                setAction(next.id);
                requestAnimationFrame(() =>
                  document.getElementById(`generation-tab-${next.id}`)?.focus(),
                );
              }}
            >
              {ACTION_COPY[item.id].short}
            </button>
          ))}
        </div>
      </div>

      <div
        id={`generation-panel-${action}`}
        role="tabpanel"
        aria-labelledby={`generation-tab-${action}`}
        className="space-y-6 p-4"
      >
        {loadError && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-red-50 px-3 py-2.5 text-xs text-red-700 ring-1 ring-inset ring-red-200">
            <span className="flex items-center gap-2">
              <AlertTriangle className="size-4 shrink-0" />
              {loadError}
            </span>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<RefreshCw className="size-3.5" />}
              disabled={loading}
              onClick={() => {
                setLoading(true);
                setLoadError(null);
                void loadGenerationTuning()
                  .then(setDraft)
                  .catch((error) =>
                    setLoadError(
                      error instanceof Error
                        ? error.message
                        : "Could not load image settings.",
                    ),
                  )
                  .finally(() => setLoading(false));
              }}
            >
              Retry
            </Button>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-ink-800">
              {ACTION_COPY[action].description}
            </p>
            <p className="mt-0.5 font-mono text-[11px] text-ink-500">{modelName}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-50 px-2.5 py-1 text-[11px] font-medium text-ink-600">
              <Gauge className="size-3.5" />
              {capabilities.traits.latency ?? "unknown"} latency profile
            </span>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">
              Render
            </h3>
            <p className="mt-1 text-xs text-ink-500">
              Provider defaults are safest when models change. Unsupported choices are skipped.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Field label="Image quality" hint="Lower is faster; higher preserves fine detail.">
              <Select
                value={current.quality}
                options={qualityOptions}
                disabled={loading || saving}
                onChange={(event) =>
                  patchAction({
                    quality: event.target.value as ActionGenerationTuning["quality"],
                  })
                }
              />
            </Field>
            <Field label="Reference fidelity" hint="Controls how closely edits preserve references.">
              <Select
                value={current.inputFidelity}
                options={fidelityOptions}
                disabled={loading || saving}
                onChange={(event) =>
                  patchAction({
                    inputFidelity:
                      event.target.value as ActionGenerationTuning["inputFidelity"],
                  })
                }
              />
            </Field>
            <Field label="Output format" hint="PNG is lossless; WebP and JPEG can be smaller.">
              <Select
                value={current.outputFormat}
                options={formatOptions}
                disabled={loading || saving}
                onChange={(event) => {
                  const outputFormat =
                    event.target.value as ActionGenerationTuning["outputFormat"];
                  patchAction({
                    outputFormat,
                    ...(outputFormat === "jpeg" || outputFormat === "webp"
                      ? {}
                      : { outputCompression: null }),
                  });
                }}
              />
            </Field>
            <Field label="Retry after failure" hint="Retries improve reliability but can double latency.">
              <Select
                value={String(current.retries)}
                options={[
                  { value: "0", label: "No retry" },
                  { value: "1", label: "Retry once" },
                  { value: "2", label: "Retry twice" },
                ]}
                disabled={loading || saving}
                onChange={(event) =>
                  patchAction({ retries: numberFrom(event.target.value, current.retries) })
                }
              />
            </Field>
          </div>
          <Field
            label="Lossy compression quality"
            hint="Only applies to models and formats that support compression. Leave blank for the provider default."
            className="max-w-xs"
          >
            <Input
              type="number"
              min={0}
              max={100}
              placeholder="Provider default"
              value={current.outputCompression ?? ""}
              disabled={
                loading ||
                saving ||
                !capabilities.outputs.compression ||
                (current.outputFormat !== "jpeg" && current.outputFormat !== "webp")
              }
              onChange={(event) =>
                patchAction({
                  outputCompression:
                    event.target.value === ""
                      ? null
                      : numberFrom(event.target.value, current.outputCompression ?? 80),
                })
              }
            />
          </Field>
        </div>

        <div className="border-t border-ink-100 pt-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">
            References
          </h3>
          <div className="mt-3 grid gap-4 md:grid-cols-3">
            <Field label="Maximum images" hint="Optional images only; required edit and restyle bases are retained.">
              <Input
                type="number"
                min={0}
                max={64}
                value={current.references.maxImages}
                disabled={loading || saving}
                onChange={(event) =>
                  patchReferences({
                    maxImages: numberFrom(event.target.value, current.references.maxImages),
                  })
                }
              />
            </Field>
            <Field label="Longest edge (px)" hint="Mask-aligned composition images stay at their original size.">
              <Input
                type="number"
                min={256}
                max={4096}
                step={128}
                value={current.references.maxDimension}
                disabled={loading || saving}
                onChange={(event) =>
                  patchReferences({
                    maxDimension: numberFrom(
                      event.target.value,
                      current.references.maxDimension,
                    ),
                  })
                }
              />
            </Field>
            <Field label="Encoding quality" hint="Affects reference upload size, not final output quality.">
              <Input
                type="number"
                min={40}
                max={100}
                value={current.references.encodingQuality}
                disabled={loading || saving}
                onChange={(event) =>
                  patchReferences({
                    encodingQuality: numberFrom(
                      event.target.value,
                      current.references.encodingQuality,
                    ),
                  })
                }
              />
            </Field>
          </div>
        </div>

        <div className="border-t border-ink-100 pt-5">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                Quality checks
              </h3>
              <p className="mt-1 text-xs text-ink-500">
                Optional checks stop when either cap is reached; the primary image is kept.
              </p>
            </div>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
              <ShieldCheck className="size-3.5" />
              Bounded post-processing
            </span>
          </div>

          {action === "coverIllustration" && (
            <p className="mt-3 rounded-xl bg-sky-50 px-3 py-2.5 text-xs leading-relaxed text-sky-800">
              These checks apply to ordinary cover renders. A back cover generated as a
              pixel-continuous continuation keeps its required mask-aligned front-cover edge and
              skips subject binding and duplicate cleanup.
            </p>
          )}

          <div className="mt-3 grid gap-4 md:grid-cols-3">
            <Field label="Time budget (seconds)" hint="Maximum time spent after the main render.">
              <Input
                type="number"
                min={0}
                max={180}
                step={5}
                value={qc.budgetMs / 1000}
                disabled={loading || saving}
                onChange={(event) =>
                  patchQualityControl({
                    budgetMs:
                      numberFrom(event.target.value, qc.budgetMs / 1000) * 1000,
                  })
                }
              />
            </Field>
            <Field label="Maximum repair attempts" hint="Hard cap including failed requests and retries.">
              <Input
                type="number"
                min={0}
                max={12}
                value={qc.maxImageCalls}
                disabled={loading || saving}
                onChange={(event) =>
                  patchQualityControl({
                    maxImageCalls: numberFrom(event.target.value, qc.maxImageCalls),
                  })
                }
              />
            </Field>
            <Field label="Repair quality" hint="Small masked regions usually need less detail.">
              <Select
                value={qc.repairQuality}
                options={repairQualityOptions}
                disabled={loading || saving}
                onChange={(event) =>
                  patchQualityControl({
                    repairQuality:
                      event.target.value as ActionGenerationTuning["qualityControl"]["repairQuality"],
                  })
                }
              />
            </Field>
          </div>

          <div className="mt-4 grid gap-2 md:grid-cols-2">
            {!["anchorImage"].includes(action) && (
              <>
                <Toggle
                  checked={qc.bindingPass}
                  label="Locate subjects after rendering"
                  description="Records where each character appears and enables duplicate cleanup."
                  disabled={loading || saving || readOnly}
                  onChange={(bindingPass) =>
                    patchQualityControl({
                      bindingPass,
                      ...(bindingPass
                        ? {}
                        : {
                            duplicateRepairLimit: 0,
                            embeddedRepairLimit: 0,
                          }),
                    })
                  }
                />
                <Toggle
                  checked={qc.duplicateRepairLimit > 0}
                  label="Remove duplicate subjects"
                  description="Repairs accidental extra copies, up to the configured limit."
                  disabled={loading || saving || readOnly || !qc.bindingPass}
                  onChange={(enabled) =>
                    patchQualityControl({ duplicateRepairLimit: enabled ? 2 : 0 })
                  }
                />
              </>
            )}
            {action === "anchorImage" && (
              <>
                <Toggle
                  checked={qc.gridCheck}
                  label="Verify anchor sheet grid"
                  description="Checks the panel count and regenerates once when it is wrong."
                  disabled={loading || saving || readOnly}
                  onChange={(gridCheck) => patchQualityControl({ gridCheck })}
                />
                <Toggle
                  checked={qc.flattenBackground}
                  label="Clean reference-sheet background"
                  description="Locally flattens near-white backgrounds after generation."
                  disabled={loading || saving || readOnly}
                  onChange={(flattenBackground) =>
                    patchQualityControl({ flattenBackground })
                  }
                />
              </>
            )}
            <Toggle
              checked={qc.embeddedRepairLimit > 0}
              label="Clean embedded-object conflicts"
              description="Removes generic objects that conflict with a specific anchored design."
              disabled={
                loading ||
                saving ||
                readOnly ||
                (action !== "anchorImage" && !qc.bindingPass)
              }
              onChange={(enabled) =>
                patchQualityControl({ embeddedRepairLimit: enabled ? 1 : 0 })
              }
            />
          </div>

          <details className="mt-4 rounded-xl bg-ink-50/60 ring-1 ring-inset ring-ink-100">
            <summary className="cursor-pointer px-3 py-2.5 text-xs font-semibold text-ink-700">
              Repair limits
            </summary>
            <div className="grid gap-4 border-t border-ink-100 px-3 py-3 sm:grid-cols-2">
              <Field label="Duplicate repair limit">
                <Input
                  type="number"
                  min={0}
                  max={8}
                  value={qc.duplicateRepairLimit}
                  disabled={loading || saving || action === "anchorImage"}
                  onChange={(event) =>
                    patchQualityControl({
                      duplicateRepairLimit: numberFrom(
                        event.target.value,
                        qc.duplicateRepairLimit,
                      ),
                    })
                  }
                />
              </Field>
              <Field label="Embedded repair limit">
                <Input
                  type="number"
                  min={0}
                  max={8}
                  value={qc.embeddedRepairLimit}
                  disabled={
                    loading ||
                    saving ||
                    (action !== "anchorImage" && !qc.bindingPass)
                  }
                  onChange={(event) =>
                    patchQualityControl({
                      embeddedRepairLimit: numberFrom(
                        event.target.value,
                        qc.embeddedRepairLimit,
                      ),
                    })
                  }
                />
              </Field>
            </div>
          </details>
        </div>

        <details className="rounded-xl bg-white ring-1 ring-inset ring-ink-100">
          <summary className="cursor-pointer px-3 py-2.5 text-xs font-semibold text-ink-700">
            Advanced execution
          </summary>
          <div className="border-t border-ink-100 px-3 py-3">
            <Field
              label="Parallel subject edits"
              hint="Applies globally. Raise only when provider image-rate limits have headroom."
              className="max-w-xs"
            >
              <Select
                value={String(draft.execution.surgicalConcurrency)}
                options={[1, 2, 3, 4, 5, 6].map((value) => ({
                  value: String(value),
                  label: `${value} at a time`,
                }))}
                disabled={loading || saving}
                onChange={(event) =>
                  setDraft((value) => ({
                    ...value,
                    execution: {
                      ...value.execution,
                      surgicalConcurrency: numberFrom(
                        event.target.value,
                        value.execution.surgicalConcurrency,
                      ),
                    },
                  }))
                }
              />
            </Field>
          </div>
        </details>

        <details className="rounded-xl bg-ink-50/60 ring-1 ring-inset ring-ink-100">
          <summary className="cursor-pointer px-3 py-2.5 text-xs font-semibold text-ink-700">
            Runtime limits
          </summary>
          <div className="grid gap-3 border-t border-ink-100 px-3 py-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
            <div><span className="block text-ink-500">Task timeout</span><strong className="text-ink-800">4 minutes</strong></div>
            <div><span className="block text-ink-500">Request budget</span><strong className="text-ink-800">280 seconds</strong></div>
            <div><span className="block text-ink-500">Worker concurrency</span><strong className="text-ink-800">Default 2 per instance</strong></div>
            <div><span className="block text-ink-500">Queue concurrency</span><strong className="text-ink-800">Default 10 tasks</strong></div>
            <p className="sm:col-span-2 lg:col-span-4 text-ink-500">
              Deployment-controlled safety limits are shown for context and cannot be changed live.
            </p>
          </div>
        </details>
      </div>

      {!readOnly && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 bg-ink-50/50 px-4 py-3">
          <p className="text-xs text-ink-500">
            Settings are validated server-side before publishing.
          </p>
          <div className="flex gap-2">
            {dirty && (
              <Button
                variant="ghost"
                size="sm"
                disabled={saving}
                onClick={() => setDraft(generationTuning)}
              >
                Discard
              </Button>
            )}
            <Button
              size="sm"
              loading={saving}
              disabled={!dirty || loading || Boolean(loadError)}
              onClick={() => void save()}
            >
              Save image settings
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
