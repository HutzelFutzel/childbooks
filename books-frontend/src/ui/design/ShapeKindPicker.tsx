import type { ShapeKind } from "../../core/types";
import { cn } from "../lib/cn";
import { SHAPE_DEFS, SHAPE_GROUPS, shapePath } from "./shapes";

/** Visual catalog of speech bubbles and geometric shapes. */
export function ShapeKindPicker({
  value,
  onSelect,
  columns = 4,
}: {
  value?: ShapeKind;
  onSelect: (kind: ShapeKind) => void;
  columns?: 3 | 4;
}) {
  return (
    <div className="space-y-3">
      {SHAPE_GROUPS.map((group) => (
        <div key={group.id}>
          <p className="mb-1.5 text-[11px] font-medium text-ink-500">{group.label}</p>
          <div className={cn("grid gap-1.5", columns === 3 ? "grid-cols-3" : "grid-cols-4")}>
            {group.defs.map((def) => (
              <ShapeKindSwatch
                key={def.id}
                kind={def.id}
                label={def.label}
                active={value === def.id}
                onClick={() => onSelect(def.id)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ShapeKindSwatch({
  kind,
  label,
  active,
  onClick,
}: {
  kind: ShapeKind;
  label?: string;
  active?: boolean;
  onClick: () => void;
}) {
  const size = 32;
  const pad = 5;
  const inner = size - pad * 2;
  const d = shapePath(kind, inner, inner, { corner: 0.18, points: 5, tailX: 0.3, tailY: 1.12 });
  const title = label ?? SHAPE_DEFS.find((def) => def.id === kind)?.label;
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex aspect-square items-center justify-center rounded-lg border bg-white transition",
        active
          ? "border-brand-500 bg-brand-50 ring-1 ring-brand-200"
          : "border-ink-200 hover:border-brand-300 hover:bg-ink-50",
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
