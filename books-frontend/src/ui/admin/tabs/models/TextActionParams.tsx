"use client";

/**
 * Per-action text parameters on Configuration → Models → Assignments: how hard
 * the model thinks, how creative it is, how long it may answer and wait, and
 * whether the task may quietly run on the other provider.
 */
import { useState } from "react";
import { ChevronDown, RotateCcw } from "lucide-react";
import type { TextActionId } from "../../../../core/ai/actions";
import {
  DEFAULT_TEXT_FALLBACK,
  DEFAULT_TEXT_PARAMS,
  REASONING_EFFORTS,
  TEXT_PARAM_LIMITS,
  type ReasoningEffort,
  type TextCallParams,
  type TextFallback,
} from "../../../../core/config/modelConfig";
import { Select } from "../../../components/Select";
import { cn } from "../../../lib/cn";

const REASONING_HINT: Record<ReasoningEffort | "", string> = {
  "": "The model's own default. Gemini 3 thinks at a dynamic level; GPT-6 at medium.",
  none: "No thinking. Fastest and cheapest; right for short lines that code checks afterwards.",
  minimal: "A glance. Gemini 3 cannot fully switch thinking off, so none and minimal behave alike there.",
  low: "A short think. Good for reading a parent's message accurately without making them wait.",
  medium: "Balanced. Planning, analysis and extraction.",
  high: "Slow and thorough. Worth it where quality is the product: writing the story.",
};

function summary(params: TextCallParams, fallback: TextFallback): string {
  const parts: string[] = [];
  parts.push(params.reasoning ? `reasoning ${params.reasoning}` : "default reasoning");
  if (params.temperature !== undefined) parts.push(`temp ${params.temperature}`);
  if (params.maxOutputTokens !== undefined) parts.push(`${params.maxOutputTokens} tokens`);
  if (params.timeoutMs !== undefined) parts.push(`${Math.round(params.timeoutMs / 100) / 10}s timeout`);
  if (fallback === "strict") parts.push("no cross-provider fallback");
  return parts.join(" · ");
}

function numberOrUndefined(raw: string, min: number, max: number): number | undefined {
  if (raw.trim() === "") return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) return undefined;
  return Math.min(max, Math.max(min, value));
}

export function TextActionParams({
  action,
  params,
  fallback,
  onChange,
  disabled,
}: {
  action: TextActionId;
  params: TextCallParams;
  fallback: TextFallback;
  onChange: (params: TextCallParams, fallback: TextFallback) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const shippedParams = DEFAULT_TEXT_PARAMS[action] ?? {};
  const shippedFallback = DEFAULT_TEXT_FALLBACK[action] ?? "crossProvider";
  const changed =
    JSON.stringify(params) !== JSON.stringify(shippedParams) || fallback !== shippedFallback;
  const set = (patch: Partial<TextCallParams>) => {
    const next: TextCallParams = { ...params, ...patch };
    for (const key of Object.keys(next) as (keyof TextCallParams)[]) {
      if (next[key] === undefined) delete next[key];
    }
    onChange(next, fallback);
  };

  return (
    <div className="sm:col-span-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1.5 text-[11px] text-ink-400 hover:text-ink-700"
        aria-expanded={open}
      >
        <ChevronDown className={cn("size-3 transition", open && "rotate-180")} />
        {summary(params, fallback)}
        {changed && <span className="rounded-full bg-amber-50 px-1.5 text-amber-700">changed</span>}
      </button>
      {open && (
        <div className="mt-2 grid gap-3 rounded-lg bg-ink-50/70 p-3 sm:grid-cols-2">
          <label className="block text-xs">
            <span className="font-medium text-ink-700">Reasoning</span>
            <Select
              value={params.reasoning ?? ""}
              disabled={disabled}
              options={[
                { value: "", label: "Model default" },
                ...REASONING_EFFORTS.map((level) => ({ value: level, label: level })),
              ]}
              onChange={(event) =>
                set({ reasoning: (event.target.value || undefined) as ReasoningEffort | undefined })
              }
              className="mt-1 h-9 text-xs"
            />
            <span className="mt-1 block text-[11px] leading-relaxed text-ink-400">
              {REASONING_HINT[params.reasoning ?? ""]}
            </span>
          </label>
          <label className="block text-xs">
            <span className="font-medium text-ink-700">Temperature</span>
            <input
              type="number"
              step={0.1}
              min={TEXT_PARAM_LIMITS.temperature.min}
              max={TEXT_PARAM_LIMITS.temperature.max}
              disabled={disabled}
              value={params.temperature ?? ""}
              placeholder="Call site default"
              onChange={(event) =>
                set({
                  temperature: numberOrUndefined(
                    event.target.value,
                    TEXT_PARAM_LIMITS.temperature.min,
                    TEXT_PARAM_LIMITS.temperature.max,
                  ),
                })
              }
              className="mt-1 h-9 w-full rounded-lg border border-ink-200 bg-white px-2 text-xs"
            />
            <span className="mt-1 block text-[11px] leading-relaxed text-ink-400">
              Higher varies the wording more between calls. Keep reading tasks near 0; the persona composer reads
              best around 0.6–0.8. Blank keeps the value the code passes.
            </span>
          </label>
          <label className="block text-xs">
            <span className="font-medium text-ink-700">Longest answer (tokens)</span>
            <input
              type="number"
              step={50}
              min={TEXT_PARAM_LIMITS.maxOutputTokens.min}
              max={TEXT_PARAM_LIMITS.maxOutputTokens.max}
              disabled={disabled}
              value={params.maxOutputTokens ?? ""}
              placeholder="Call site default"
              onChange={(event) =>
                set({
                  maxOutputTokens: numberOrUndefined(
                    event.target.value,
                    TEXT_PARAM_LIMITS.maxOutputTokens.min,
                    TEXT_PARAM_LIMITS.maxOutputTokens.max,
                  ),
                })
              }
              className="mt-1 h-9 w-full rounded-lg border border-ink-200 bg-white px-2 text-xs"
            />
            <span className="mt-1 block text-[11px] leading-relaxed text-ink-400">
              A hard cap. Too low cuts answers off mid-sentence, which fails validation and falls back. Thinking
              tokens count against it on some models.
            </span>
          </label>
          <label className="block text-xs">
            <span className="font-medium text-ink-700">Timeout (ms)</span>
            <input
              type="number"
              step={500}
              min={TEXT_PARAM_LIMITS.timeoutMs.min}
              max={TEXT_PARAM_LIMITS.timeoutMs.max}
              disabled={disabled}
              value={params.timeoutMs ?? ""}
              placeholder="Provider default"
              onChange={(event) =>
                set({
                  timeoutMs: numberOrUndefined(
                    event.target.value,
                    TEXT_PARAM_LIMITS.timeoutMs.min,
                    TEXT_PARAM_LIMITS.timeoutMs.max,
                  ),
                })
              }
              className="mt-1 h-9 w-full rounded-lg border border-ink-200 bg-white px-2 text-xs"
            />
            <span className="mt-1 block text-[11px] leading-relaxed text-ink-400">
              The call is abandoned after this long. For the chat composer the configured wording is shown instead;
              for the story the reader sees an error. Blank uses the provider default (minutes).
            </span>
          </label>
          <label className="flex items-start gap-2 text-xs sm:col-span-2">
            <input
              type="checkbox"
              disabled={disabled}
              checked={fallback === "strict"}
              onChange={(event) => onChange(params, event.target.checked ? "strict" : "crossProvider")}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium text-ink-700">Never run this on the other provider</span>
              <span className="block text-[11px] leading-relaxed text-ink-400">
                On: if the bound provider has no key or an empty slot, the task fails instead of quietly using the
                other provider. Use it for tasks whose accuracy you measured on one model. Off: the app keeps
                working during an outage, possibly with different quality.
              </span>
            </span>
          </label>
          {changed && !disabled && (
            <button
              type="button"
              onClick={() => onChange({ ...shippedParams }, shippedFallback)}
              className="flex items-center gap-1 justify-self-start text-[11px] font-medium text-ink-600 hover:text-ink-900"
            >
              <RotateCcw className="size-3" />
              Reset to shipped values
            </button>
          )}
        </div>
      )}
    </div>
  );
}
