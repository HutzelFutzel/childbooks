import { createPortal } from "react-dom";
import { Bold, Italic, Strikethrough, Underline } from "lucide-react";
import { applyInlineColor, applyInlineCommand, type InlineCommand } from "./richText";

const SWATCHES = ["#1f2937", "#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#ffffff"];

/**
 * Floating formatting toolbar shown above a text selection while editing in
 * place. Buttons keep the selection alive (`preventDefault` on mousedown) and
 * apply styling via execCommand, which the editor parses back into spans.
 */
export function InlineTextToolbar({
  x,
  y,
  refocus,
}: {
  x: number;
  y: number;
  refocus: () => void;
}) {
  function run(fn: () => void) {
    fn();
    refocus();
  }

  return createPortal(
    <div
      className="fixed z-80 flex -translate-x-1/2 -translate-y-full items-center gap-0.5 rounded-xl border border-ink-200 bg-white/95 p-1 shadow-lifted backdrop-blur"
      style={{ left: x, top: y - 8 }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <Btn label="Bold" onClick={() => run(() => applyInlineCommand("bold"))}>
        <Bold className="size-4" />
      </Btn>
      <Btn label="Italic" onClick={() => run(() => applyInlineCommand("italic"))}>
        <Italic className="size-4" />
      </Btn>
      <Btn label="Underline" onClick={() => run(() => applyInlineCommand("underline"))}>
        <Underline className="size-4" />
      </Btn>
      <Btn label="Strikethrough" onClick={() => run(() => applyInlineCommand("strikeThrough" as InlineCommand))}>
        <Strikethrough className="size-4" />
      </Btn>
      <span className="mx-1 h-5 w-px bg-ink-200" />
      <div className="flex items-center gap-0.5">
        {SWATCHES.map((c) => (
          <button
            key={c}
            title={c}
            onClick={() => run(() => applyInlineColor(c))}
            className="size-5 rounded ring-1 ring-inset ring-black/10 transition hover:scale-110"
            style={{ background: c }}
          />
        ))}
      </div>
    </div>,
    document.body,
  );
}

function Btn({
  children,
  onClick,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      title={label}
      onClick={onClick}
      className="flex size-7 items-center justify-center rounded-lg text-ink-600 transition hover:bg-ink-100 hover:text-brand-600"
    >
      {children}
    </button>
  );
}
