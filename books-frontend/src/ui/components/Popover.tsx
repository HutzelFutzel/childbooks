"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
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

/** Gap between the trigger and the panel, matching the old mb-2 / mt-2 (0.5rem). */
const GAP = 8;
/** Grace period so moving the cursor from trigger to panel (on hover mode)
 * doesn't briefly cross a gap and close the thing you're trying to read. */
const HOVER_CLOSE_DELAY_MS = 100;

/**
 * One accessible popover primitive: handles outside-click + Escape + open state
 * so menus/help panels don't each re-implement it. Works on click (and
 * optionally hover), keyboard-dismissable, mobile-safe.
 *
 * The panel is rendered through a portal into `document.body` and positioned
 * with `position: fixed` from the trigger's live bounding rect, instead of
 * living as a plain `absolute` child of the trigger. That matters because an
 * `absolute` panel is clipped by the nearest `overflow-hidden`/`overflow-auto`
 * ancestor (e.g. a collapsible section or a scrolling card) — a portal has no
 * such ancestor, so the panel can never be cut off by unrelated layout.
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
  const [style, setStyle] = useState<CSSProperties | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();

  function reposition() {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // Anchor with `top`/`bottom`/`left`/`right` (never a fixed offset that
    // assumes the panel's own size) so the browser resolves the edge against
    // whatever size the panel actually renders at — no measuring needed.
    const next: CSSProperties = { position: "fixed" };
    if (side === "top") next.bottom = window.innerHeight - rect.top + GAP;
    else next.top = rect.bottom + GAP;
    if (align === "start") next.left = rect.left;
    else if (align === "center") {
      next.left = rect.left + rect.width / 2;
      next.transform = "translateX(-50%)";
    } else next.right = window.innerWidth - rect.right;
    setStyle(next);
  }

  useLayoutEffect(() => {
    if (!open) return;
    reposition();
    const onScroll = () => reposition();
    const onResize = () => reposition();
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, side, align]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  function hoverEnter() {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setOpen(true);
  }

  function hoverLeave() {
    closeTimer.current = setTimeout(() => setOpen(false), HOVER_CLOSE_DELAY_MS);
  }

  const alignCls =
    align === "start" ? "text-left" : align === "center" ? "text-center" : "text-left";

  return (
    <div
      className="relative inline-flex"
      ref={anchorRef}
      onMouseEnter={openOnHover ? hoverEnter : undefined}
      onMouseLeave={openOnHover ? hoverLeave : undefined}
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
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {open && style && (
              <motion.div
                id={id}
                role="dialog"
                ref={panelRef}
                variants={popIn}
                initial="hidden"
                animate="show"
                exit="exit"
                style={style}
                onMouseEnter={openOnHover ? hoverEnter : undefined}
                onMouseLeave={openOnHover ? hoverLeave : undefined}
                className={cn(
                  "z-50 rounded-2xl border border-ink-200 bg-white p-3 shadow-lifted",
                  alignCls,
                  panelClassName ?? "w-72",
                )}
              >
                {typeof children === "function" ? children(() => setOpen(false)) : children}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </div>
  );
}
