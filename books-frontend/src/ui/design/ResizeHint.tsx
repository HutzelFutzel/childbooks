/**
 * Cursor-following chip shown while resizing. Shift and Option/Alt already
 * constrain / scale-from-center on the Konva Transformer; this only names them.
 * Own state stays in this component so pointer/key updates never re-render the
 * page stage mid-drag (that fights the Transformer).
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "../lib/cn";

function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform) || /Mac OS/.test(navigator.userAgent);
}

function clampPos(x: number, y: number, width = 280, height = 40): { left: number; top: number } {
  return {
    left: Math.min(x + 16, window.innerWidth - width - 8),
    top: Math.min(y + 18, window.innerHeight - height - 8),
  };
}

export function ResizeHint({
  active,
  origin,
}: {
  active: boolean;
  origin: { x: number; y: number } | null;
}) {
  const apple = isApplePlatform();
  const [pos, setPos] = useState(origin ?? { x: 0, y: 0 });
  const [shift, setShift] = useState(false);
  const [alt, setAlt] = useState(false);

  useEffect(() => {
    if (!active) return;
    if (origin) setPos(origin);
    const onMove = (e: PointerEvent) => {
      setPos({ x: e.clientX, y: e.clientY });
      setShift(e.shiftKey);
      setAlt(e.altKey);
    };
    const onKey = (e: KeyboardEvent) => {
      setShift(e.shiftKey);
      setAlt(e.altKey);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, [active, origin]);

  if (typeof document === "undefined") return null;
  const { left, top } = clampPos(pos.x, pos.y);

  return createPortal(
    <AnimatePresence>
      {active && (
        <motion.div
          key="resize-hint"
          role="status"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 2 }}
          transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
          style={{ position: "fixed", left, top }}
          className="pointer-events-none z-100 flex items-center gap-2 rounded-lg bg-ink-900/95 px-2 py-1.5 text-[11px] text-white shadow-lifted ring-1 ring-white/10 backdrop-blur-xs"
        >
          <HintChip held={shift} keys={apple ? "⇧ Shift" : "Shift"} label="constrain" />
          <HintChip held={alt} keys={apple ? "⌥ Option" : "Alt"} label="from center" />
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function HintChip({ held, keys, label }: { held: boolean; keys: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <kbd
        className={cn(
          "rounded-md px-1.5 py-0.5 font-semibold tracking-tight ring-1",
          held ? "bg-white/20 text-white ring-white/35" : "bg-white/8 text-white/75 ring-white/10",
        )}
      >
        {keys}
      </kbd>
      <span className={held ? "text-white" : "text-white/70"}>{label}</span>
    </span>
  );
}
