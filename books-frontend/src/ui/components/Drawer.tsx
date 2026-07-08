import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "../lib/cn";
import { springSoft } from "../lib/motion";

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  /** Which edge the panel slides in from. */
  side?: "left" | "right";
  title?: string;
  children: React.ReactNode;
  /** width class for the panel, e.g. "max-w-sm". */
  widthClass?: string;
}

/**
 * A portal-based edge sheet used to surface the studio side panels on small
 * screens (where the inline `<aside>`s are hidden). Slides in from the given
 * edge over a dimmed backdrop; closes on backdrop click or Escape and locks
 * body scroll while open.
 */
export function Drawer({
  open,
  onClose,
  side = "left",
  title,
  children,
  widthClass = "max-w-[22rem]",
}: DrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  const hiddenX = side === "left" ? "-100%" : "100%";

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50">
          <motion.div
            className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            className={cn(
              "absolute inset-y-0 flex w-[88vw] flex-col bg-white shadow-lifted",
              side === "left" ? "left-0" : "right-0",
              widthClass,
            )}
            initial={{ x: hiddenX }}
            animate={{ x: 0 }}
            exit={{ x: hiddenX }}
            transition={springSoft}
          >
            <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-ink-800">{title}</h2>
              <button
                onClick={onClose}
                className="rounded-lg p-1.5 text-ink-400 transition hover:bg-ink-100 hover:text-ink-700"
                aria-label="Close"
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
