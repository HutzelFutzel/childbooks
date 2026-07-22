/**
 * Shared building blocks for the right-hand inspector panels (text, shape,
 * image). Keeping these in one place means every panel looks and behaves the
 * same — consistent sections, toggles, sliders and alignment controls.
 */
import { useState } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  ArrowUpToLine,
  Check,
  ChevronDown,
  Copy,
  Lock,
  MoveVertical,
  Trash2,
  Unlock,
} from "lucide-react";
import { cn } from "../lib/cn";

export type AlignEdge = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";

/** A titled group of controls, optionally collapsible (for rarely-used ones). */
export function Section({
  title,
  children,
  collapsible = false,
  defaultOpen = true,
  right,
}: {
  title: string;
  children: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  right?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (!collapsible) {
    return (
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">{title}</p>
          {right}
        </div>
        {children}
      </div>
    );
  }
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="mb-1.5 flex w-full items-center justify-between text-left"
      >
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-400">{title}</span>
        <ChevronDown className={cn("size-3.5 text-ink-400 transition", open ? "" : "-rotate-90")} />
      </button>
      {open && children}
    </div>
  );
}

/** A square icon button (actions, alignment). */
export function IconButton({
  children,
  onClick,
  title,
  danger,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  danger?: boolean;
  active?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={cn(
        "flex size-8 items-center justify-center rounded-lg border text-sm transition",
        active
          ? "border-brand-500 bg-brand-50 text-brand-700"
          : "border-ink-200 text-ink-600 hover:bg-ink-50",
        danger && "hover:border-red-300 hover:bg-red-50 hover:text-red-600",
      )}
    >
      {children}
    </button>
  );
}

/** A square icon toggle (bold/italic/etc.). `mixed` marks an indeterminate
 * state (some — but not all — of the selection has the style). */
export function IconToggle({
  children,
  active,
  mixed,
  onClick,
  title,
}: {
  children: React.ReactNode;
  active: boolean;
  mixed?: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={cn(
        "flex size-8 items-center justify-center rounded-lg border transition",
        active
          ? "border-brand-500 bg-brand-50 text-brand-700"
          : mixed
            ? "border-amber-400 bg-amber-50 text-amber-700"
            : "border-ink-200 text-ink-600 hover:bg-ink-50",
      )}
    >
      {children}
    </button>
  );
}

/** A text-labelled toggle that grows to fit its label and shows a check. */
export function PillToggle({
  label,
  active,
  onClick,
  title,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition",
        active
          ? "border-brand-500 bg-brand-50 text-brand-700"
          : "border-ink-200 text-ink-600 hover:bg-ink-50",
      )}
    >
      <span
        className={cn(
          "flex size-3.5 items-center justify-center rounded-[4px] border transition",
          active
            ? "border-brand-500 bg-brand-500 text-(--color-brand-foreground)"
            : "border-ink-300 text-transparent",
        )}
      >
        <Check className="size-2.5" strokeWidth={3} />
      </span>
      {label}
    </button>
  );
}

/** A labelled range slider with an optional numeric readout. */
export function Slider({
  label,
  min,
  max,
  step,
  value,
  onChange,
  format,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <label className="mt-2 flex items-center gap-2 text-xs text-ink-500">
      <span className="w-14 shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1"
      />
      {format && <span className="w-8 shrink-0 text-right tabular-nums">{format(value)}</span>}
    </label>
  );
}

/** Action bar shared by all element inspectors. */
export function ActionBar({
  locked,
  onDuplicate,
  onToggleLock,
  onDelete,
}: {
  locked?: boolean;
  onDuplicate: () => void;
  onToggleLock: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <IconButton title="Duplicate" onClick={onDuplicate}>
        <Copy className="size-4" />
      </IconButton>
      <IconButton title={locked ? "Unlock" : "Lock"} onClick={onToggleLock}>
        {locked ? <Lock className="size-4" /> : <Unlock className="size-4" />}
      </IconButton>
      <IconButton title="Delete" onClick={onDelete} danger>
        <Trash2 className="size-4" />
      </IconButton>
    </div>
  );
}

/** Snap an element to a page edge / centre. */
export function AlignPad({ onAlign }: { onAlign: (edge: AlignEdge) => void }) {
  return (
    <div className="inline-flex flex-wrap gap-1">
      <IconButton title="Left edge" onClick={() => onAlign("left")}><AlignLeft className="size-4" /></IconButton>
      <IconButton title="Centre horizontally" onClick={() => onAlign("hcenter")}><AlignCenter className="size-4" /></IconButton>
      <IconButton title="Right edge" onClick={() => onAlign("right")}><AlignRight className="size-4" /></IconButton>
      <IconButton title="Top" onClick={() => onAlign("top")}><ArrowUpToLine className="size-4" /></IconButton>
      <IconButton title="Middle" onClick={() => onAlign("vcenter")}><MoveVertical className="size-4" /></IconButton>
      <IconButton title="Bottom" onClick={() => onAlign("bottom")}><ArrowDownToLine className="size-4" /></IconButton>
    </div>
  );
}

/** Inline segmented control. */
export function SegGroup<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { id: T; node: React.ReactNode; title?: string }[];
}) {
  return (
    <div className="inline-flex rounded-lg border border-ink-200">
      {options.map((o, i) => (
        <button
          key={o.id}
          title={o.title}
          onClick={() => onChange(o.id)}
          className={cn(
            "flex size-8 items-center justify-center text-sm transition first:rounded-l-lg last:rounded-r-lg",
            i > 0 && "border-l border-ink-200",
            value === o.id ? "bg-brand-50 text-brand-700" : "text-ink-600 hover:bg-ink-50",
          )}
        >
          {o.node}
        </button>
      ))}
    </div>
  );
}
