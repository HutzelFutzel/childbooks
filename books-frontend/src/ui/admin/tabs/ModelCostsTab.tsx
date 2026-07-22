"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { AlertTriangle, FileText, Image as ImageIcon, Plus, Sparkles, Trash2 } from "lucide-react";
import { ALL_PROVIDERS } from "../../../core/providers";
import type { ProviderId } from "../../../core/config/options";
import {
  configuredModels,
  type ConfiguredModelRef,
} from "../../../core/config/modelConfig";
import {
  costKey,
  createImageCost,
  createTextCost,
  type ImageOutputCost,
  type LargePromptRates,
  type ModelCost,
  type ModelCostTable,
} from "../../../core/config/modelCosts";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { Button } from "../../components/Button";
import { Field, Input } from "../../components/Input";
import { Select } from "../../components/Select";

const PROVIDER_LABELS: Record<ProviderId, string> = { openai: "OpenAI", google: "Google" };

type TextCost = Extract<ModelCost, { kind: "text" }>;
type ImageCost = Extract<ModelCost, { kind: "image" }>;

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

/** A labeled group of related rate fields, so the editor reads as a form not a wall of inputs. */
function Section({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2 rounded-lg bg-ink-50/50 p-3 ring-1 ring-inset ring-ink-100">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-0.5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">{title}</div>
          {hint && <p className="text-[11px] leading-relaxed text-ink-400">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

interface Row {
  provider: ProviderId;
  modelId: string;
  cost: ModelCost;
}

function tableToRows(table: ModelCostTable): Row[] {
  return Object.entries(table.models).map(([key, cost]) => {
    const [provider, ...rest] = key.split(":");
    return { provider: provider as ProviderId, modelId: rest.join(":"), cost };
  });
}

function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function NumberField({
  label,
  value,
  step = "0.01",
  onChange,
  className = "flex-1 min-w-32",
}: {
  label: string;
  value: number;
  step?: string;
  onChange: (n: number) => void;
  className?: string;
}) {
  return (
    <Field label={label} className={className}>
      <Input
        type="number"
        min={0}
        step={step}
        value={String(value)}
        onChange={(e) => onChange(num(e.target.value))}
      />
    </Field>
  );
}

// ---- Text ------------------------------------------------------------------

function TextCostEditor({ cost, onChange }: { cost: TextCost; onChange: (c: TextCost) => void }) {
  const setLP = (patch: Partial<LargePromptRates>) =>
    onChange({
      ...cost,
      largePrompt: {
        overTokens: 200000,
        input: cost.input,
        output: cost.output,
        cachedInput: cost.cachedInput,
        ...cost.largePrompt,
        ...patch,
      },
    });
  const removeLP = () => {
    const { largePrompt: _drop, ...rest } = cost;
    void _drop;
    onChange(rest);
  };

  return (
    <div className="space-y-2.5">
      <Section title="Token rates" hint="USD per 1,000,000 tokens — copy straight from the pricing table.">
        <div className="flex flex-wrap gap-2">
          <NumberField label="Input" value={cost.input} step="0.000001" onChange={(n) => onChange({ ...cost, input: n })} />
          <NumberField label="Output" value={cost.output} step="0.000001" onChange={(n) => onChange({ ...cost, output: n })} />
          <NumberField label="Cached input" value={cost.cachedInput ?? 0} step="0.000001" onChange={(n) => onChange({ ...cost, cachedInput: n })} />
        </div>
      </Section>

      {cost.largePrompt ? (
        <Section
          title="Large-prompt rates"
          hint="Some models (e.g. Gemini 2.5 Pro) charge more once a prompt passes a token threshold."
          action={
            <Button variant="ghost" size="sm" leftIcon={<Trash2 className="size-3.5" />} onClick={removeLP}>
              Remove
            </Button>
          }
        >
          <NumberField
            label="Applies when input tokens exceed"
            value={cost.largePrompt.overTokens}
            step="1000"
            className="w-full"
            onChange={(n) => setLP({ overTokens: n })}
          />
          <div className="flex flex-wrap gap-2">
            <NumberField label="Input" value={cost.largePrompt.input} step="0.000001" onChange={(n) => setLP({ input: n })} />
            <NumberField label="Output" value={cost.largePrompt.output} step="0.000001" onChange={(n) => setLP({ output: n })} />
            <NumberField label="Cached input" value={cost.largePrompt.cachedInput ?? 0} step="0.000001" onChange={(n) => setLP({ cachedInput: n })} />
          </div>
        </Section>
      ) : (
        <Button variant="ghost" size="sm" leftIcon={<Plus className="size-3.5" />} onClick={() => setLP({})}>
          Add a higher rate for large prompts
        </Button>
      )}
    </div>
  );
}

// ---- Image -----------------------------------------------------------------

const OUTPUT_MODE_LABELS: Record<ImageOutputCost["mode"], string> = {
  perImage: "Flat price per image",
  perImageBySize: "Price per image, by output size (OpenAI)",
  perMillionTokens: "Per 1M output tokens (Gemini)",
};
const OUTPUT_MODES: ImageOutputCost["mode"][] = ["perImage", "perImageBySize", "perMillionTokens"];

function defaultOutput(mode: ImageOutputCost["mode"]): ImageOutputCost {
  if (mode === "perImageBySize") return { mode, bySize: {}, fallback: 0 };
  return { mode, rate: 0 };
}

function ImageBySizeEditor({
  value,
  onChange,
}: {
  value: Record<string, number>;
  onChange: (bySize: Record<string, number>) => void;
}) {
  // Internal array keeps rows stable while editing size keys (a plain object
  // would reorder integer-like keys mid-type). Remounted by the parent on reset.
  const [entries, setEntries] = useState<[string, number][]>(() => Object.entries(value));
  const sync = (next: [string, number][]) => {
    setEntries(next);
    onChange(Object.fromEntries(next.filter(([k]) => k.trim() !== "")));
  };
  return (
    <div className="space-y-2">
      {entries.map(([size, rate], i) => (
        <div key={i} className="flex flex-wrap items-end gap-2">
          <Field label="Output size" className="w-40">
            <Input
              value={size}
              placeholder="e.g. 1024x1024"
              onChange={(e) => sync(entries.map((en, idx) => (idx === i ? [e.target.value, en[1]] : en)))}
            />
          </Field>
          <NumberField
            label="Per image"
            value={rate}
            step="0.000001"
            onChange={(n) => sync(entries.map((en, idx) => (idx === i ? [en[0], n] : en)))}
          />
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<Trash2 className="size-3.5" />}
            onClick={() => sync(entries.filter((_, idx) => idx !== i))}
          >
            Remove
          </Button>
        </div>
      ))}
      <Button variant="ghost" size="sm" leftIcon={<Plus className="size-3.5" />} onClick={() => sync([...entries, ["", 0]])}>
        Add size
      </Button>
    </div>
  );
}

function ImageCostEditor({ cost, onChange }: { cost: ImageCost; onChange: (c: ImageCost) => void }) {
  const out = cost.output;
  return (
    <div className="space-y-2.5">
      <Section title="Input tokens" hint="USD per 1,000,000 input tokens (text + image input sent to the model).">
        <NumberField label="Input" value={cost.input} step="0.000001" className="w-full sm:w-48" onChange={(n) => onChange({ ...cost, input: n })} />
      </Section>

      <Section title="Output billing" hint="How the provider charges for the images it generates.">
        <Field label="Billing model" className="w-full sm:w-80">
          <Select
            value={out.mode}
            options={OUTPUT_MODES.map((m) => ({ value: m, label: OUTPUT_MODE_LABELS[m] }))}
            onChange={(e) => onChange({ ...cost, output: defaultOutput(e.target.value as ImageOutputCost["mode"]) })}
          />
        </Field>

        {out.mode === "perMillionTokens" && (
          <NumberField label="Output (USD per 1M tokens)" value={out.rate} step="0.000001" className="w-full sm:w-64" onChange={(n) => onChange({ ...cost, output: { ...out, rate: n } })} />
        )}
        {out.mode === "perImage" && (
          <NumberField label="Price per image (USD)" value={out.rate} step="0.000001" className="w-full sm:w-64" onChange={(n) => onChange({ ...cost, output: { ...out, rate: n } })} />
        )}
        {out.mode === "perImageBySize" && (
          <div className="space-y-3">
            <p className="text-[11px] leading-relaxed text-ink-400">
              Matched against the requested output size (captured for OpenAI image calls). Any size
              not listed uses the fallback.
            </p>
            <ImageBySizeEditor value={out.bySize} onChange={(bySize) => onChange({ ...cost, output: { ...out, bySize } })} />
            <NumberField label="Fallback per image (USD)" value={out.fallback} step="0.000001" className="w-full sm:w-64" onChange={(n) => onChange({ ...cost, output: { ...out, fallback: n } })} />
          </div>
        )}
      </Section>
    </div>
  );
}

// ---- Tab -------------------------------------------------------------------

interface SuggestMeta {
  canonicalModelId: string;
  sourceQuote: string;
  notes: string;
}

/** A suggestion that conflicts with the row's existing configured cost. */
interface PendingSuggestion extends SuggestMeta {
  suggested: ModelCost;
}

/** Stable, key-sorted serialization so cost equality ignores key order. */
function stableStringify(value: unknown): string {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function costEquals(a: ModelCost, b: ModelCost): boolean {
  return stableStringify(a) === stableStringify(b);
}

/** One-line human summary of a cost, for side-by-side conflict display. */
function summarizeCost(c: ModelCost): string {
  const m = (n: number) => `$${n}`;
  if (c.kind === "text") {
    const parts = [`in ${m(c.input)}/1M`, `out ${m(c.output)}/1M`];
    if (c.cachedInput) parts.push(`cached ${m(c.cachedInput)}/1M`);
    if (c.largePrompt) {
      parts.push(`>${c.largePrompt.overTokens} tok: in ${m(c.largePrompt.input)} / out ${m(c.largePrompt.output)}`);
    }
    return parts.join(" · ");
  }
  const o = c.output;
  const out =
    o.mode === "perMillionTokens"
      ? `out ${m(o.rate)}/1M`
      : o.mode === "perImage"
        ? `${m(o.rate)}/image`
        : `by size (${Object.keys(o.bySize).length}) · fallback ${m(o.fallback)}/image`;
  return `in ${m(c.input)}/1M · ${out}`;
}

export function ModelCostsTab() {
  const stored = useAppConfigStore((s) => s.adminModelCosts);
  const save = useAppConfigStore((s) => s.saveModelCosts);
  const modelConfig = useAppConfigStore((s) => s.modelConfig);
  const suggestCost = useAppConfigStore((s) => s.suggestCost);
  const suggestCosts = useAppConfigStore((s) => s.suggestCosts);

  const [rows, setRows] = useState<Row[]>(() => tableToRows(stored));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [suggesting, setSuggesting] = useState<number | null>(null);
  // Suggestion notes keyed by cost key (provider:modelId) so they survive rows
  // being added/reordered during a bulk run.
  const [meta, setMeta] = useState<Record<string, SuggestMeta>>({});
  // Suggestions that differ from an already-configured cost: held for the admin
  // to accept or dismiss instead of silently overwriting their values.
  const [pending, setPending] = useState<Record<string, PendingSuggestion>>({});
  const [bulkRunning, setBulkRunning] = useState(false);
  // Bumped on external sync / discard to remount editors that hold internal state.
  const [seed, setSeed] = useState(0);

  const busy = suggesting !== null || bulkRunning;

  useEffect(() => {
    if (!dirty) {
      setRows(tableToRows(stored));
      setSeed((s) => s + 1);
    }
  }, [stored, dirty]);

  // Configured slot models not covered by a row in the current draft → untracked.
  const missing = useMemo(() => {
    const covered = new Set(
      rows.filter((r) => r.modelId.trim()).map((r) => costKey(r.provider, r.modelId.trim())),
    );
    return configuredModels(modelConfig).filter((m) => !covered.has(costKey(m.provider, m.modelId)));
  }, [modelConfig, rows]);

  const patch = (i: number, fn: (r: Row) => Row) => {
    setDirty(true);
    setRows((rs) => rs.map((r, idx) => (idx === i ? fn(r) : r)));
  };

  const addMissing = (refs: ConfiguredModelRef[]) => {
    if (refs.length === 0) return;
    setDirty(true);
    setRows((rs) => [
      ...rs,
      ...refs.map((m) => ({
        provider: m.provider,
        modelId: m.modelId,
        cost: m.modality === "image" ? createImageCost() : createTextCost(),
      })),
    ]);
  };

  const addModel = (kind: "text" | "image") => {
    setDirty(true);
    setRows((rs) => [
      ...rs,
      { provider: "openai", modelId: "", cost: kind === "image" ? createImageCost() : createTextCost() },
    ]);
  };
  const removeRow = (i: number) => {
    setDirty(true);
    setRows((rs) => rs.filter((_, idx) => idx !== i));
  };
  const reset = () => {
    setDirty(false);
    setRows(tableToRows(stored));
    setMeta({});
    setPending({});
    setSeed((s) => s + 1);
  };

  const onSuggest = async (i: number) => {
    const row = rows[i];
    const id = row.modelId.trim();
    if (!id) {
      toast.error("Enter a model id first.");
      return;
    }
    setSuggesting(i);
    try {
      const res = await suggestCost(row.provider, id, row.cost.kind);
      if (!res.found || !res.modelCost) {
        toast.error(`Couldn't find pricing for "${id}" on the ${PROVIDER_LABELS[row.provider]} docs.`);
        return;
      }
      const cost = res.modelCost;
      const key = costKey(row.provider, id);
      patch(i, (r) => ({ ...r, cost }));
      setMeta((m) => ({
        ...m,
        [key]: {
          canonicalModelId: res.canonicalModelId,
          sourceQuote: res.sourceQuote,
          notes: res.notes,
        },
      }));
      setPending(({ [key]: _drop, ...rest }) => rest);
      // Remount editors so internal (by-size) state reseeds from the suggestion.
      setSeed((s) => s + 1);
      toast.success(`Suggested rates for "${id}" — please verify before saving.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Suggestion failed.");
    } finally {
      setSuggesting(null);
    }
  };

  // A cost the admin hasn't filled in yet (all rates zero / empty).
  const isUnconfigured = (cost: ModelCost): boolean => {
    if (cost.kind === "text") {
      return cost.input === 0 && cost.output === 0 && !cost.cachedInput && !cost.largePrompt;
    }
    const o = cost.output;
    const outZero =
      o.mode === "perImageBySize" ? o.fallback === 0 && Object.keys(o.bySize).length === 0 : o.rate === 0;
    return cost.input === 0 && outZero;
  };

  // Suggest costs for EVERY model selected in the Models tab, in one batched call
  // (grouped by provider server-side → one LLM call per provider, run in
  // parallel). Suggestions for unconfigured rows are applied directly; ones that
  // differ from an already-configured cost are held for the admin to decide.
  const suggestAll = async () => {
    const selected = configuredModels(modelConfig);
    if (selected.length === 0) {
      toast.info("No models are selected in the Models tab yet.");
      return;
    }

    setBulkRunning(true);
    try {
      const results = await suggestCosts(selected.map((s) => ({ provider: s.provider, modelId: s.modelId })));

      // Work from a fresh snapshot of the current rows.
      const nextRows = [...rows];
      const addMeta: Record<string, SuggestMeta> = {};
      const addPending: Record<string, PendingSuggestion> = {};
      let applied = 0;
      let conflicts = 0;
      let matched = 0;
      let notFound = 0;

      for (const res of results) {
        if (!res.found || !res.modelCost) {
          notFound += 1;
          continue;
        }
        const key = costKey(res.provider, res.requestedModelId);
        const metaObj: SuggestMeta = {
          canonicalModelId: res.canonicalModelId,
          sourceQuote: res.sourceQuote,
          notes: res.notes,
        };
        const idx = nextRows.findIndex((r) => costKey(r.provider, r.modelId.trim()) === key);

        if (idx === -1) {
          // Selected model with no cost row yet → add it with the suggestion.
          nextRows.push({ provider: res.provider, modelId: res.requestedModelId, cost: res.modelCost });
          addMeta[key] = metaObj;
          applied += 1;
        } else if (isUnconfigured(nextRows[idx].cost)) {
          nextRows[idx] = { ...nextRows[idx], cost: res.modelCost };
          addMeta[key] = metaObj;
          applied += 1;
        } else if (costEquals(nextRows[idx].cost, res.modelCost)) {
          addMeta[key] = metaObj; // already matches the docs
          matched += 1;
        } else {
          // Differs from a value the admin already configured → let them choose.
          addPending[key] = { ...metaObj, suggested: res.modelCost };
          conflicts += 1;
        }
      }

      setRows(nextRows);
      setMeta((m) => ({ ...m, ...addMeta }));
      setPending((p) => ({ ...p, ...addPending }));
      if (applied > 0) setDirty(true);
      setSeed((s) => s + 1);

      const bits = [`${applied} applied`];
      if (conflicts) bits.push(`${conflicts} need review`);
      if (matched) bits.push(`${matched} already match`);
      if (notFound) bits.push(`${notFound} not found`);
      const msg = `Suggested ${selected.length} model${selected.length === 1 ? "" : "s"}: ${bits.join(", ")}.`;
      if (conflicts || notFound) toast.warning(msg);
      else toast.success(msg);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Suggestion failed.");
    } finally {
      setBulkRunning(false);
    }
  };

  const acceptPending = (key: string) => {
    const p = pending[key];
    if (!p) return;
    const cost = p.suggested;
    setRows((rs) => rs.map((r) => (costKey(r.provider, r.modelId.trim()) === key ? { ...r, cost } : r)));
    setMeta((m) => ({
      ...m,
      [key]: { canonicalModelId: p.canonicalModelId, sourceQuote: p.sourceQuote, notes: p.notes },
    }));
    setPending(({ [key]: _drop, ...rest }) => rest);
    setDirty(true);
    setSeed((s) => s + 1);
  };

  const dismissPending = (key: string) => {
    setPending(({ [key]: _drop, ...rest }) => rest);
  };

  const onSave = async () => {
    const models: ModelCostTable["models"] = {};
    for (const r of rows) {
      const id = r.modelId.trim();
      if (id) models[costKey(r.provider, id)] = r.cost;
    }
    setSaving(true);
    try {
      await save({ version: 1, currency: "usd", models });
      setDirty(false);
      toast.success("Model costs saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-ink-500">
        Set each model&apos;s rates from its provider&apos;s pricing table, or hit{" "}
        <span className="inline-flex items-center gap-1 font-medium text-ink-600">
          <Sparkles className="size-3" /> Suggest
        </span>{" "}
        to read the official docs and pre-fill them for review. Rates are in USD; a model with no
        cost still records usage, just priced as unknown.
      </p>

      {missing.length > 0 && (
        <div className="space-y-2 rounded-xl bg-amber-50 p-3 ring-1 ring-inset ring-amber-200">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-amber-800">
            <AlertTriangle className="size-4" />
            {missing.length} configured model{missing.length === 1 ? "" : "s"} {missing.length === 1 ? "has" : "have"} no cost — usage won&apos;t be priced
          </div>
          <p className="text-xs text-amber-700">
            These models are selected in the Models tab but aren&apos;t in the cost table. Add them
            to track spend.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            {missing.map((m) => (
              <button
                key={`${m.provider}:${m.modelId}`}
                type="button"
                onClick={() => addMissing([m])}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 text-xs font-medium text-amber-900 ring-1 ring-inset ring-amber-300 transition hover:bg-amber-100"
              >
                <Plus className="size-3.5" />
                {m.modality === "image" ? (
                  <ImageIcon className="size-3.5 text-violet-500" />
                ) : (
                  <FileText className="size-3.5 text-sky-500" />
                )}
                {PROVIDER_LABELS[m.provider]} · {m.modelId}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Sparkles className="size-4" />}
              loading={bulkRunning}
              disabled={busy}
              onClick={suggestAll}
            >
              {bulkRunning ? "Reading docs…" : "Suggest from docs"}
            </Button>
            {missing.length > 1 && (
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<Plus className="size-4" />}
                disabled={busy}
                onClick={() => addMissing(missing)}
              >
                Add all empty
              </Button>
            )}
          </div>
        </div>
      )}

      {rows.length === 0 && (
        <div className="rounded-xl border border-dashed border-ink-200 p-6 text-center text-sm text-ink-400">
          No model costs yet. Add a model below, or use{" "}
          <span className="font-medium text-ink-500">Suggest all selected</span> to pull rates from
          the provider docs.
        </div>
      )}

      <div className="space-y-3">
        {rows.map((row, i) => {
          const rowKey = costKey(row.provider, row.modelId.trim());
          const rowMeta = meta[rowKey];
          const conflict = pending[rowKey];
          return (
          <div
            key={`${seed}-${i}`}
            className={`space-y-3 rounded-xl ring-1 ring-inset p-3 ${
              conflict ? "bg-amber-50/50 ring-amber-300" : "ring-ink-100"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <ModalityBadge modality={row.cost.kind} />
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<Sparkles className="size-4" />}
                  loading={suggesting === i}
                  disabled={busy || !row.modelId.trim()}
                  onClick={() => onSuggest(i)}
                  title="Read the provider's pricing docs and fill these rates"
                >
                  Suggest
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<Trash2 className="size-4" />}
                  onClick={() => removeRow(i)}
                  aria-label="Remove model"
                  title="Remove model"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <Field label="Provider" className="w-32">
                <Select
                  value={row.provider}
                  options={ALL_PROVIDERS.map((p) => ({ value: p, label: PROVIDER_LABELS[p] }))}
                  onChange={(e) => patch(i, (r) => ({ ...r, provider: e.target.value as ProviderId }))}
                />
              </Field>
              <Field label="Model id" className="flex-1 min-w-40">
                <Input
                  value={row.modelId}
                  placeholder="e.g. gpt-5.1 or gemini-2.5-flash-image"
                  onChange={(e) => patch(i, (r) => ({ ...r, modelId: e.target.value }))}
                />
              </Field>
            </div>

            {row.cost.kind === "text" ? (
              <TextCostEditor cost={row.cost} onChange={(cost) => patch(i, (r) => ({ ...r, cost }))} />
            ) : (
              <ImageCostEditor cost={row.cost} onChange={(cost) => patch(i, (r) => ({ ...r, cost }))} />
            )}

            {conflict && (
              <div className="space-y-2 rounded-lg bg-amber-50 p-2.5 text-[11px] leading-relaxed text-amber-900 ring-1 ring-inset ring-amber-300">
                <div className="flex items-center gap-1.5 text-xs font-semibold">
                  <AlertTriangle className="size-3.5" />
                  The docs suggest different rates than your current values
                </div>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  <div className="rounded-md bg-white/70 p-2 ring-1 ring-inset ring-amber-200">
                    <div className="font-medium text-amber-700">Current (configured)</div>
                    <div className="font-mono">{summarizeCost(row.cost)}</div>
                  </div>
                  <div className="rounded-md bg-white/70 p-2 ring-1 ring-inset ring-amber-200">
                    <div className="font-medium text-amber-700">Suggested (docs)</div>
                    <div className="font-mono">{summarizeCost(conflict.suggested)}</div>
                  </div>
                </div>
                {conflict.sourceQuote && <div className="font-mono text-amber-700">“{conflict.sourceQuote}”</div>}
                {conflict.notes && <div className="text-amber-600">{conflict.notes}</div>}
                <div className="flex flex-wrap gap-2 pt-0.5">
                  <Button variant="primary" size="sm" leftIcon={<Sparkles className="size-3.5" />} onClick={() => acceptPending(rowKey)}>
                    Use suggested
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => dismissPending(rowKey)}>
                    Keep current
                  </Button>
                </div>
              </div>
            )}

            {rowMeta && (
              <div className="space-y-1 rounded-lg bg-sky-50 p-2.5 text-[11px] leading-relaxed text-sky-800 ring-1 ring-inset ring-sky-200">
                <div className="flex items-center gap-1.5 font-medium">
                  <Sparkles className="size-3.5" />
                  Suggested from the {PROVIDER_LABELS[row.provider]} pricing docs — verify before saving.
                </div>
                {rowMeta.canonicalModelId && rowMeta.canonicalModelId !== row.modelId.trim() && (
                  <div>
                    Docs id: <span className="font-mono">{rowMeta.canonicalModelId}</span>
                  </div>
                )}
                {rowMeta.sourceQuote && <div className="font-mono text-sky-700">“{rowMeta.sourceQuote}”</div>}
                {rowMeta.notes && <div className="text-sky-600">{rowMeta.notes}</div>}
              </div>
            )}
          </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" leftIcon={<FileText className="size-4" />} onClick={() => addModel("text")} disabled={busy}>
            Add text model
          </Button>
          <Button variant="secondary" size="sm" leftIcon={<ImageIcon className="size-4" />} onClick={() => addModel("image")} disabled={busy}>
            Add image model
          </Button>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Sparkles className="size-4" />}
            loading={bulkRunning}
            disabled={busy}
            onClick={suggestAll}
            title="Read the docs and suggest costs for every model selected in the Models tab"
          >
            {bulkRunning ? "Reading docs…" : "Suggest all selected"}
          </Button>
        </div>
        <div className="flex gap-2">
          {dirty && (
            <Button variant="ghost" size="sm" onClick={reset} disabled={busy}>
              Discard
            </Button>
          )}
          <Button size="sm" onClick={onSave} loading={saving} disabled={!dirty || busy}>
            Save model costs
          </Button>
        </div>
      </div>
    </div>
  );
}
