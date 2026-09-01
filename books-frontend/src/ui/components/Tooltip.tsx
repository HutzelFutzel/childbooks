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
import { cn } from "../lib/cn";

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom";
  align?: "start" | "center" | "end";
  className?: string;
  panelClassName?: string;
  delayMs?: number;
  disabled?: boolean;
}

const GAP = 8;
const HOVER_CLOSE_DELAY_MS = 80;

/**
 * High-performance, portal-rendered tooltip primitive.
 * Rendered through a portal into `document.body` with fixed positioning,
 * ensuring it is never clipped by `overflow-hidden` / scrollable containers.
 * Auto-detects viewport collisions and clamps within bounds.
 */
export function Tooltip({
  content,
  children,
  side = "top",
  align = "center",
  className,
  panelClassName,
  delayMs = 60,
  disabled = false,
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties | null>(null);
  const [effectiveSide, setEffectiveSide] = useState(side);
  const effectiveSideRef = useRef(side);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();

  const computeLayout = (sideToUse: "top" | "bottom" = effectiveSideRef.current) => {
    const anchorEl = anchorRef.current;
    if (!anchorEl) return;
    const anchorRect = anchorEl.getBoundingClientRect();
    const panelEl = panelRef.current;
    const panelRect = panelEl?.getBoundingClientRect();
    const panelWidth = panelRect?.width ?? 224;
    const panelHeight = panelRect?.height ?? 60;
    const margin = 10;

    // Check vertical room
    const topRoom = anchorRect.top - GAP;
    const bottomRoom = window.innerHeight - anchorRect.bottom - GAP;
    let actualSide = sideToUse;
    if (sideToUse === "top" && panelHeight > topRoom && bottomRoom > topRoom) {
      actualSide = "bottom";
    } else if (sideToUse === "bottom" && panelHeight > bottomRoom && topRoom > bottomRoom) {
      actualSide = "top";
    }

    if (actualSide !== effectiveSideRef.current) {
      effectiveSideRef.current = actualSide;
      setEffectiveSide(actualSide);
    }

    // Horizontal position calculation
    let idealLeft = anchorRect.left;
    if (align === "center") {
      idealLeft = anchorRect.left + anchorRect.width / 2 - panelWidth / 2;
    } else if (align === "end") {
      idealLeft = anchorRect.right - panelWidth;
    }

    // Clamp horizontally to stay inside viewport
    const left = Math.max(margin, Math.min(idealLeft, window.innerWidth - panelWidth - margin));

    const next: CSSProperties = { position: "fixed", left };
    if (actualSide === "top") {
      next.bottom = window.innerHeight - anchorRect.top + GAP;
    } else {
      next.top = anchorRect.bottom + GAP;
    }

    setStyle(next);
  };

  useLayoutEffect(() => {
    if (!open) return;
    effectiveSideRef.current = side;
    setEffectiveSide(side);
    computeLayout(side);

    const onScroll = () => computeLayout(effectiveSideRef.current);
    const onResize = () => computeLayout(effectiveSideRef.current);
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, side, align]);

  useLayoutEffect(() => {
    if (!open) return;
    computeLayout(effectiveSideRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, content]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => () => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  function handleMouseEnter() {
    if (disabled || !content) return;
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    if (delayMs > 0) {
      openTimer.current = setTimeout(() => setOpen(true), delayMs);
    } else {
      setOpen(true);
    }
  }

  function handleMouseLeave() {
    if (openTimer.current) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    closeTimer.current = setTimeout(() => setOpen(false), HOVER_CLOSE_DELAY_MS);
  }

  if (disabled || !content) {
    return <>{children}</>;
  }

  return (
    <span
      ref={anchorRef}
      className={cn("relative inline-flex", className)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleMouseEnter}
      onBlur={handleMouseLeave}
    >
      {children}
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {open && style && (
              <motion.div
                id={id}
                role="tooltip"
                ref={panelRef}
                initial={{ opacity: 0, scale: 0.96, y: effectiveSide === "top" ? 4 : -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97, y: effectiveSide === "top" ? 2 : -2 }}
                transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
                style={style}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                className={cn(
                  "pointer-events-none z-100 max-w-xs rounded-xl bg-ink-900/95 px-3 py-2 text-xs text-white shadow-lifted ring-1 ring-white/10 backdrop-blur-xs",
                  panelClassName,
                )}
              >
                {content}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </span>
  );
}
