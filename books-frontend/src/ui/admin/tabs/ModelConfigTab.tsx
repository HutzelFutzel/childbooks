"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  FileText,
  Image as ImageIcon,
  Plus,
  RefreshCw,
} from "lucide-react";
import { ALL_PROVIDERS } from "../../../core/providers";
import type { ProviderId } from "../../../core/config/options";
import {
  activeModels,
  CUSTOMER_IMAGE_TIER,
  IMAGE_SPEED_LABELS,
  IMAGE_SPEEDS,
  TEXT_SPEED_LABELS,
  TEXT_SPEEDS,
  textFallbackFor,
  textParamsFor,
  type ImageSpeed,
  type ImageTier,
  type ModelConfig,
  type ModelSlots,
  type TextSpeed,
} from "../../../core/config/modelConfig";
import {
  costKey,
  hasUsableModelCost,
  type ModelCost,
  type ModelCostTable,
} from "../../../core/config/modelCosts";
import type {
  CostSuggestionResult,
  ModelResolutionResult,
} from "../../../core/config/costSuggestion";
import {
  IMAGE_ACTIONS,
  TEXT_ACTIONS,
  type ImageActionId,
  type TextActionId,
} from "../../../core/ai/actions";
import { classifyModel, FALLBACK_MODELS } from "../../../core/models/catalog";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { useSettingsStore } from "../../../state/settingsStore";
import { Button } from "../../components/Button";
import { Field, Input } from "../../components/Input";
import { Select } from "../../components/Select";
import {
  costEquals,
  ModelCostEditor,
  summarizeCost,
} from "./ModelCostsTab";
import { ImageCapabilitiesPanel } from "./ImageGeometryPanel";
import { GenerationTuningPanel } from "./GenerationTuningPanel";
import type { CapabilityOverrides } from "../../../core/config/modelCapabilities";
import { AdminSaveBar } from "../AdminPageHeader";
import { Disclosure, EditorTabs } from "./products/parts";
import { TextActionParams } from "./models/TextActionParams";

const PROVIDER_LABELS: Record<ProviderId, string> = {
  openai: "OpenAI",
  google: "Google",
};

type Modality = "text" | "image";
type Panel = "slots" | "assignments" | "quality";
type SlotTarget =
  | { provider: ProviderId; modality: "text"; speed: TextSpeed }
  | { provider: ProviderId; modality: "image"; speed: ImageSpeed };

interface PendingRate {
  result: CostSuggestionResult;
  suggested: ModelCost;
}

function slotTargetValue(target: SlotTarget): string {
  return `${target.provider}:${target.modality}:${target.speed}`;
}

function slotTargetLabel(target: SlotTarget): string {
  const speed =
    target.modality === "text"
      ? TEXT_SPEED_LABELS[target.speed]
      : IMAGE_SPEED_LABELS[target.speed];
  return `${PROVIDER_LABELS[target.provider]} · ${target.modality === "text" ? "Text" : "Image"} · ${speed}`;
}

function recommendedTarget(result: ModelResolutionResult): SlotTarget {
  if (result.modality === "image") {
    return {
      provider: result.provider,
      modality: "image",
      speed: result.tier === "economy" ? "fast" : "slow",
    };
  }
  return {
    provider: result.provider,
    modality: "text",
    speed: result.tier === "economy" ? "fast" : "slow",
  };
}

function targetOptions(result: ModelResolutionResult): SlotTarget[] {
  if (result.modality === "image") {
    return IMAGE_SPEEDS.map((speed) => ({
      provider: result.provider,
      modality: "image" as const,
      speed,
    }));
  }
  return TEXT_SPEEDS.map((speed) => ({
    provider: result.provider,
    modality: "text" as const,
    speed,
  }));
}

function setSlot(config: ModelConfig, target: SlotTarget, modelId: string): ModelConfig {
  if (target.modality === "text") {
    return {
      ...config,
      slots: {
        ...config.slots,
        text: {
          ...config.slots.text,
          [target.provider]: {
            ...config.slots.text[target.provider],
            [target.speed]: modelId,
          },
        },
      },
    };
  }
  return {
    ...config,
    slots: {
      ...config.slots,
      image: {
        ...config.slots.image,
        [target.provider]: {
          ...config.slots.image[target.provider],
          [target.speed]: modelId,
        },
      },
    },
  };
}

function modelAt(config: ModelConfig, target: SlotTarget): string {
  return target.modality === "text"
    ? config.slots.text[target.provider][target.speed]
    : config.slots.image[target.provider][target.speed];
}

function useModelSuggestions(): string[] {
  const discovery = useSettingsStore((state) => state.discovery);
  return useMemo(() => {
    const ids = new Set<string>();
    for (const provider of ALL_PROVIDERS) {
      const raw = discovery[provider]?.models ?? [];
      for (const model of raw) {
        if (classifyModel(provider, model)) ids.add(model.id);
      }
      if (raw.length === 0) {
        FALLBACK_MODELS[provider].forEach((model) => ids.add(model.id));
      }
    }
    return [...ids].sort();
  }, [discovery]);
}

function ModalityBadge({ modality }: { modality: Modality }) {
  const text = modality === "text";
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide " +
        (text ? "bg-sky-100 text-sky-700" : "bg-violet-100 text-violet-700")
      }
    >
      {text ? <FileText className="size-3" /> : <ImageIcon className="size-3" />}
      {text ? "Text" : "Image"}
    </span>
  );
}

function priceForSlot(
  costs: ModelCostTable,
  provider: ProviderId,
  modelId: string,
  modality: Modality,
): ModelCost | undefined {
  const cost = costs.models[costKey(provider, modelId.trim())];
  return cost?.kind === modality ? cost : undefined;
}

function bindingOptions(
  slots: ModelSlots,
  costs: ModelCostTable,
  modality: Modality,
): { value: string; label: string; disabled?: boolean }[] {
  const options: { value: string; label: string; disabled?: boolean }[] = [];
  for (const provider of ALL_PROVIDERS) {
    const speeds = modality === "text" ? TEXT_SPEEDS : IMAGE_SPEEDS;
    for (const speed of speeds) {
      const modelId =
        modality === "text"
          ? slots.text[provider][speed as TextSpeed]
          : slots.image[provider][speed as ImageSpeed];
      if (!modelId.trim()) continue;
      const cost = priceForSlot(costs, provider, modelId, modality);
      const priced = hasUsableModelCost(cost);
      const speedLabel =
        modality === "text"
          ? TEXT_SPEED_LABELS[speed as TextSpeed]
          : IMAGE_SPEED_LABELS[speed as ImageSpeed];
      options.push({
        value: `${provider}:${speed}`,
        label: `${PROVIDER_LABELS[provider]} · ${speedLabel} · ${modelId}${priced ? "" : " · price required"}`,
        disabled: !priced,
      });
    }
  }
  return options;
}

export function ModelConfigTab() {
  const storedConfig = useAppConfigStore((state) => state.modelConfig);
  const storedCosts = useAppConfigStore((state) => state.adminModelCosts);
  const saveSetup = useAppConfigStore((state) => state.saveModelSetup);
  const resolveModel = useAppConfigStore((state) => state.resolveModel);
  const suggestCosts = useAppConfigStore((state) => state.suggestCosts);
  const settingsLoaded = useSettingsStore((state) => state.loaded);
  const loadSettings = useSettingsStore((state) => state.load);
  const providerAvailable = useSettingsStore((state) => state.providerAvailable);
  const discovery = useSettingsStore((state) => state.discovery);
  const suggestions = useModelSuggestions();
  const listId = useId();
  const addPanelRef = useRef<HTMLDivElement>(null);

  const [draft, setDraft] = useState<ModelConfig>(storedConfig);
  const [costs, setCosts] = useState<ModelCostTable>(storedCosts);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modelId, setModelId] = useState("");
  const [resolving, setResolving] = useState(false);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [resolution, setResolution] = useState<ModelResolutionResult | null>(null);
  const [resolutionError, setResolutionError] = useState("");
  const [target, setTarget] = useState<SlotTarget | null>(null);
  const [forcedTarget, setForcedTarget] = useState<SlotTarget | null>(null);
  const [openCostTarget, setOpenCostTarget] = useState("");
  const [pendingRates, setPendingRates] = useState<Record<string, PendingRate>>({});
  const [editorSeed, setEditorSeed] = useState(0);
  const [panel, setPanel] = useState<Panel>("slots");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (dirty) return;
    setDraft(storedConfig);
    setCosts(storedCosts);
    setEditorSeed((seed) => seed + 1);
  }, [storedConfig, storedCosts, dirty]);

  useEffect(() => {
    if (!settingsLoaded) void loadSettings();
  }, [loadSettings, settingsLoaded]);

  const selectedModels = useMemo(() => activeModels(draft), [draft]);
  const missingPrice = useMemo(
    () =>
      selectedModels.filter(
        (model) =>
          !hasUsableModelCost(
            priceForSlot(costs, model.provider, model.modelId, model.modality),
          ),
      ),
    [selectedModels, costs],
  );
  const unavailableModels = useMemo(
    () =>
      selectedModels.filter((model) => {
        const catalog = discovery[model.provider]?.models;
        return (
          catalog &&
          catalog.length > 0 &&
          !catalog.some(
            (candidate) =>
              candidate.id.toLowerCase() === model.modelId.toLowerCase(),
          )
        );
      }),
    [discovery, selectedModels],
  );
  const disconnectedProviders = useMemo(
    () =>
      settingsLoaded
        ? [...new Set(selectedModels.map((model) => model.provider))].filter(
            (provider) => !providerAvailable[provider],
          )
        : [],
    [providerAvailable, selectedModels, settingsLoaded],
  );
  const textOptions = useMemo(
    () => bindingOptions(draft.slots, costs, "text"),
    [draft.slots, costs],
  );
  const imageOptions = useMemo(
    () => bindingOptions(draft.slots, costs, "image"),
    [draft.slots, costs],
  );
  const textValues = new Set(textOptions.map((option) => option.value));
  const imageValues = new Set(imageOptions.map((option) => option.value));
  const invalidBindings =
    TEXT_ACTIONS.filter((action) => {
      const binding = draft.textBindings[action.id];
      return !textValues.has(`${binding.provider}:${binding.speed}`);
    }).length +
    IMAGE_ACTIONS.filter((action) => {
      const binding = draft.imageBindings[action.id]?.[CUSTOMER_IMAGE_TIER];
      return !binding || !imageValues.has(`${binding.provider}:${binding.speed}`);
    }).length;
  const ready =
    settingsLoaded &&
    missingPrice.length === 0 &&
    unavailableModels.length === 0 &&
    disconnectedProviders.length === 0 &&
    invalidBindings === 0 &&
    Object.keys(pendingRates).length === 0;
  const busy = resolving || bulkRunning || saving;

  const resetAddPanel = () => {
    setAdding(false);
    setModelId("");
    setResolution(null);
    setResolutionError("");
    setTarget(null);
    setForcedTarget(null);
  };

  const beginReplace = (nextTarget: SlotTarget, currentId = "") => {
    setPanel("slots");
    setAdding(true);
    setForcedTarget(nextTarget);
    setTarget(nextTarget);
    setModelId(currentId);
    setResolution(null);
    setResolutionError("");
    addPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const validate = async (id = modelId, requestedTarget = forcedTarget) => {
    const trimmed = id.trim();
    if (!trimmed) {
      setResolutionError("Enter a model id.");
      return;
    }
    setPanel("slots");
    setAdding(true);
    setResolving(true);
    setResolution(null);
    setResolutionError("");
    try {
      const result = await resolveModel(trimmed, requestedTarget?.provider);
      setModelId(result.modelId);
      setResolution(result);
      const compatibleForced =
        requestedTarget &&
        requestedTarget.provider === result.provider &&
        requestedTarget.modality === result.modality;
      setTarget(compatibleForced ? requestedTarget : recommendedTarget(result));
      if (!result.found || !result.modelCost) {
        setResolutionError(
          result.notes ||
            `The model exists, but no trustworthy price was found in the ${PROVIDER_LABELS[result.provider]} documentation.`,
        );
      }
    } catch (err) {
      setResolutionError(err instanceof Error ? err.message : "Model validation failed.");
    } finally {
      setResolving(false);
    }
  };

  const applyResolution = () => {
    if (!resolution?.found || !resolution.modelCost || !target) return;
    const key = costKey(resolution.provider, resolution.modelId);
    setDraft((config) => setSlot(config, target, resolution.modelId));
    setCosts((table) => ({
      ...table,
      models: { ...table.models, [key]: resolution.modelCost! },
    }));
    setPendingRates(({ [key]: _removed, ...rest }) => rest);
    setDirty(true);
    setEditorSeed((seed) => seed + 1);
    toast.success(`${resolution.modelId} is ready in ${slotTargetLabel(target)}.`);
    resetAddPanel();
  };

  const fetchAllPrices = async () => {
    if (selectedModels.length === 0) return;
    setBulkRunning(true);
    try {
      const results = await suggestCosts(
        selectedModels.map((model) => ({
          provider: model.provider,
          modelId: model.modelId,
        })),
      );
      let applied = 0;
      let review = 0;
      let unavailable = 0;
      const nextModels = { ...costs.models };
      const nextPending = { ...pendingRates };
      for (const result of results) {
        if (!result.found || !result.modelCost) {
          unavailable += 1;
          continue;
        }
        const key = costKey(result.provider, result.requestedModelId);
        const current = nextModels[key];
        if (
          result.approximate ||
          (hasUsableModelCost(current) && !costEquals(current, result.modelCost))
        ) {
          nextPending[key] = { result, suggested: result.modelCost };
          review += 1;
        } else {
          nextModels[key] = result.modelCost;
          delete nextPending[key];
          applied += 1;
        }
      }
      setCosts((table) => ({ ...table, models: nextModels }));
      setPendingRates(nextPending);
      if (applied > 0) {
        setDirty(true);
        setEditorSeed((seed) => seed + 1);
      }
      const summary = [
        applied ? `${applied} updated` : "",
        review ? `${review} need review` : "",
        unavailable ? `${unavailable} not found` : "",
      ]
        .filter(Boolean)
        .join(", ");
      if (review || unavailable) toast.warning(summary || "No prices changed.");
      else toast.success(summary || "All prices are current.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not fetch model prices.");
    } finally {
      setBulkRunning(false);
    }
  };

  const acceptPending = (key: string) => {
    const pending = pendingRates[key];
    if (!pending) return;
    setCosts((table) => ({
      ...table,
      models: { ...table.models, [key]: pending.suggested },
    }));
    setPendingRates(({ [key]: _removed, ...rest }) => rest);
    setDirty(true);
    setEditorSeed((seed) => seed + 1);
  };

  const discard = () => {
    setDraft(storedConfig);
    setCosts(storedCosts);
    setDirty(false);
    setPendingRates({});
    setOpenCostTarget("");
    setEditorSeed((seed) => seed + 1);
    resetAddPanel();
  };

  const onSave = async () => {
    setSaving(true);
    try {
      await saveSetup(draft, costs);
      setDirty(false);
      setPendingRates({});
      toast.success("AI models and costs saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save model setup.");
    } finally {
      setSaving(false);
    }
  };

  const patchCost = (provider: ProviderId, modelIdValue: string, cost: ModelCost) => {
    const key = costKey(provider, modelIdValue);
    setCosts((table) => ({
      ...table,
      models: { ...table.models, [key]: cost },
    }));
    setPendingRates(({ [key]: _removed, ...rest }) => rest);
    setDirty(true);
  };

  const setTextBinding = (
    action: TextActionId,
    provider: ProviderId,
    speed: TextSpeed,
  ) => {
    setDraft((config) => ({
      ...config,
      textBindings: { ...config.textBindings, [action]: { provider, speed } },
    }));
    setDirty(true);
  };

  const setImageBinding = (
    action: ImageActionId,
    tier: ImageTier,
    provider: ProviderId,
    speed: ImageSpeed,
  ) => {
    setDraft((config) => ({
      ...config,
      imageBindings: {
        ...config.imageBindings,
        [action]: {
          ...config.imageBindings[action],
          [tier]: { provider, speed },
        },
      },
    }));
    setDirty(true);
  };

  const setCapabilities = (
    capabilities: CapabilityOverrides | undefined,
  ) => {
    setDraft((config) => ({
      ...config,
      capabilities: capabilities ?? {},
    }));
    setDirty(true);
  };

  const renderSlot = (targetValue: SlotTarget) => {
    const currentModel = modelAt(draft, targetValue).trim();
    const cost = priceForSlot(
      costs,
      targetValue.provider,
      currentModel,
      targetValue.modality,
    );
    const priced = hasUsableModelCost(cost);
    const assigned =
      targetValue.modality === "text"
        ? Object.values(draft.textBindings).some(
            (binding) =>
              binding.provider === targetValue.provider &&
              binding.speed === targetValue.speed,
          )
        : IMAGE_ACTIONS.some((action) => {
            const binding =
              draft.imageBindings[action.id]?.[CUSTOMER_IMAGE_TIER];
            return (
              binding?.provider === targetValue.provider &&
              binding.speed === targetValue.speed
            );
          });
    const key = costKey(targetValue.provider, currentModel);
    const targetKey = slotTargetValue(targetValue);
    const pending = pendingRates[key];
    const speedLabel =
      targetValue.modality === "text"
        ? TEXT_SPEED_LABELS[targetValue.speed]
        : IMAGE_SPEED_LABELS[targetValue.speed];
    return (
      <div key={targetKey} className="border-t border-ink-100 first:border-t-0">
        <div className="grid gap-2 py-3 sm:grid-cols-[7rem_minmax(0,1fr)_auto] sm:items-center">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-ink-700">{speedLabel}</span>
          </div>
          <div className="min-w-0">
            <div className="truncate font-mono text-sm text-ink-800">
              {currentModel || "No model"}
            </div>
            <div
              className={`mt-0.5 flex items-center gap-1 text-xs ${
                priced
                  ? "text-emerald-700"
                  : assigned
                    ? "text-amber-700"
                    : "text-ink-400"
              }`}
            >
              {priced ? (
                <>
                  <CheckCircle2 className="size-3.5 shrink-0" />
                  <span className="truncate">{summarizeCost(cost)}</span>
                </>
              ) : assigned ? (
                <>
                  <AlertTriangle className="size-3.5 shrink-0" />
                  Price required
                </>
              ) : (
                "Not assigned"
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
            {currentModel && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void validate(currentModel, targetValue)}
                disabled={
                  busy || (settingsLoaded && !providerAvailable[targetValue.provider])
                }
                title="Confirm this model still exists and check its official price"
              >
                Check
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => beginReplace(targetValue)}
              disabled={
                busy || (settingsLoaded && !providerAvailable[targetValue.provider])
              }
            >
              Replace
            </Button>
            {cost && (
              <Button
                variant="ghost"
                size="sm"
                rightIcon={
                  <ChevronDown
                    className={`size-3.5 transition-transform ${openCostTarget === targetKey ? "rotate-180" : ""}`}
                  />
                }
                onClick={() =>
                  setOpenCostTarget((open) => (open === targetKey ? "" : targetKey))
                }
              >
                Rates
              </Button>
            )}
          </div>
        </div>

        {pending && (
          <div className="mb-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-inset ring-amber-200">
            <div className="font-semibold">Official pricing differs</div>
            <div className="mt-1 grid gap-1 sm:grid-cols-2">
              <span>Current: {cost ? summarizeCost(cost) : "unpriced"}</span>
              <span>Official: {summarizeCost(pending.suggested)}</span>
            </div>
            {pending.result.approximate && (
              <p className="mt-1">
                Closest documented model:{" "}
                <span className="font-mono">{pending.result.canonicalModelId}</span>. Review before
                accepting.
              </p>
            )}
            <div className="mt-2 flex gap-2">
              <Button size="sm" onClick={() => acceptPending(key)}>
                Use official price
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setPendingRates(({ [key]: _removed, ...rest }) => rest)
                }
              >
                Keep current
              </Button>
            </div>
          </div>
        )}

        {cost && openCostTarget === targetKey && (
          <div className="mb-4 rounded-xl bg-ink-50/70 p-3 ring-1 ring-inset ring-ink-100">
            <div className="mb-3">
              <div className="text-xs font-semibold text-ink-700">Advanced rates</div>
              <p className="text-[11px] text-ink-500">
                Usually filled from official documentation. Edit only when the provider has
                changed its billing structure.
              </p>
            </div>
            <ModelCostEditor
              key={`${editorSeed}-${targetKey}`}
              cost={cost}
              onChange={(next) =>
                patchCost(targetValue.provider, currentModel, next)
              }
            />
          </div>
        )}
      </div>
    );
  };

  const candidateExistingCost =
    resolution &&
    resolution.modelCost &&
    costs.models[costKey(resolution.provider, resolution.modelId)];
  const candidateUnchanged =
    Boolean(candidateExistingCost && resolution?.modelCost) &&
    costEquals(candidateExistingCost!, resolution!.modelCost!);
  const candidateAlreadyInTarget =
    Boolean(target && resolution) && modelAt(draft, target!) === resolution!.modelId;
  const showAdd = adding || Boolean(forcedTarget || resolution || resolutionError);
  const exceptions = [
    disconnectedProviders.length
      ? `${disconnectedProviders.map((provider) => PROVIDER_LABELS[provider]).join(", ")} unavailable`
      : null,
    unavailableModels.length ? `${unavailableModels.length} not live` : null,
    missingPrice.length ? `${missingPrice.length} need pricing` : null,
    invalidBindings ? `${invalidBindings} steps unassigned` : null,
    Object.keys(pendingRates).length
      ? `${Object.keys(pendingRates).length} prices to review`
      : null,
  ].filter((part): part is string => Boolean(part));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className={`text-sm ${exceptions.length ? "text-amber-800" : "text-ink-500"}`}>
          {exceptions.length ? exceptions.join(" · ") : `${selectedModels.length} models in slots`}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<RefreshCw className="size-4" />}
            onClick={() => void fetchAllPrices()}
            loading={bulkRunning}
            disabled={busy || selectedModels.length === 0}
          >
            Fetch prices
          </Button>
          <Button
            size="sm"
            leftIcon={<Plus className="size-3.5" />}
            onClick={() => {
              setPanel("slots");
              setAdding(true);
            }}
            disabled={busy}
          >
            Add
          </Button>
        </div>
      </div>

      <EditorTabs
        items={[
          { id: "slots", label: "Slots" },
          { id: "assignments", label: "Assignments" },
          { id: "quality", label: "Image quality" },
        ]}
        value={panel}
        onChange={(id) => setPanel(id as Panel)}
      />

      {panel === "slots" && (
        <div className="space-y-6">
          {showAdd ? (
            <section ref={addPanelRef} className="space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-ink-900">
                  {forcedTarget ? `Replace ${slotTargetLabel(forcedTarget)}` : "Add or replace a model"}
                </h2>
                <p className="text-sm text-ink-500">
                  Enter an exact model id. We confirm it is live and fetch its official price.
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <Field label="Model id" className="min-w-0 flex-1">
                  <Input
                    list={listId}
                    value={modelId}
                    placeholder="e.g. gpt-image-2 or gemini-2.5-flash"
                    onChange={(event) => {
                      setModelId(event.target.value);
                      setResolution(null);
                      setResolutionError("");
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void validate();
                      }
                    }}
                  />
                  <datalist id={listId}>
                    {suggestions.map((suggestion) => (
                      <option key={suggestion} value={suggestion} />
                    ))}
                  </datalist>
                </Field>
                <Button
                  size="sm"
                  onClick={() => void validate()}
                  loading={resolving}
                  disabled={busy || !modelId.trim()}
                >
                  Validate &amp; fetch
                </Button>
                <Button variant="ghost" size="sm" onClick={resetAddPanel} disabled={busy}>
                  Cancel
                </Button>
              </div>
              {resolutionError && (
                <p className="flex items-start gap-2 text-sm text-red-700">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  {resolutionError}
                </p>
              )}
              {resolution?.found && resolution.modelCost && target && (
                <div className="flex flex-wrap items-start justify-between gap-3 border-t border-ink-100 pt-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <CheckCircle2 className="size-4 text-emerald-600" />
                      <span className="font-mono text-sm font-semibold text-ink-900">
                        {resolution.modelId}
                      </span>
                      <ModalityBadge modality={resolution.modality} />
                      <span className="text-sm text-ink-500">
                        Live on {PROVIDER_LABELS[resolution.provider]}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-ink-700">{summarizeCost(resolution.modelCost)}</p>
                    {resolution.approximate && (
                      <p className="mt-1 text-sm text-amber-700">
                        Pricing is from the closest documented variant{" "}
                        <span className="font-mono">{resolution.canonicalModelId}</span>. Review it
                        before use.
                      </p>
                    )}
                    {resolution.sourceQuote && (
                      <p className="mt-1 line-clamp-2 text-sm text-ink-500">
                        Source: “{resolution.sourceQuote}”
                      </p>
                    )}
                    {resolution.reportedCapabilities?.length ? (
                      <p className="mt-1 text-sm text-ink-500">
                        Provider reports: {resolution.reportedCapabilities.join(", ")}
                      </p>
                    ) : null}
                  </div>
                  <div className="w-full space-y-2 sm:w-72">
                    <Field label="Use for">
                      <Select
                        value={slotTargetValue(target)}
                        options={targetOptions(resolution).map((option) => ({
                          value: slotTargetValue(option),
                          label: slotTargetLabel(option),
                        }))}
                        onChange={(event) => {
                          const next = targetOptions(resolution).find(
                            (option) => slotTargetValue(option) === event.target.value,
                          );
                          if (next) setTarget(next);
                        }}
                      />
                    </Field>
                    <Button
                      className="w-full"
                      onClick={applyResolution}
                      disabled={candidateAlreadyInTarget && candidateUnchanged}
                    >
                      {candidateAlreadyInTarget && candidateUnchanged
                        ? "Already up to date"
                        : resolution.approximate
                          ? "Use reviewed price"
                          : candidateAlreadyInTarget
                            ? "Update price"
                            : `Use in ${target.modality === "text" ? TEXT_SPEED_LABELS[target.speed] : IMAGE_SPEED_LABELS[target.speed]}`}
                    </Button>
                  </div>
                </div>
              )}
            </section>
          ) : (
            <div ref={addPanelRef} />
          )}

          <section className="space-y-3">
            <p className="text-sm text-ink-500">
              Each speed is a reusable slot. Replacing one updates every pipeline step assigned to
              it.
            </p>
            <div className="grid gap-6 lg:grid-cols-2">
              {ALL_PROVIDERS.map((provider) => (
                <div key={provider}>
                  <div className="flex items-center justify-between gap-2 pb-2">
                    <h3 className="text-sm font-semibold text-ink-900">
                      {PROVIDER_LABELS[provider]}
                    </h3>
                    <span
                      className={`text-sm ${
                        !settingsLoaded
                          ? "text-ink-500"
                          : providerAvailable[provider]
                            ? "text-emerald-700"
                            : "text-amber-800"
                      }`}
                    >
                      {!settingsLoaded
                        ? "Checking connection…"
                        : providerAvailable[provider]
                          ? "Connected"
                          : "Key unavailable"}
                    </span>
                  </div>
                  <p className="pb-1 text-xs font-medium text-ink-400">Text</p>
                  {TEXT_SPEEDS.map((speed) =>
                    renderSlot({ provider, modality: "text", speed }),
                  )}
                  <p className="mt-3 pb-1 text-xs font-medium text-ink-400">Image</p>
                  {IMAGE_SPEEDS.map((speed) =>
                    renderSlot({ provider, modality: "image", speed }),
                  )}
                </div>
              ))}
            </div>
          </section>

          <Disclosure label="Image capabilities">
            <ImageCapabilitiesPanel config={draft} onChange={setCapabilities} />
          </Disclosure>
        </div>
      )}

      {panel === "assignments" && (
        <div className="space-y-6">
          <section className="space-y-3">
            <p className="text-sm text-ink-500">
              Which priced slot each generation step uses.
            </p>
            <div>
              <p className="pb-2 text-xs font-medium text-ink-400">Text and vision</p>
              {TEXT_ACTIONS.map((action) => {
                const binding = draft.textBindings[action.id];
                const value = `${binding.provider}:${binding.speed}`;
                const valid = textValues.has(value);
                return (
                  <div
                    key={action.id}
                    className="grid gap-2 border-t border-ink-100 py-2.5 sm:grid-cols-[minmax(0,1fr)_20rem] sm:items-center"
                    title={action.help}
                  >
                    <span className="text-sm text-ink-700">{action.label}</span>
                    <Select
                      value={valid ? value : ""}
                      options={[
                        ...(valid
                          ? []
                          : [{ value: "", label: "Select a priced model", disabled: true }]),
                        ...textOptions,
                      ]}
                      onChange={(event) => {
                        const [provider, speed] = event.target.value.split(":");
                        setTextBinding(
                          action.id,
                          provider as ProviderId,
                          speed as TextSpeed,
                        );
                      }}
                    />
                    <TextActionParams
                      action={action.id}
                      params={textParamsFor(draft, action.id)}
                      fallback={textFallbackFor(draft, action.id)}
                      onChange={(params, fallback) => {
                        setDraft((config) => ({
                          ...config,
                          textParams: { ...config.textParams, [action.id]: params },
                          textFallback: { ...config.textFallback, [action.id]: fallback },
                        }));
                        setDirty(true);
                      }}
                    />
                  </div>
                );
              })}
              <p className="pb-2 pt-4 text-xs font-medium text-ink-400">Artwork</p>
              {IMAGE_ACTIONS.map((action) => {
                const binding = draft.imageBindings[action.id]?.[CUSTOMER_IMAGE_TIER];
                const value = binding ? `${binding.provider}:${binding.speed}` : "";
                const valid = imageValues.has(value);
                return (
                  <div
                    key={action.id}
                    className="grid gap-2 border-t border-ink-100 py-2.5 sm:grid-cols-[minmax(0,1fr)_20rem] sm:items-center"
                    title={action.help}
                  >
                    <span className="text-sm text-ink-700">{action.label}</span>
                    <Select
                      value={valid ? value : ""}
                      options={[
                        ...(valid
                          ? []
                          : [{ value: "", label: "Select a priced model", disabled: true }]),
                        ...imageOptions,
                      ]}
                      onChange={(event) => {
                        const [provider, speed] = event.target.value.split(":");
                        setImageBinding(
                          action.id,
                          CUSTOMER_IMAGE_TIER,
                          provider as ProviderId,
                          speed as ImageSpeed,
                        );
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </section>

          <Disclosure label="Historical economy bindings">
            <p className="text-sm text-ink-500">
              Retained for historical jobs and internal tools. Customers always use the artwork
              assignments above.
            </p>
            {IMAGE_ACTIONS.map((action) => {
              const tier: ImageTier = "quick";
              const binding = draft.imageBindings[action.id]?.[tier];
              const value = binding ? `${binding.provider}:${binding.speed}` : "";
              const valid = imageValues.has(value);
              return (
                <div
                  key={action.id}
                  className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_20rem] sm:items-center"
                >
                  <span className="text-sm text-ink-600">{action.label}</span>
                  <Select
                    value={valid ? value : ""}
                    options={[
                      ...(valid
                        ? []
                        : [{ value: "", label: "Select a priced model", disabled: true }]),
                      ...imageOptions,
                    ]}
                    onChange={(event) => {
                      const [provider, speed] = event.target.value.split(":");
                      setImageBinding(
                        action.id,
                        tier,
                        provider as ProviderId,
                        speed as ImageSpeed,
                      );
                    }}
                  />
                </div>
              );
            })}
          </Disclosure>
        </div>
      )}

      {panel === "quality" && <GenerationTuningPanel />}

      <AdminSaveBar
        dirty={dirty}
        saving={saving}
        saveDisabled={!ready || busy}
        saveTitle={
          !ready
            ? "Resolve pricing, assignments, and pending rate reviews before saving."
            : undefined
        }
        saveLabel="Save models & costs"
        onSave={() => void onSave()}
        onDiscard={discard}
      />
    </div>
  );
}
