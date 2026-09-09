/**
 * Compact drop-shadow control for floating style bars. Toggle + strength only —
 * offset/blur/color stay at the defaults.
 */
import { useRef, useState } from "react";
import { Blend } from "lucide-react";
import type { ElementEffects } from "../../core/types";
import { cn } from "../lib/cn";
import { Toggle } from "../components/Toggle";
import { defaultGlyphShadow, defaultShadow } from "./effects";
import { PortalToolbarFlyout } from "./toolbarFlyout";
import { ToolbarSlider } from "./toolbarSlider";

export function ShadowFlyout({
  effects,
  onChange,
  onGestureEnd,
  coalesceKey,
  textGlyphs = false,
}: {
  effects: ElementEffects | undefined;
  onChange: (effects: ElementEffects | undefined, opts?: { coalesce?: string }) => void;
  onGestureEnd?: () => void;
  coalesceKey: string;
  /** Shadow the letters (text boxes) rather than a plate. */
  textGlyphs?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const on = !!effects?.shadow;
  const strength = effects?.shadow?.opacity ?? 0.55;

  function patchShadow(
    shadow: ElementEffects["shadow"] | undefined,
    coalesce?: boolean,
  ) {
    const next: ElementEffects = { ...effects, shadow };
    const empty =
      !next.shadow && !next.blur && (next.opacity === undefined || next.opacity === 1);
    onChange(empty ? undefined : next, coalesce ? { coalesce: coalesceKey } : undefined);
  }

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        title="Shadow"
        aria-label="Shadow"
        aria-pressed={on}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-lg border transition",
          open || on
            ? "border-brand-500 bg-brand-50 text-brand-700"
            : "border-transparent text-ink-600 hover:bg-ink-100 hover:text-brand-600",
        )}
      >
        <Blend className="size-4" />
      </button>
      <PortalToolbarFlyout
        open={open}
        onClose={() => setOpen(false)}
        triggerRef={rootRef}
        className="w-56 p-2.5"
      >
        <div className="px-0.5 pb-2.5">
          <p className="text-[11px] font-medium text-ink-600">Shadow</p>
          <p className="text-[10px] text-ink-400">
            {textGlyphs ? "Lift the letters off the page" : "Lift this shape off the page"}
          </p>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-lg bg-ink-50 px-2.5 py-2">
          <span className="text-xs font-medium text-ink-700">Drop shadow</span>
          <Toggle
            checked={on}
            label="Drop shadow"
            onChange={(checked) =>
              patchShadow(
                checked
                  ? textGlyphs
                    ? defaultGlyphShadow()
                    : { ...defaultShadow(), target: undefined }
                  : undefined,
              )
            }
          />
        </div>
        {on && effects?.shadow && (
          <div className="mt-3 px-0.5">
            <ToolbarSlider
              label="Strength"
              min={0}
              max={1}
              step={0.05}
              value={strength}
              format={(v) => `${Math.round(v * 100)}`}
              onChange={(opacity) =>
                patchShadow({ ...effects.shadow!, opacity }, true)
              }
              onGestureEnd={onGestureEnd}
            />
          </div>
        )}
      </PortalToolbarFlyout>
    </div>
  );
}
