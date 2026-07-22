import { useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "../lib/cn";
import { springSoft } from "../lib/motion";
import { useDialogFocus } from "../lib/dialogFocus";

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  /** Which edge the panel slides in from. `bottom` renders as a bottom sheet. */
  side?: "left" | "right" | "bottom";
  title?: string;
  children: React.ReactNode;
  /** width class for the panel, e.g. "max-w-sm" (left/right sides only). */
  widthClass?: string;
}

/**
 * A portal-based edge sheet used to surface the studio side panels on small
 * screens (where the inline `<aside>`s are hidden). Slides in from the given
 * edge over a dimmed backdrop; closes on backdrop click or Escape and locks
 * body scroll while open. `side="bottom"` is the mobile-native bottom sheet:
 * full-width, capped height, with a grab handle.
 */
export function Drawer({
  open,
  onClose,
  side = "left",
  title,
  children,
  widthClass = "max-w-[22rem]",
}: DrawerProps) {
  const titleId = useId();
  // Focus management: initial focus inside, Tab trapped, focus restored on close.
  const panelRef = useDialogFocus<HTMLElement>(open);

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

  const bottom = side === "bottom";
  const hidden = bottom ? { y: "100%" } : { x: side === "left" ? "-100%" : "100%" };
  const visible = bottom ? { y: 0 } : { x: 0 };

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
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            tabIndex={-1}
            className={cn(
              "absolute flex flex-col bg-white shadow-lifted outline-none",
              bottom
                ? "inset-x-0 bottom-0 max-h-[82dvh] rounded-t-3xl pb-[env(safe-area-inset-bottom)]"
                : cn(
                    "inset-y-0 w-[88vw]",
                    side === "left" ? "left-0 rounded-r-3xl" : "right-0 rounded-l-3xl",
                    widthClass,
                  ),
            )}
            initial={hidden}
            animate={visible}
            exit={hidden}
            transition={springSoft}
          >
            {bottom && (
              <div className="flex justify-center pt-2.5">
                <span className="h-1 w-10 rounded-full bg-ink-200" aria-hidden />
              </div>
            )}
            <div
              className={cn(
                "flex items-center justify-between px-4 py-3",
                bottom ? "pb-2 pt-1.5" : "border-b border-ink-100",
              )}
            >
              <h2 id={titleId} className="text-sm font-semibold text-ink-800">
                {title}
              </h2>
              <button
                onClick={onClose}
                className="rounded-lg p-1.5 text-ink-400 transition hover:bg-ink-100 hover:text-ink-700"
                aria-label="Close"
              >
                <X className="size-5" />
              </button>
            </div>
            <div className={cn("min-h-0 flex-1 overflow-y-auto", bottom && "border-t border-ink-100")}>
              {children}
            </div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
