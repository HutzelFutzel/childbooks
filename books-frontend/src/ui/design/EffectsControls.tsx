import type { ElementEffects, ShadowTarget } from "../../core/types";
import { cn } from "../lib/cn";
import { defaultShadow } from "./effects";
import { ColorField } from "./ColorPicker";

const SHADOW_TARGETS: { id: ShadowTarget; label: string; title: string }[] = [
  { id: "box", label: "Box", title: "Shadow the text box plate (works with transparent fill)" },
  { id: "text", label: "Text", title: "Shadow the letters only" },
  { id: "both", label: "Both", title: "Shadow the plate and the letters" },
];

/** Inspector controls for shared {@link ElementEffects} (shadow, blur, opacity). */
export function EffectsControls({
  effects,
  onChange,
  onGestureEnd,
  showOpacity = false,
  /** Text boxes: let the user choose box vs glyph shadow. */
  showShadowTarget = false,
  /**
   * Content blur (shapes/images). Text boxes use Background → Backdrop blur
   * instead, so pass false there.
   */
  showContentBlur = true,
}: {
  effects: ElementEffects | undefined;
  onChange: (effects: ElementEffects | undefined, opts?: { coalesce?: boolean }) => void;
  /** Call when a slider drag ends so undo coalescing can close the gesture. */
  onGestureEnd?: () => void;
  /** Show an opacity slider (text & image elements). */
  showOpacity?: boolean;
  showShadowTarget?: boolean;
  showContentBlur?: boolean;
}) {
  const eff = effects ?? {};

  function patch(next: Partial<ElementEffects>, coalesce?: boolean) {
    const merged = { ...eff, ...next };
    const empty =
      !merged.shadow && !merged.blur && (merged.opacity === undefined || merged.opacity === 1);
    onChange(empty ? undefined : merged, coalesce ? { coalesce: true } : undefined);
  }

  const shadow = eff.shadow;
  // Match resolveShadowTarget: legacy shadows without `target` are "text".
  const target: ShadowTarget = shadow?.target ?? "text";
  const gestureEnd = {
    onPointerUp: onGestureEnd,
    onPointerCancel: onGestureEnd,
  };

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
            onChange={(e) => patch({ opacity: Number(e.target.value) }, true)}
            {...gestureEnd}
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
            onChange={(e) =>
              patch({
                shadow: e.target.checked
                  ? showShadowTarget
                    ? defaultShadow()
                    : { ...defaultShadow(), target: undefined }
                  : undefined,
              })
            }
          />
          Drop shadow
        </span>
      </label>
      {shadow && (
        <div className="space-y-2 rounded-lg bg-ink-50 p-2">
          {showShadowTarget && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-400">
                Shadow on
              </p>
              <div className="inline-flex rounded-lg border border-ink-200 bg-white p-0.5">
                {SHADOW_TARGETS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    title={opt.title}
                    onClick={() => patch({ shadow: { ...shadow, target: opt.id } })}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-xs font-medium transition",
                      target === opt.id
                        ? "bg-brand-50 text-brand-700"
                        : "text-ink-500 hover:text-ink-700",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <ColorField
            label="Color"
            value={shadow.color}
            onChange={(color) => patch({ shadow: { ...shadow, color } }, true)}
          />
          <Slider
            label="Blur"
            min={0}
            max={0.08}
            step={0.002}
            value={shadow.blur}
            onChange={(blur) => patch({ shadow: { ...shadow, blur } }, true)}
            onGestureEnd={onGestureEnd}
          />
          <Slider
            label="Offset Y"
            min={-0.04}
            max={0.04}
            step={0.002}
            value={shadow.offsetY}
            onChange={(offsetY) => patch({ shadow: { ...shadow, offsetY } }, true)}
            onGestureEnd={onGestureEnd}
          />
          <Slider
            label="Offset X"
            min={-0.04}
            max={0.04}
            step={0.002}
            value={shadow.offsetX}
            onChange={(offsetX) => patch({ shadow: { ...shadow, offsetX } }, true)}
            onGestureEnd={onGestureEnd}
          />
          <Slider
            label="Strength"
            min={0}
            max={1}
            step={0.05}
            value={shadow.opacity}
            onChange={(opacity) => patch({ shadow: { ...shadow, opacity } }, true)}
            onGestureEnd={onGestureEnd}
          />
        </div>
      )}

      {showContentBlur && (
        <Slider
          label="Blur"
          min={0}
          max={0.05}
          step={0.002}
          value={eff.blur ?? 0}
          onChange={(blur) => patch({ blur: blur || undefined }, true)}
          onGestureEnd={onGestureEnd}
        />
      )}
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
  onGestureEnd,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  onGestureEnd?: () => void;
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
        onPointerUp={onGestureEnd}
        onPointerCancel={onGestureEnd}
        className="flex-1"
      />
    </label>
  );
}
