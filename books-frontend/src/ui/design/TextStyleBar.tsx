import { createPortal } from "react-dom";
import { Bold, Italic, Underline, RotateCcw } from "lucide-react";
import { cn } from "../lib/cn";

const SWATCHES = [
  "#1f2937",
  "#ef4444",
  "#f59e0b",
  "#10b981",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#ffffff",
];

export type TextStyleKey = "bold" | "italic" | "underline";

/**
 * The single, selection-aware character-styling toolbar. It floats above the
 * text it acts on and is the only place bold/italic/underline + colour live
 * (the side inspector owns box structure only). Two callers reuse it:
 *  - box mode: a text box is selected but not being edited → styles the whole box.
 *  - word mode: while editing in place → styles just the selected words.
 * Buttons `preventDefault` on mousedown so the caret/selection survives the click.
 */
export function TextStyleBar({
  x,
  y,
  scopeLabel,
  bold,
  italic,
  underline,
  boldMixed,
  italicMixed,
  underlineMixed,
  color,
  onToggle,
  onColor,
  onReset,
}: {
  x: number;
  y: number;
  scopeLabel: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  boldMixed?: boolean;
  italicMixed?: boolean;
  underlineMixed?: boolean;
  color?: string;
  onToggle: (key: TextStyleKey) => void;
  onColor: (c: string) => void;
  onReset?: () => void;
}) {
  return createPortal(
    <div
      className="fixed z-80 -translate-x-1/2 -translate-y-full rounded-xl border border-ink-200 bg-white/95 p-1 shadow-lifted backdrop-blur"
      style={{ left: x, top: y - 10 }}
      // Keep the caret / box selection alive when a control is clicked.
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="px-1.5 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-400">
        {scopeLabel}
      </div>
      <div className="flex items-center gap-0.5">
        <Toggle
          label="Bold"
          active={bold}
          mixed={boldMixed}
          onClick={() => onToggle("bold")}
        >
          <Bold className="size-4" />
        </Toggle>
        <Toggle
          label="Italic"
          active={italic}
          mixed={italicMixed}
          onClick={() => onToggle("italic")}
        >
          <Italic className="size-4" />
        </Toggle>
        <Toggle
          label="Underline"
          active={underline}
          mixed={underlineMixed}
          onClick={() => onToggle("underline")}
        >
          <Underline className="size-4" />
        </Toggle>
        <span className="mx-1 h-5 w-px bg-ink-200" />
        <div className="flex items-center gap-0.5">
          {SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              title={c}
              onClick={() => onColor(c)}
              className="size-5 rounded ring-1 ring-inset ring-black/10 transition hover:scale-110"
              style={{ background: c }}
            />
          ))}
          <label
            title="Custom colour"
            className="ml-0.5 flex size-5 cursor-pointer items-center justify-center overflow-hidden rounded ring-1 ring-inset ring-black/10"
            style={{
              background:
                "conic-gradient(#ef4444,#f59e0b,#10b981,#3b82f6,#8b5cf6,#ec4899,#ef4444)",
            }}
          >
            <input
              type="color"
              value={color ?? "#1f2937"}
              onChange={(e) => onColor(e.target.value)}
              className="size-6 cursor-pointer opacity-0"
            />
          </label>
        </div>
        {onReset && (
          <>
            <span className="mx-1 h-5 w-px bg-ink-200" />
            <Toggle label="Clear per-word styles" active={false} onClick={onReset}>
              <RotateCcw className="size-4" />
            </Toggle>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

function Toggle({
  children,
  active,
  mixed,
  onClick,
  label,
}: {
  children: React.ReactNode;
  active: boolean;
  mixed?: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      className={cn(
        "flex size-7 items-center justify-center rounded-lg border transition",
        active
          ? "border-brand-500 bg-brand-50 text-brand-700"
          : mixed
            ? "border-amber-400 bg-amber-50 text-amber-700"
            : "border-transparent text-ink-600 hover:bg-ink-100 hover:text-brand-600",
      )}
    >
      {children}
    </button>
  );
}
