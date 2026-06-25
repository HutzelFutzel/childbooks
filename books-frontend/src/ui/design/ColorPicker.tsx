import { useEffect, useRef, useState } from "react";
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

/** A compact swatch that opens an RGBA picker with hex + alpha + pipette. */
export function ColorField({
  label,
  value,
  onChange,
  allowAlpha = true,
}: {
  label?: string;
  value: string;
  onChange: (color: string) => void;
  allowAlpha?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const rgba = parseColor(value);
  const colorHistory = useSettingsStore((s) => s.settings.colorHistory);
  const pushColor = useSettingsStore((s) => s.pushColor);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        pushColor(value);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, value, pushColor]);

  function set(next: RGBA) {
    onChange(toRgbaString(allowAlpha ? next : { ...next, a: 1 }));
  }

  const hasEyeDropper = typeof window !== "undefined" && "EyeDropper" in window;

  async function pickFromScreen() {
    const Ctor = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;
    if (!Ctor) return;
    try {
      const res = await new Ctor().open();
      const picked = parseColor(res.sRGBHex);
      set({ ...picked, a: rgba.a });
    } catch {
      /* user cancelled */
    }
  }

  return (
    <div ref={ref} className="relative">
      {label && <span className="mb-1 block text-xs font-medium text-ink-500">{label}</span>}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-2 py-1.5 text-xs transition hover:border-brand-300"
      >
        <span
          className="size-5 rounded ring-1 ring-inset ring-black/10"
          style={{
            backgroundImage:
              "linear-gradient(45deg,#ccc 25%,transparent 25%,transparent 75%,#ccc 75%),linear-gradient(45deg,#ccc 25%,#fff 25%,#fff 75%,#ccc 75%)",
            backgroundSize: "8px 8px",
            backgroundPosition: "0 0,4px 4px",
          }}
        >
          <span className="block size-full rounded" style={{ background: value }} />
        </span>
        <span className="font-mono text-ink-600">{toHex(rgba)}</span>
      </button>

      {open && (
        <div className="absolute z-40 mt-1 w-56 rounded-xl border border-ink-200 bg-white p-3 shadow-lifted">
          <RgbaColorPicker color={rgba} onChange={(c) => set(c)} />
          <div className="mt-3 flex items-center gap-2">
            <input
              value={toHex(rgba)}
              onChange={(e) => {
                const p = parseColor(e.target.value);
                set({ ...p, a: rgba.a });
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
                  value={Math.round(rgba.a * 100)}
                  onChange={(e) => set({ ...rgba, a: Number(e.target.value) / 100 })}
                  className="w-14 rounded-md border border-ink-200 px-1.5 py-1 text-xs"
                />
              </label>
            )}
            <button
              type="button"
              title={hasEyeDropper ? "Sample a color from anywhere" : "Pipette not supported in this browser"}
              disabled={!hasEyeDropper}
              onClick={() => void pickFromScreen()}
              className={cn(
                "ml-auto rounded-md p-1.5 transition",
                hasEyeDropper ? "text-ink-500 hover:bg-ink-100 hover:text-brand-600" : "text-ink-300",
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
                  <Swatch key={c} color={c} onClick={() => onChange(c)} />
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
                <Swatch key={c} color={c} onClick={() => onChange(c)} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
