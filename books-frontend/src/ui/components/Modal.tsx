import { useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "../lib/cn";
import { useDialogFocus } from "../lib/dialogFocus";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** max-width class, e.g. "max-w-lg". */
  size?: string;
}

export function Modal({ open, onClose, title, children, footer, size = "max-w-lg" }: ModalProps) {
  const titleId = useId();
  // Focus management: initial focus inside, Tab trapped, focus restored on close.
  const panelRef = useDialogFocus<HTMLDivElement>(open);

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

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            tabIndex={-1}
            className={cn(
              "relative z-10 flex max-h-[90vh] w-full flex-col overflow-hidden rounded-3xl bg-white shadow-lifted outline-none",
              size,
            )}
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
          >
            {title ? (
              <div className="flex shrink-0 items-center justify-between border-b border-ink-100 px-5 py-4">
                <h2 id={titleId} className="font-display text-lg font-semibold text-ink-800">
                  {title}
                </h2>
                <button
                  onClick={onClose}
                  className="rounded-lg p-1 text-ink-400 transition hover:bg-ink-100 hover:text-ink-600"
                  aria-label="Close"
                >
                  <X className="size-5" />
                </button>
              </div>
            ) : (
              // Title-less dialogs still need a visible, focusable way out.
              <button
                onClick={onClose}
                className="absolute right-3 top-3 z-10 rounded-lg bg-white/80 p-1 text-ink-400 transition hover:bg-ink-100 hover:text-ink-600"
                aria-label="Close"
              >
                <X className="size-5" />
              </button>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
            {footer && (
              <div className="flex shrink-0 justify-end gap-2 border-t border-ink-100 bg-ink-50 px-5 py-3">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
