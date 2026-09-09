/**
 * Branded range control for floating style-bar flyouts. Keeps a local value
 * while dragging so coalesced design commits (startTransition) don't yank
 * the thumb back to the last flushed store value.
 */
import { useEffect, useRef, useState } from "react";
import { Slider } from "../components/Slider";

export function ToolbarSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  onGestureEnd,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  onGestureEnd?: () => void;
  format?: (value: number) => string;
}) {
  const dragging = useRef(false);
  const [local, setLocal] = useState(value);

  useEffect(() => {
    if (!dragging.current) setLocal(value);
  }, [value]);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-[11px] text-ink-500">
        <span>{label}</span>
        {format && (
          <span className="tabular-nums text-ink-400">{format(local)}</span>
        )}
      </div>
      <Slider
        value={local}
        min={min}
        max={max}
        step={step}
        className="touch-none"
        onValueChange={(next) => {
          dragging.current = true;
          setLocal(next);
          onChange(next);
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          dragging.current = true;
        }}
        onPointerUp={() => {
          dragging.current = false;
          onGestureEnd?.();
        }}
        onPointerCancel={() => {
          dragging.current = false;
          onGestureEnd?.();
        }}
      />
    </div>
  );
}
