"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { popIn } from "../lib/motion";
import { cn } from "../lib/cn";

export interface PopoverProps {
  /** The clickable trigger. Receives no props; wrap your own button/element. */
  trigger: ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: "start" | "center" | "end";
  side?: "bottom" | "top";
  /** Width class for the panel. */
  panelClassName?: string;
  /** Open on hover as well as click (still tap-friendly). */
  openOnHover?: boolean;
}

/**
 * One accessible popover primitive: handles outside-click + Escape + open state
 * so menus/help panels don't each re-implement it. Works on click (and
 * optionally hover), keyboard-dismissable, mobile-safe.
 */
export function Popover({
  trigger,
  children,
  align = "end",
  side = "bottom",
  panelClassName,
  openOnHover = false,
}: PopoverProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const alignCls =
    align === "start" ? "left-0" : align === "center" ? "left-1/2 -translate-x-1/2" : "right-0";
  const sideCls = side === "top" ? "bottom-full mb-2" : "top-full mt-2";

  return (
    <div
      className="relative inline-flex"
      ref={ref}
      onMouseEnter={openOnHover ? () => setOpen(true) : undefined}
      onMouseLeave={openOnHover ? () => setOpen(false) : undefined}
    >
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex"
      >
        {trigger}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            id={id}
            role="dialog"
            variants={popIn}
            initial="hidden"
            animate="show"
            exit="exit"
            className={cn(
              "absolute z-50 rounded-2xl border border-ink-200 bg-white p-3 shadow-lifted",
              sideCls,
              alignCls,
              panelClassName ?? "w-72",
            )}
          >
            {typeof children === "function" ? children(() => setOpen(false)) : children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
