import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { printGuideTooltip, type PrintGuideKind } from "./printGuideHover";

/**
 * Cursor-following tip for print guides. Visuals stay on the Konva layer so
 * clicks still reach the page; this only explains the hovered guide.
 */
export function PrintGuideTooltip({
  kind,
  x,
  y,
}: {
  kind: PrintGuideKind | null;
  x: number;
  y: number;
}) {
  const copy = kind ? printGuideTooltip(kind) : null;
  if (typeof document === "undefined") return null;

  const left = Math.min(x + 14, window.innerWidth - 260);
  const top = Math.min(y + 16, window.innerHeight - 88);

  return createPortal(
    <AnimatePresence>
      {copy && (
        <motion.div
          key={kind}
          role="tooltip"
          initial={{ opacity: 0, scale: 0.96, y: 4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: 2 }}
          transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
          style={{ position: "fixed", left, top }}
          className="pointer-events-none z-100 max-w-xs rounded-xl bg-ink-900/95 px-3 py-2 text-xs text-white shadow-lifted ring-1 ring-white/10 backdrop-blur-xs"
        >
          <p className="font-semibold tracking-tight">{copy.title}</p>
          <p className="mt-0.5 leading-snug text-white/80">{copy.body}</p>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
