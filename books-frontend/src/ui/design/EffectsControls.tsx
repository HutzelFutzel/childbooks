import type { ElementEffects } from "../../core/types";
import { defaultShadow } from "./effects";
import { ColorField } from "./ColorPicker";

/** Inspector controls for shared {@link ElementEffects} (shadow, blur, opacity). */
export function EffectsControls({
  effects,
  onChange,
  showOpacity = false,
}: {
  effects: ElementEffects | undefined;
  onChange: (effects: ElementEffects | undefined) => void;
  /** Show an opacity slider (text & image elements). */
  showOpacity?: boolean;
}) {
  const eff = effects ?? {};

  function patch(next: Partial<ElementEffects>) {
    const merged = { ...eff, ...next };
    const empty =
      !merged.shadow && !merged.blur && (merged.opacity === undefined || merged.opacity === 1);
    onChange(empty ? undefined : merged);
  }

  const shadow = eff.shadow;

  return (
    <div className="space-y-3">
      {showOpacity && (
        <label className="flex items-center gap-2 text-xs text-ink-500">
          <span className="w-14">Opacity</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={eff.opacity ?? 1}
            onChange={(e) => patch({ opacity: Number(e.target.value) })}
            className="flex-1"
          />
          <span className="w-8 text-right tabular-nums">{Math.round((eff.opacity ?? 1) * 100)}</span>
        </label>
      )}

      <label className="flex items-center justify-between gap-2 text-xs font-medium text-ink-600">
        <span className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={!!shadow}
            onChange={(e) => patch({ shadow: e.target.checked ? defaultShadow() : undefined })}
          />
          Drop shadow
        </span>
      </label>
      {shadow && (
        <div className="space-y-2 rounded-lg bg-ink-50 p-2">
          <ColorField label="Color" value={shadow.color} onChange={(color) => patch({ shadow: { ...shadow, color } })} />
          <Slider
            label="Blur"
            min={0}
            max={0.08}
            step={0.002}
            value={shadow.blur}
            onChange={(blur) => patch({ shadow: { ...shadow, blur } })}
          />
          <Slider
            label="Offset Y"
            min={-0.04}
            max={0.04}
            step={0.002}
            value={shadow.offsetY}
            onChange={(offsetY) => patch({ shadow: { ...shadow, offsetY } })}
          />
          <Slider
            label="Offset X"
            min={-0.04}
            max={0.04}
            step={0.002}
            value={shadow.offsetX}
            onChange={(offsetX) => patch({ shadow: { ...shadow, offsetX } })}
          />
          <Slider
            label="Strength"
            min={0}
            max={1}
            step={0.05}
            value={shadow.opacity}
            onChange={(opacity) => patch({ shadow: { ...shadow, opacity } })}
          />
        </div>
      )}

      <Slider
        label="Blur"
        min={0}
        max={0.05}
        step={0.002}
        value={eff.blur ?? 0}
        onChange={(blur) => patch({ blur: blur || undefined })}
      />
    </div>
  );
}

function Slider({
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
      <span className="w-14">{label}</span>
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
