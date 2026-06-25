import type { ElementEffects, ShapeElement, ShapeKind } from "../../core/types";
import { ColorField } from "./ColorPicker";
import { EffectsControls } from "./EffectsControls";
import { SHAPE_DEFS, hasCorner, hasPoints, isBubble, shapePath } from "./shapes";
import { ActionBar, AlignPad, type AlignEdge, Section, Slider } from "./inspectorKit";
import { cn } from "../lib/cn";

/** Contextual editor for a decorative shape / speech bubble. */
export function ShapeInspector({
  shape,
  onChange,
  onDelete,
  onDuplicate,
  onAlign,
}: {
  shape: ShapeElement;
  onChange: (patch: Partial<ShapeElement>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onAlign: (edge: AlignEdge) => void;
}) {
  return (
    <div className="space-y-4 p-4">
      <ActionBar
        locked={shape.locked}
        onDuplicate={onDuplicate}
        onToggleLock={() => onChange({ locked: !shape.locked })}
        onDelete={onDelete}
      />

      <Section title="Shape">
        <div className="grid grid-cols-4 gap-1.5">
          {SHAPE_DEFS.map((def) => (
            <ShapeSwatch
              key={def.id}
              kind={def.id}
              active={shape.kind === def.id}
              onClick={() => onChange({ kind: def.id })}
            />
          ))}
        </div>
      </Section>

      <Section title="Color">
        <div className="flex flex-wrap items-center gap-3">
          <ColorField label="Fill" value={shape.fill} onChange={(fill) => onChange({ fill })} />
          <ColorField
            label="Outline"
            value={shape.stroke ?? "rgba(0,0,0,0)"}
            onChange={(stroke) => onChange({ stroke })}
          />
        </div>
        <Slider
          label="Outline"
          min={0}
          max={0.03}
          step={0.001}
          value={shape.strokeWidth ?? 0}
          onChange={(strokeWidth) => onChange({ strokeWidth })}
        />
        <Slider
          label="Opacity"
          min={0.05}
          max={1}
          step={0.02}
          value={shape.opacity ?? 1}
          onChange={(opacity) => onChange({ opacity })}
          format={(v) => `${Math.round(v * 100)}`}
        />
      </Section>

      {(hasCorner(shape.kind) || hasPoints(shape.kind) || isBubble(shape.kind)) && (
        <Section title="Shape options">
          {hasCorner(shape.kind) && (
            <Slider
              label="Round"
              min={0}
              max={0.5}
              step={0.01}
              value={shape.corner ?? 0.16}
              onChange={(corner) => onChange({ corner })}
            />
          )}
          {hasPoints(shape.kind) && (
            <Slider
              label="Points"
              min={3}
              max={12}
              step={1}
              value={shape.points ?? 5}
              onChange={(points) => onChange({ points: Math.round(points) })}
            />
          )}
          {isBubble(shape.kind) && (
            <>
              <Slider
                label="Tail ↔"
                min={-0.2}
                max={1.2}
                step={0.01}
                value={shape.tailX ?? 0.3}
                onChange={(tailX) => onChange({ tailX })}
              />
              <Slider
                label="Tail ↕"
                min={-0.3}
                max={1.6}
                step={0.01}
                value={shape.tailY ?? 1.32}
                onChange={(tailY) => onChange({ tailY })}
              />
              <p className="mt-1.5 text-[11px] text-ink-400">
                Tip: drag the dot on the bubble's tail to point it at whoever is speaking.
              </p>
            </>
          )}
        </Section>
      )}

      <Section title="Position on page">
        <AlignPad onAlign={onAlign} />
      </Section>

      <Section title="Effects" collapsible defaultOpen={!!shape.effects}>
        <EffectsControls
          effects={shape.effects}
          onChange={(effects: ElementEffects | undefined) => onChange({ effects })}
        />
      </Section>
    </div>
  );
}

function ShapeSwatch({ kind, active, onClick }: { kind: ShapeKind; active: boolean; onClick: () => void }) {
  const size = 30;
  const pad = 4;
  const inner = size - pad * 2;
  const d = shapePath(kind, inner, inner, { corner: 0.18, points: 5, tailX: 0.3, tailY: 1.12 });
  return (
    <button
      onClick={onClick}
      title={SHAPE_DEFS.find((s) => s.id === kind)?.label}
      className={cn(
        "flex aspect-square items-center justify-center rounded-lg border bg-white transition",
        active ? "border-brand-500 bg-brand-50" : "border-ink-200 hover:border-brand-300",
      )}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ overflow: "visible" }}>
        <g transform={`translate(${pad} ${pad})`}>
          <path d={d} fill={active ? "rgba(99,102,241,0.9)" : "rgba(71,85,105,0.85)"} />
        </g>
      </svg>
    </button>
  );
}
