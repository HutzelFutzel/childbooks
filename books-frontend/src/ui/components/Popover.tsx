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
  /**
   * The clickable trigger. Either static content, or a render function that
   * receives the current open state (e.g. to rotate a chevron / swap a
   * highlight while the panel is open).
   */
  trigger: ReactNode | ((open: boolean) => ReactNode);
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
  // The side actually used, which can differ from the requested `side` once a
  // trigger near an edge of the screen is measured. Reset to the preferred
  // side each time the popover opens, so a trigger that's since scrolled into
  // room goes back to its normal side rather than staying flipped forever.
  const [effectiveSide, setEffectiveSide] = useState(side);
  // Mirrors `effectiveSide` for the scroll/resize handlers below: those are
  // registered once per open (see the effect's dependency array) and would
  // otherwise close over whatever side was current at that moment, silently
  // undoing a later flip on the next scroll event. A ref always reads current.
  const effectiveSideRef = useRef(side);
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Flip (and horizontal clamp) at most once per open — otherwise a panel that
  // doesn't fit on EITHER side (taller than the viewport) would bounce back
  // and forth chasing room that doesn't exist anywhere.
  const adjustedRef = useRef(false);
  const id = useId();

  function reposition(sideToUse: "top" | "bottom" = effectiveSideRef.current) {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // Anchor with `top`/`bottom`/`left`/`right` (never a fixed offset that
    // assumes the panel's own size) so the browser resolves the edge against
    // whatever size the panel actually renders at — no measuring needed.
    const next: CSSProperties = { position: "fixed" };
    if (sideToUse === "top") next.bottom = window.innerHeight - rect.top + GAP;
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
    adjustedRef.current = false;
    effectiveSideRef.current = side;
    setEffectiveSide(side);
    reposition(side);
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

  // After the panel has actually rendered at its real size, check whether it
  // fits where it landed and correct once: flip vertically if the preferred
  // side has no room (only when the OTHER side genuinely has more — a panel
  // taller than the viewport shouldn't flip forever), and clamp horizontally
  // so a panel near the screen edge never renders partly off-screen. This is
  // what actually keeps a help popover on an anchor near the top of the page
  // fully readable, instead of trusting the CSS-only estimate in `reposition`.
  useLayoutEffect(() => {
    if (!open || !style || adjustedRef.current) return;
    const anchorEl = anchorRef.current;
    const panelEl = panelRef.current;
    if (!anchorEl || !panelEl) return;
    const anchorRect = anchorEl.getBoundingClientRect();
    const panelRect = panelEl.getBoundingClientRect();
    const margin = 8;

    const topRoom = anchorRect.top - GAP;
    const bottomRoom = window.innerHeight - anchorRect.bottom - GAP;
    let nextSide = effectiveSide;
    if (effectiveSide === "top" && panelRect.height > topRoom && bottomRoom > topRoom) {
      nextSide = "bottom";
    } else if (effectiveSide === "bottom" && panelRect.height > bottomRoom && topRoom > bottomRoom) {
      nextSide = "top";
    }

    if (nextSide !== effectiveSide) {
      adjustedRef.current = true;
      effectiveSideRef.current = nextSide;
      setEffectiveSide(nextSide);
      reposition(nextSide);
      return;
    }

    // Horizontal position & clamp
    let idealLeft = anchorRect.left;
    if (align === "center") {
      idealLeft = anchorRect.left + anchorRect.width / 2 - panelRect.width / 2;
    } else if (align === "end") {
      idealLeft = anchorRect.right - panelRect.width;
    }
    const left = Math.max(margin, Math.min(idealLeft, window.innerWidth - panelRect.width - margin));

    adjustedRef.current = true;
    setStyle((prev) => (prev ? { ...prev, left, right: undefined, transform: undefined } : prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, style, effectiveSide]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      requestAnimationFrame(() => {
        anchorRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
      });
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !style) return;
    const frame = requestAnimationFrame(() => {
      panelRef.current
        ?.querySelector<HTMLElement>(
          "button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])",
        )
        ?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, style]);

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
        className="group inline-flex focus-visible:outline-none"
      >
        {typeof trigger === "function" ? trigger(open) : trigger}
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
                  "z-100 rounded-2xl border border-ink-200 bg-white p-3 shadow-lifted",
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
