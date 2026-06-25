import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Type } from "lucide-react";
import { CATEGORY_LABEL, FONTS, type FontCategory, fontStack, getFont, loadFont } from "./fonts";
import { cn } from "../lib/cn";

/**
 * A font selector that previews every option in its own typeface. Fonts are
 * lazily loaded when the panel opens.
 */
export function FontPicker({
  value,
  onChange,
  previewText = "Aa Bb Cc",
  className,
}: {
  value: string;
  onChange: (family: string) => void;
  previewText?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = getFont(value);

  useEffect(() => {
    if (value) loadFont(value);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    FONTS.forEach((f) => loadFont(f.id));
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const groups: FontCategory[] = ["rounded", "sans", "serif", "hand"];

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-ink-200 bg-white px-3 py-2 text-left text-sm transition hover:border-brand-300"
      >
        <span className="flex items-center gap-2 truncate">
          <Type className="size-4 shrink-0 text-ink-400" />
          <span className="truncate" style={{ fontFamily: fontStack(value) }}>
            {current?.label ?? value}
          </span>
        </span>
        <ChevronDown className="size-4 shrink-0 text-ink-400" />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 max-h-80 w-72 overflow-y-auto rounded-xl border border-ink-200 bg-white p-1 shadow-lifted">
          {groups.map((cat) => (
            <div key={cat}>
              <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                {CATEGORY_LABEL[cat]}
              </p>
              {FONTS.filter((f) => f.category === cat).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    onChange(f.family);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-ink-50",
                    f.family === value && "bg-brand-50",
                  )}
                >
                  <span className="flex flex-col">
                    <span className="text-[11px] text-ink-400">{f.label}</span>
                    <span
                      className="text-lg leading-tight text-ink-800"
                      style={{ fontFamily: fontStack(f.family) }}
                    >
                      {previewText}
                    </span>
                  </span>
                  {f.family === value && <Check className="size-4 shrink-0 text-brand-600" />}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
