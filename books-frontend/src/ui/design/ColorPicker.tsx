import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { RgbColorPicker } from "react-colorful";
import { Pipette, Type } from "lucide-react";
import { useSettingsStore } from "../../state/settingsStore";
import { parseColor, toHex, toRgbaString, type RGBA } from "./color";
import { cn } from "../lib/cn";
import { ToolbarSlider } from "./toolbarSlider";
import { placeViewportFlyout } from "./toolbarFlyout";

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
  live = compact,
  look = "swatch",
  footer,
  onOpenChange,
}: {
  label?: string;
  value: string;
  onChange: (color: string) => void;
  allowAlpha?: boolean;
  /** Swatch-only trigger for dense floating toolbars. */
  compact?: boolean;
  /**
   * Push color to the parent while dragging (toolbar). Inspector pickers
   * stay commit-on-close so a dock click doesn't flood undo.
   */
  live?: boolean;
  /** Compact trigger: letter underline, solid fill, or hollow outline. */
  look?: "swatch" | "glyph" | "stroke";
  /** Extra controls (outline weight) inside the popover. */
  footer?: ReactNode;
  /** Fires when the popover opens or closes (close = end a coalesced undo). */
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<RGBA>(() => parseColor(value));
  const [menuPos, setMenuPos] = useState<{
    left: number;
    top: number;
    maxHeight?: number;
  } | null>(null);
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
  const liveRef = useRef(live);
  liveRef.current = live;
  /** Color when the popover opened — Escape restores this in live mode. */
  const openValueRef = useRef(value);
  /** When true, the open-effect cleanup must not persist the draft (Escape). */
  const discardOnCloseRef = useRef(false);
  const hasFooter = footer != null;

  const emit = (next: RGBA, history: boolean) => {
    const css = toRgbaString(allowAlphaRef.current ? next : { ...next, a: 1 });
    if (colorsEqual(css, valueRef.current)) return;
    onChangeRef.current(css);
    if (history) pushColorRef.current(css);
  };

  const commitDraft = (next: RGBA) => emit(next, true);

  const close = (commit: boolean) => {
    discardOnCloseRef.current = !commit;
    if (commit) {
      const next = draftRef.current;
      if (liveRef.current) {
        emit(next, false);
        const css = toRgbaString(allowAlphaRef.current ? next : { ...next, a: 1 });
        if (!colorsEqual(css, openValueRef.current)) pushColorRef.current(css);
      } else {
        commitDraft(next);
      }
    } else if (liveRef.current) {
      onChangeRef.current(openValueRef.current);
    }
    setOpen(false);
    setMenuPos(null);
    onOpenChange?.(false);
  };

  // Keep the closed swatch in sync with external value.
  useEffect(() => {
    if (!open) setDraft(parseColor(value));
  }, [value, open]);

  useLayoutEffect(() => {
    if (!open) return;
    openValueRef.current = valueRef.current;
    setDraft(parseColor(valueRef.current));
    const place = () => {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const panel = menuRef.current;
      const box = placeViewportFlyout({
        trigger: r,
        width: panel?.offsetWidth ?? 224,
        height: panel?.offsetHeight || 420,
      });
      setMenuPos({ left: box.left, top: box.top, maxHeight: box.maxHeight });
    };
    place();
    const raf = requestAnimationFrame(place);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, hasFooter, allowAlpha, compact, label]);

  useEffect(() => {
    if (!open) return;
    discardOnCloseRef.current = false;
    const onDoc = (e: Event) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      if (t instanceof Element && t.closest("[data-color-picker-popover]")) return;
      close(true);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false);
    };
    document.addEventListener("pointerdown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDoc);
      document.removeEventListener("keydown", onKey);
      // Unmount while open (panel swap / deselect): keep the draft unless Escape.
      if (discardOnCloseRef.current) {
        if (liveRef.current) onChangeRef.current(openValueRef.current);
        return;
      }
      const next = draftRef.current;
      if (liveRef.current) {
        emit(next, false);
        const css = toRgbaString(allowAlphaRef.current ? next : { ...next, a: 1 });
        if (!colorsEqual(css, openValueRef.current)) pushColorRef.current(css);
      } else {
        commitDraft(next);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open session; commit via refs
  }, [open]);

  function setDraftColor(next: RGBA, opts?: { preserveAlpha?: boolean }) {
    let resolved = allowAlphaRef.current ? next : { ...next, a: 1 };
    // Transparent fill starts at a=0 — dragging hue would stay invisible unless
    // we raise alpha. Explicit opacity/palette transparent keeps a=0.
    if (
      allowAlphaRef.current &&
      !opts?.preserveAlpha &&
      resolved.a < 0.01
    ) {
      resolved = { ...resolved, a: 1 };
    }
    setDraft(resolved);
    if (liveRef.current) emit(resolved, false);
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
        onClick={() => {
          if (open) {
            close(true);
            return;
          }
          setOpen(true);
          onOpenChange?.(true);
        }}
        title={label ?? "Choose color"}
        aria-label={label ?? "Choose color"}
        className={cn(
          "flex items-center rounded-lg border border-ink-200 bg-white text-xs transition hover:border-brand-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400",
          compact ? "size-7 justify-center p-0" : "gap-2 px-2 py-1.5",
        )}
      >
        {compact && look === "glyph" ? (
          <span className="flex flex-col items-center gap-px">
            <Type className="size-3.5 text-ink-700" strokeWidth={2.25} />
            <span
              className="h-[3px] w-3.5 rounded-full ring-1 ring-inset ring-black/10"
              style={{ background: display }}
            />
          </span>
        ) : compact && look === "stroke" ? (
          <span
            className="size-4 rounded-[3px]"
            style={{
              backgroundImage:
                "linear-gradient(45deg,#ccc 25%,transparent 25%,transparent 75%,#ccc 75%),linear-gradient(45deg,#ccc 25%,#fff 25%,#fff 75%,#ccc 75%)",
              backgroundSize: "6px 6px",
              backgroundPosition: "0 0,3px 3px",
              boxShadow: `inset 0 0 0 2.5px ${display}`,
            }}
          />
        ) : (
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
        )}
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
            style={{
              left: menuPos.left,
              top: menuPos.top,
              ...(menuPos.maxHeight
                ? { maxHeight: menuPos.maxHeight, overflowY: "auto" }
                : {}),
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {label && (
              <p className="mb-2 text-[11px] font-medium text-ink-600">{label}</p>
            )}
            <RgbColorPicker
              color={{ r: draft.r, g: draft.g, b: draft.b }}
              onChange={(c) =>
                setDraftColor({ ...c, a: draft.a < 0.01 ? 1 : draft.a })
              }
            />
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
            {allowAlpha && (
              <div className="mt-3">
                <ToolbarSlider
                  label="Opacity"
                  min={0}
                  max={1}
                  step={0.01}
                  value={draft.a}
                  format={(v) => `${Math.round(v * 100)}`}
                  onChange={(a) => setDraftColor({ ...draft, a }, { preserveAlpha: true })}
                />
              </div>
            )}

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
                        setDraftColor(next, { preserveAlpha: true });
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
                        const resolved = allowAlpha ? next : { ...next, a: 1 };
                        setDraftColor(resolved, { preserveAlpha: true });
                        commitDraft(resolved);
                      }}
                    />
                ))}
              </div>
            </div>
            {footer && (
              <div className="mt-3 border-t border-ink-100 pt-3">{footer}</div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
