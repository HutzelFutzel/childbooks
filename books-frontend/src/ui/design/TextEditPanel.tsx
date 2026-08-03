/**
 * Docked Canva-style edit panel for text-box chrome that shouldn't cover the
 * selection: Effects and Background only. Everyday controls live on the
 * floating TextStyleBar.
 */
import type { ElementEffects, TextBox } from "../../core/types";
import { ColorField } from "./ColorPicker";
import { parseColor } from "./color";
import { effectiveBackdropBlur } from "./effects";
import { EffectsControls } from "./EffectsControls";

export type TextEditSection = "effects" | "background";

export function TextEditPanel({
  box,
  section,
  onPatch,
  onGestureEnd,
}: {
  box: TextBox;
  section: TextEditSection;
  onPatch: (patch: Partial<TextBox>, opts?: { coalesce?: string }) => void;
  onGestureEnd: () => void;
}) {
  if (section === "effects") {
    return (
      <div className="p-4">
        <EffectsControls
          effects={box.effects}
          showShadowTarget
          showContentBlur={false}
          onChange={(effects, meta) =>
            onPatch(
              { effects },
              meta?.coalesce ? { coalesce: `effects-${box.id}` } : undefined,
            )
          }
          onGestureEnd={onGestureEnd}
        />
      </div>
    );
  }

  const hasBg = box.fill !== undefined && parseColor(box.fill).a > 0;

  return (
    <div className="space-y-3 p-4">
      <label className="flex items-center gap-2 text-xs font-medium text-ink-600">
        <input
          type="checkbox"
          checked={hasBg}
          onChange={(e) =>
            onPatch({
              fill: e.target.checked ? "rgba(255,255,255,1)" : "rgba(0,0,0,0)",
            })
          }
        />
        Behind text
      </label>
      {hasBg && (
        <ColorField
          label="Fill"
          value={box.fill!}
          onChange={(fill) => onPatch({ fill }, { coalesce: `fill-${box.id}` })}
        />
      )}

      <div>
        <label className="flex items-center gap-2 text-xs text-ink-500">
          <span className="w-24 shrink-0">Backdrop blur</span>
          <input
            type="range"
            min={0}
            max={0.05}
            step={0.002}
            value={effectiveBackdropBlur(box)}
            onChange={(e) => {
              const v = Number(e.target.value);
              onPatch(backdropBlurPatch(box, v), { coalesce: `backdrop-${box.id}` });
            }}
            onPointerUp={onGestureEnd}
            onPointerCancel={onGestureEnd}
            className="flex-1"
          />
        </label>
        <p className="mt-1 text-[10px] leading-snug text-ink-400">
          Frosts the illustration and elements behind this box. Best with a
          translucent fill — does not blur the text.
        </p>
      </div>
    </div>
  );
}

/** Write backdropBlur and clear any legacy content blur on effects.blur. */
function backdropBlurPatch(box: TextBox, value: number): Partial<TextBox> {
  const backdropBlur = value > 0 ? value : undefined;
  const patch: Partial<TextBox> = { backdropBlur };
  if (box.effects?.blur != null) {
    const next: ElementEffects = { ...box.effects, blur: undefined };
    const empty =
      !next.shadow && !next.blur && (next.opacity === undefined || next.opacity === 1);
    patch.effects = empty ? undefined : next;
  }
  return patch;
}
