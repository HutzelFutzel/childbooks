import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RgbaColorPicker } from "react-colorful";
import { Pipette } from "lucide-react";
import { useSettingsStore } from "../../state/settingsStore";
import { parseColor, toHex, toRgbaString, type RGBA } from "./color";
import { cn } from "../lib/cn";

interface EyeDropperCtor {
  new (): { open: () => Promise<{ sRGBHex: string }> };
}

/** A small, friendly starter palette so the quick-pick is useful immediately. */
const STARTER_PALETTE = [
  "#1f2430",
  "#ffffff",
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
  "#6366f1",
  "#a855f7",
  "#ec4899",
  "rgba(0,0,0,0)",
];

function Swatch({ color, onClick }: { color: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={color}
      onClick={onClick}
      className="size-5 rounded ring-1 ring-inset ring-black/10 transition hover:scale-110"
      style={{
        backgroundImage:
          "linear-gradient(45deg,#ccc 25%,transparent 25%,transparent 75%,#ccc 75%),linear-gradient(45deg,#ccc 25%,#fff 25%,#fff 75%,#ccc 75%)",
        backgroundSize: "8px 8px",
        backgroundPosition: "0 0,4px 4px",
      }}
    >
      <span className="block size-full rounded" style={{ background: color }} />
    </button>
  );
}

function colorsEqual(a: string, b: string): boolean {
  const pa = parseColor(a);
  const pb = parseColor(b);
  return (
    Math.round(pa.r) === Math.round(pb.r) &&
    Math.round(pa.g) === Math.round(pb.g) &&
    Math.round(pa.b) === Math.round(pb.b) &&
    Math.abs(pa.a - pb.a) < 0.001
  );
}

/**
 * Compact swatch that opens a portaled RGBA picker.
 * Dragging the picker only updates a local draft; the parent `onChange` runs
 * when the popover closes (or when a swatch / eyedropper commits immediately).
 */
export function ColorField({
  label,
  value,
  onChange,
  allowAlpha = true,
  compact = false,
}: {
  label?: string;
  value: string;
  onChange: (color: string) => void;
  allowAlpha?: boolean;
  /** Swatch-only trigger for dense floating toolbars. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<RGBA>(() => parseColor(value));
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef(draft);
  const valueRef = useRef(value);
  const colorHistory = useSettingsStore((s) => s.settings.colorHistory);
  const pushColor = useSettingsStore((s) => s.pushColor);

  draftRef.current = draft;
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const pushColorRef = useRef(pushColor);
  pushColorRef.current = pushColor;
  const allowAlphaRef = useRef(allowAlpha);
  allowAlphaRef.current = allowAlpha;
  /** When true, the open-effect cleanup must not persist the draft (Escape). */
  const discardOnCloseRef = useRef(false);

  const commitDraft = (next: RGBA) => {
    const css = toRgbaString(allowAlphaRef.current ? next : { ...next, a: 1 });
    if (colorsEqual(css, valueRef.current)) return;
    onChangeRef.current(css);
    pushColorRef.current(css);
  };

  const close = (commit: boolean) => {
    discardOnCloseRef.current = !commit;
    if (commit) commitDraft(draftRef.current);
    setOpen(false);
    setMenuPos(null);
  };

  // Keep the closed swatch in sync with external value.
  useEffect(() => {
    if (!open) setDraft(parseColor(value));
  }, [value, open]);

  useLayoutEffect(() => {
    if (!open) return;
    setDraft(parseColor(value));
    const place = () => {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const menuW = 224; // w-56
      const menuH = 360;
      let left = r.left;
      let top = r.bottom + 4;
      if (left + menuW > window.innerWidth - 8) left = Math.max(8, window.innerWidth - menuW - 8);
      if (top + menuH > window.innerHeight - 8) top = Math.max(8, r.top - menuH - 4);
      setMenuPos({ left, top });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    discardOnCloseRef.current = false;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      close(true);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      // Unmount while open (panel swap): keep the draft unless Escape discarded it.
      // Normal close(true) already committed — colorsEqual makes a second pass a no-op.
      if (!discardOnCloseRef.current) commitDraft(draftRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open session; commit via refs
  }, [open]);

  function setDraftColor(next: RGBA) {
    setDraft(allowAlpha ? next : { ...next, a: 1 });
  }

  const hasEyeDropper = typeof window !== "undefined" && "EyeDropper" in window;

  async function pickFromScreen() {
    const Ctor = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;
    if (!Ctor) return;
    try {
      const res = await new Ctor().open();
      const picked = parseColor(res.sRGBHex);
      const next = { ...picked, a: draft.a };
      setDraftColor(next);
      commitDraft(next);
    } catch {
      /* user cancelled */
    }
  }

  const display = open ? toRgbaString(draft) : value;

  return (
    <div className={cn("relative", compact && "shrink-0")}>
      {label && !compact && (
        <span className="mb-1 block text-xs font-medium text-ink-500">{label}</span>
      )}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close(true) : setOpen(true))}
        title={label ?? "Choose color"}
        aria-label={label ?? "Choose color"}
        className={cn(
          "flex items-center rounded-lg border border-ink-200 bg-white text-xs transition hover:border-brand-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400",
          compact ? "size-7 justify-center p-0" : "gap-2 px-2 py-1.5",
        )}
      >
        <span
          className={cn(
            "rounded ring-1 ring-inset ring-black/10",
            compact ? "size-4" : "size-5",
          )}
          style={{
            backgroundImage:
              "linear-gradient(45deg,#ccc 25%,transparent 25%,transparent 75%,#ccc 75%),linear-gradient(45deg,#ccc 25%,#fff 25%,#fff 75%,#ccc 75%)",
            backgroundSize: "8px 8px",
            backgroundPosition: "0 0,4px 4px",
          }}
        >
          <span className="block size-full rounded" style={{ background: display }} />
        </span>
        {!compact && (
          <span className="font-mono text-ink-600">
            {toHex(open ? draft : parseColor(value))}
          </span>
        )}
      </button>

      {open &&
        menuPos &&
        createPortal(
          <div
            ref={menuRef}
            data-color-picker-popover
            className="fixed z-100 w-56 rounded-xl border border-ink-200 bg-white p-3 shadow-lifted"
            style={{ left: menuPos.left, top: menuPos.top }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <RgbaColorPicker color={draft} onChange={(c) => setDraftColor(c)} />
            <div className="mt-3 flex items-center gap-2">
              <input
                value={toHex(draft)}
                onChange={(e) => {
                  const p = parseColor(e.target.value);
                  setDraftColor({ ...p, a: draft.a });
                }}
                onBlur={() => commitDraft(draftRef.current)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.currentTarget.blur();
                    close(true);
                  }
                }}
                className="w-24 rounded-md border border-ink-200 px-2 py-1 font-mono text-xs"
              />
              {allowAlpha && (
                <label className="flex items-center gap-1 text-xs text-ink-500">
                  A
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={Math.round(draft.a * 100)}
                    onChange={(e) =>
                      setDraftColor({ ...draft, a: Number(e.target.value) / 100 })
                    }
                    onBlur={() => commitDraft(draftRef.current)}
                    className="w-14 rounded-md border border-ink-200 px-1.5 py-1 text-xs"
                  />
                </label>
              )}
              <button
                type="button"
                title={
                  hasEyeDropper
                    ? "Sample a color from anywhere"
                    : "Pipette not supported in this browser"
                }
                disabled={!hasEyeDropper}
                onClick={() => void pickFromScreen()}
                className={cn(
                  "ml-auto rounded-md p-1.5 transition",
                  hasEyeDropper
                    ? "text-ink-500 hover:bg-ink-100 hover:text-brand-600"
                    : "text-ink-300",
                )}
              >
                <Pipette className="size-4" />
              </button>
            </div>

            {colorHistory.length > 0 && (
              <div className="mt-3">
                <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-ink-400">
                  Recent
                </span>
                <div className="flex flex-wrap gap-1">
                  {colorHistory.map((c) => (
                    <Swatch
                      key={c}
                      color={c}
                      onClick={() => {
                        const next = parseColor(c);
                        setDraftColor(next);
                        commitDraft(next);
                      }}
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="mt-3">
              <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-ink-400">
                Palette
              </span>
              <div className="flex flex-wrap gap-1">
                {STARTER_PALETTE.map((c) => (
                  <Swatch
                    key={c}
                    color={c}
                    onClick={() => {
                      const next = parseColor(c);
                      setDraftColor(allowAlpha ? next : { ...next, a: 1 });
                      commitDraft(allowAlpha ? next : { ...next, a: 1 });
                    }}
                  />
                ))}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
