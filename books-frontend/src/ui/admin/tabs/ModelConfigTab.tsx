"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, DollarSign, FileText, Image as ImageIcon } from "lucide-react";
import { ALL_PROVIDERS } from "../../../core/providers";
import type { ProviderId } from "../../../core/config/options";
import {
  configuredModels,
  DEFAULT_IMAGE_TIER_LABELS,
  IMAGE_SPEED_LABELS,
  IMAGE_SPEEDS,
  IMAGE_TIERS,
  TEXT_SPEED_LABELS,
  TEXT_SPEEDS,
  type ImageSpeed,
  type ImageTier,
  type ModelConfig,
  type ModelSlots,
  type TextSpeed,
} from "../../../core/config/modelConfig";
import { costKey } from "../../../core/config/modelCosts";
import { useAdminTab } from "../adminTabStore";
import {
  IMAGE_ACTIONS,
  TEXT_ACTIONS,
  type ActionInfo,
  type ImageActionId,
  type TextActionId,
} from "../../../core/ai/actions";
import { classifyModel, FALLBACK_MODELS } from "../../../core/models/catalog";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { useSettingsStore } from "../../../state/settingsStore";
import { Button } from "../../components/Button";
import { Field, Input } from "../../components/Input";
import { Select } from "../../components/Select";

const PROVIDER_LABELS: Record<ProviderId, string> = { openai: "OpenAI", google: "Google" };

function filled(id: string | undefined): id is string {
  return typeof id === "string" && id.trim().length > 0;
}

/** Combined `provider:speed` options for every FILLED slot of a modality. */
function textSlotOptions(slots: ModelSlots): { value: string; label: string }[] {
  const opts: { value: string; label: string }[] = [];
  for (const p of ALL_PROVIDERS)
    for (const s of TEXT_SPEEDS)
      if (filled(slots.text[p][s]))
        opts.push({ value: `${p}:${s}`, label: `${PROVIDER_LABELS[p]} · ${TEXT_SPEED_LABELS[s]} · ${slots.text[p][s]}` });
  return opts;
}
function imageSlotOptions(slots: ModelSlots): { value: string; label: string }[] {
  const opts: { value: string; label: string }[] = [];
  for (const p of ALL_PROVIDERS)
    for (const s of IMAGE_SPEEDS)
      if (filled(slots.image[p][s]))
        opts.push({ value: `${p}:${s}`, label: `${PROVIDER_LABELS[p]} · ${IMAGE_SPEED_LABELS[s]} · ${slots.image[p][s]}` });
  return opts;
}

/** Discovered (or catalog fallback) model ids for a provider + modality. */
function useModelSuggestions(): (p: ProviderId, modality: "text" | "image") => string[] {
  const discovery = useSettingsStore((s) => s.discovery);
  return useMemo(
    () => (provider, modality) => {
      const raw = discovery[provider]?.models ?? [];
      const ids = new Set<string>();
      for (const m of raw) {
        const c = classifyModel(provider, m);
        if (c && c.modality === modality) ids.add(c.id);
      }
      if (ids.size === 0) {
        FALLBACK_MODELS[provider]
          .filter((m) => m.modality === modality)
          .forEach((m) => ids.add(m.id));
      }
      return [...ids];
    },
    [discovery],
  );
}

function ModelIdField({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  const listId = useId();
  return (
    <>
      <Input
        list={listId}
        value={value}
        placeholder="model id"
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </>
  );
}

function ModalityBadge({ modality }: { modality: "text" | "image" }) {
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

/** One binding row: a single select listing only defined slots, with a warning when unset. */
function BindingRow({
  action,
  modality,
  value,
  options,
  valid,
  onChange,
}: {
  action: ActionInfo<string>;
  modality: "text" | "image";
  value: string;
  options: { value: string; label: string }[];
  valid: boolean;
  onChange: (provider: ProviderId, speed: string) => void;
}) {
  const accent = modality === "text" ? "border-l-sky-300" : "border-l-violet-300";
  const selectOptions = valid
    ? options
    : [{ value: "", label: "— Select a model —" }, ...options];
  return (
    <div
      className={
        "flex flex-col gap-2 rounded-xl border-l-4 ring-1 ring-inset ring-ink-100 p-3 " +
        accent +
        " sm:flex-row sm:items-center sm:justify-between" +
        (valid ? "" : " bg-amber-50/60")
      }
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <ModalityBadge modality={modality} />
          <span className="text-sm font-medium text-ink-800">{action.label}</span>
        </div>
        <div className="text-xs text-ink-500">{action.help}</div>
        {!valid && (
          <div className="mt-1 flex items-center gap-1 text-xs font-medium text-amber-700">
            <AlertTriangle className="size-3.5" />
            No model selected — pick a defined slot.
          </div>
        )}
      </div>
      <Select
        className="w-full sm:w-80"
        value={valid ? value : ""}
        options={selectOptions}
        onChange={(e) => {
          const v = e.target.value;
          if (!v) return;
          const [provider, speed] = v.split(":");
          onChange(provider as ProviderId, speed);
        }}
      />
    </div>
  );
}

function NoCostHint() {
  return (
    <span className="mt-1 flex items-center gap-1 text-[11px] font-medium text-amber-700">
      <AlertTriangle className="size-3" />
      No cost configured
    </span>
  );
}

export function ModelConfigTab() {
  const stored = useAppConfigStore((s) => s.modelConfig);
  const save = useAppConfigStore((s) => s.saveModelConfig);
  const modelCosts = useAppConfigStore((s) => s.adminModelCosts);
  const setConfigTab = useAdminTab((s) => s.setConfigTab);
  const suggestionsFor = useModelSuggestions();

  const [draft, setDraft] = useState<ModelConfig>(stored);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Keep the draft in sync with the live config until the admin starts editing.
  useEffect(() => {
    if (!dirty) setDraft(stored);
  }, [stored, dirty]);

  const setTextSlot = (p: ProviderId, speed: TextSpeed, id: string) => {
    setDirty(true);
    setDraft((d) => ({
      ...d,
      slots: { ...d.slots, text: { ...d.slots.text, [p]: { ...d.slots.text[p], [speed]: id } } },
    }));
  };
  const setImageSlot = (p: ProviderId, speed: ImageSpeed, id: string) => {
    setDirty(true);
    setDraft((d) => ({
      ...d,
      slots: { ...d.slots, image: { ...d.slots.image, [p]: { ...d.slots.image[p], [speed]: id } } },
    }));
  };
  const setTextBinding = (action: TextActionId, provider: ProviderId, speed: TextSpeed) => {
    setDirty(true);
    setDraft((d) => ({ ...d, textBindings: { ...d.textBindings, [action]: { provider, speed } } }));
  };
  const setImageBinding = (
    action: ImageActionId,
    tier: ImageTier,
    provider: ProviderId,
    speed: ImageSpeed,
  ) => {
    setDirty(true);
    setDraft((d) => ({
      ...d,
      imageBindings: {
        ...d.imageBindings,
        [action]: { ...d.imageBindings[action], [tier]: { provider, speed } },
      },
    }));
  };
  const setTierLabel = (tier: ImageTier, label: string) => {
    setDirty(true);
    setDraft((d) => ({ ...d, imageTierLabels: { ...d.imageTierLabels, [tier]: label } }));
  };
  const tierLabel = (tier: ImageTier) =>
    draft.imageTierLabels?.[tier]?.trim() || DEFAULT_IMAGE_TIER_LABELS[tier];

  const hasCost = (p: ProviderId, modelId: string) =>
    !!modelId.trim() && !!modelCosts.models[costKey(p, modelId.trim())];
  const missingCost = useMemo(
    () => configuredModels(draft).filter((m) => !modelCosts.models[costKey(m.provider, m.modelId)]),
    [draft, modelCosts],
  );

  const textOptions = useMemo(() => textSlotOptions(draft.slots), [draft.slots]);
  const imageOptions = useMemo(() => imageSlotOptions(draft.slots), [draft.slots]);
  const textValues = new Set(textOptions.map((o) => o.value));
  const imageValues = new Set(imageOptions.map((o) => o.value));

  const invalidCount =
    TEXT_ACTIONS.filter((a) => {
      const b = draft.textBindings[a.id];
      return !textValues.has(`${b.provider}:${b.speed}`);
    }).length +
    IMAGE_ACTIONS.reduce((n, a) => {
      const tiers = draft.imageBindings[a.id];
      return (
        n +
        IMAGE_TIERS.filter((t) => {
          const b = tiers?.[t];
          return !b || !imageValues.has(`${b.provider}:${b.speed}`);
        }).length
      );
    }, 0);
  const allValid = invalidCount === 0;

  const onSave = async () => {
    setSaving(true);
    try {
      await save(draft);
      setDirty(false);
      toast.success("Model configuration saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-7">
      {missingCost.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl bg-amber-50 p-3 ring-1 ring-inset ring-amber-200 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-1.5 text-sm font-semibold text-amber-800">
              <AlertTriangle className="size-4" />
              {missingCost.length} selected model{missingCost.length === 1 ? "" : "s"} {missingCost.length === 1 ? "has" : "have"} no cost configured
            </div>
            <p className="text-xs text-amber-700">
              Usage for {missingCost.length === 1 ? "this model" : "these models"} is recorded but
              not priced. Add {missingCost.length === 1 ? "its" : "their"} rates for proper spend
              tracking.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<DollarSign className="size-4" />}
            onClick={() => setConfigTab("modelCosts")}
          >
            Configure costs
          </Button>
        </div>
      )}

      {/* Stage 1: slots */}
      <section className="space-y-3">
        <header>
          <h3 className="text-sm font-semibold text-ink-800">Stage 1 · Model slots</h3>
          <p className="text-xs text-ink-500">
            Pick the concrete model for each provider + speed. Leave a slot blank if you don&apos;t
            use it. Actions below can only bind to slots that have a model.
          </p>
        </header>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {ALL_PROVIDERS.map((p) => (
            <div key={p} className="space-y-3 rounded-xl ring-1 ring-inset ring-ink-100 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                {PROVIDER_LABELS[p]}
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-medium text-ink-600">
                  <FileText className="size-3.5 text-sky-500" /> Text
                </div>
                {TEXT_SPEEDS.map((speed) => (
                  <Field key={speed} label={TEXT_SPEED_LABELS[speed]}>
                    <ModelIdField
                      value={draft.slots.text[p][speed]}
                      options={suggestionsFor(p, "text")}
                      onChange={(v) => setTextSlot(p, speed, v)}
                    />
                    {draft.slots.text[p][speed].trim() !== "" && !hasCost(p, draft.slots.text[p][speed]) && (
                      <NoCostHint />
                    )}
                  </Field>
                ))}
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-medium text-ink-600">
                  <ImageIcon className="size-3.5 text-violet-500" /> Image
                </div>
                {IMAGE_SPEEDS.map((speed) => (
                  <Field key={speed} label={IMAGE_SPEED_LABELS[speed]}>
                    <ModelIdField
                      value={draft.slots.image[p][speed]}
                      options={suggestionsFor(p, "image")}
                      onChange={(v) => setImageSlot(p, speed, v)}
                    />
                    {draft.slots.image[p][speed].trim() !== "" && !hasCost(p, draft.slots.image[p][speed]) && (
                      <NoCostHint />
                    )}
                  </Field>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Stage 2: bindings */}
      <section className="space-y-3">
        <header>
          <h3 className="text-sm font-semibold text-ink-800">Stage 2 · Action bindings</h3>
          <p className="text-xs text-ink-500">
            Choose which model each AI action uses. Only defined slots are selectable.
          </p>
        </header>

        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <ModalityBadge modality="text" />
              <span className="text-xs font-semibold text-ink-600">Text actions</span>
            </div>
            {textOptions.length === 0 && (
              <div className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
                <AlertTriangle className="size-3.5" />
                No text model slots are defined. Add one above before binding text actions.
              </div>
            )}
            {TEXT_ACTIONS.map((action) => {
              const b = draft.textBindings[action.id];
              const value = `${b.provider}:${b.speed}`;
              return (
                <BindingRow
                  key={action.id}
                  action={action}
                  modality="text"
                  value={value}
                  options={textOptions}
                  valid={textValues.has(value)}
                  onChange={(provider, speed) => setTextBinding(action.id, provider, speed as TextSpeed)}
                />
              );
            })}
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <ModalityBadge modality="image" />
              <span className="text-xs font-semibold text-ink-600">Image actions</span>
            </div>
            <p className="text-xs text-ink-500">
              Each image action binds one model per user-facing quality tier. Users pick their
              default tier in Settings and can switch per generation, so e.g. &ldquo;{tierLabel("quick")}&rdquo;
              can be a fast Gemini model while &ldquo;{tierLabel("premium")}&rdquo; is a higher-fidelity
              OpenAI model.
            </p>
            {imageOptions.length === 0 && (
              <div className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
                <AlertTriangle className="size-3.5" />
                No image model slots are defined. Add one above before binding image actions.
              </div>
            )}
            {IMAGE_ACTIONS.map((action) => (
              <div
                key={action.id}
                className="space-y-2 rounded-xl ring-1 ring-inset ring-ink-100 p-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <ModalityBadge modality="image" />
                    <span className="text-sm font-medium text-ink-800">{action.label}</span>
                  </div>
                  <div className="text-xs text-ink-500">{action.help}</div>
                </div>
                {IMAGE_TIERS.map((tier) => {
                  const b = draft.imageBindings[action.id]?.[tier];
                  const value = b ? `${b.provider}:${b.speed}` : "";
                  const valid = imageValues.has(value);
                  const selectOptions = valid
                    ? imageOptions
                    : [{ value: "", label: "— Select a model —" }, ...imageOptions];
                  return (
                    <div
                      key={tier}
                      className={
                        "flex flex-col gap-1.5 rounded-lg border-l-4 border-l-violet-200 px-3 py-2 sm:flex-row sm:items-center sm:justify-between" +
                        (valid ? " bg-ink-50/40" : " bg-amber-50/60")
                      }
                    >
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center rounded-md bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700">
                          {tierLabel(tier)}
                        </span>
                        {!valid && (
                          <span className="flex items-center gap-1 text-xs font-medium text-amber-700">
                            <AlertTriangle className="size-3.5" />
                            Pick a model
                          </span>
                        )}
                      </div>
                      <Select
                        className="w-full sm:w-80"
                        value={valid ? value : ""}
                        options={selectOptions}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (!v) return;
                          const [provider, speed] = v.split(":");
                          setImageBinding(action.id, tier, provider as ProviderId, speed as ImageSpeed);
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Stage 3: tier names */}
      <section className="space-y-3">
        <header>
          <h3 className="text-sm font-semibold text-ink-800">Stage 3 · Quality tier names</h3>
          <p className="text-xs text-ink-500">
            The labels users see when choosing image quality. Defaults are
            &ldquo;{DEFAULT_IMAGE_TIER_LABELS.quick}&rdquo; and &ldquo;{DEFAULT_IMAGE_TIER_LABELS.premium}&rdquo;.
          </p>
        </header>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {IMAGE_TIERS.map((tier) => (
            <Field key={tier} label={tier === "quick" ? "Faster / cheaper tier" : "Higher-quality tier"}>
              <Input
                value={draft.imageTierLabels?.[tier] ?? ""}
                placeholder={DEFAULT_IMAGE_TIER_LABELS[tier]}
                onChange={(e) => setTierLabel(tier, e.target.value)}
              />
            </Field>
          ))}
        </div>
      </section>

      <div className="flex items-center justify-end gap-3">
        {!allValid && (
          <span className="flex items-center gap-1.5 text-xs font-medium text-amber-700">
            <AlertTriangle className="size-3.5" />
            {invalidCount} action{invalidCount === 1 ? "" : "s"} need a valid model before saving.
          </span>
        )}
        {dirty && (
          <Button variant="ghost" size="sm" onClick={() => { setDirty(false); setDraft(stored); }}>
            Discard
          </Button>
        )}
        <Button size="sm" onClick={onSave} loading={saving} disabled={!dirty || !allValid}>
          Save models
        </Button>
      </div>
    </div>
  );
}
