import type { PatternConfig } from "../../core/types";
import { PATTERNS, PatternFill, defaultPatternConfig } from "./patterns";
import { ColorField } from "./ColorPicker";
import { cn } from "../lib/cn";

/** Choose & configure a tiling pattern (or clear it). */
export function PatternPicker({
  value,
  onChange,
}: {
  value?: PatternConfig;
  onChange: (config: PatternConfig | undefined) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-5 gap-1.5">
        <button
          onClick={() => onChange(undefined)}
          className={cn(
            "flex aspect-square items-center justify-center rounded-lg border text-[10px] text-ink-400",
            !value ? "border-brand-500 bg-brand-50" : "border-ink-200 hover:border-brand-300",
          )}
          title="No pattern"
        >
          None
        </button>
        {PATTERNS.map((p) => {
          const cfg: PatternConfig = value?.patternId === p.id ? value : defaultPatternConfig(p.id);
          return (
            <button
              key={p.id}
              onClick={() => onChange({ ...cfg, patternId: p.id })}
              title={p.label}
              className={cn(
                "relative aspect-square overflow-hidden rounded-lg border bg-white",
                value?.patternId === p.id ? "border-brand-500" : "border-ink-200 hover:border-brand-300",
              )}
            >
              <PatternFill config={{ ...defaultPatternConfig(p.id), color: "rgba(71,85,105,0.9)" }} />
            </button>
          );
        })}
      </div>

      {value && (
        <div className="space-y-2 rounded-lg bg-ink-50 p-2.5">
          <div className="flex items-center gap-3">
            <ColorField label="Motif" value={value.color} onChange={(color) => onChange({ ...value, color })} />
            <ColorField label="Behind" value={value.background} onChange={(background) => onChange({ ...value, background })} />
          </div>
          <RangeRow
            label="Scale"
            min={0.25}
            max={4}
            step={0.05}
            value={value.scale}
            onChange={(scale) => onChange({ ...value, scale })}
          />
          <RangeRow
            label="Rotate"
            min={0}
            max={180}
            step={1}
            value={value.rotation}
            onChange={(rotation) => onChange({ ...value, rotation })}
          />
          <RangeRow
            label="Opacity"
            min={0}
            max={1}
            step={0.02}
            value={value.opacity}
            onChange={(opacity) => onChange({ ...value, opacity })}
          />
        </div>
      )}
    </div>
  );
}

function RangeRow({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-ink-500">
      <span className="w-12 shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1"
      />
    </label>
  );
}
