/**
 * Portaled flyout menus for floating toolbars. Absolute children of the
 * selection bars are painted in a transformed stacking context and can end up
 * under the Konva canvas — fixed + body portal keeps them on top.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/cn";

const GAP = 4;
const MARGIN = 8;

/** Keep a flyout fully inside the viewport: prefer below, flip above, then clamp. */
export function placeViewportFlyout(opts: {
  trigger: DOMRect;
  width: number;
  height: number;
  gap?: number;
  margin?: number;
  align?: "start" | "end";
}): { left: number; top: number; maxHeight?: number } {
  const gap = opts.gap ?? GAP;
  const margin = opts.margin ?? MARGIN;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(Math.max(opts.width, 1), vw - margin * 2);
  const spaceBelow = vh - margin - (opts.trigger.bottom + gap);
  const spaceAbove = opts.trigger.top - margin - gap;
  const canFitBelow = spaceBelow >= opts.height;
  const canFitAbove = spaceAbove >= opts.height;
  const placeBelow =
    canFitBelow || (!canFitAbove && spaceBelow >= spaceAbove);

  let top: number;
  let maxHeight: number | undefined;
  if (placeBelow) {
    top = opts.trigger.bottom + gap;
    const available = vh - margin - top;
    if (opts.height > available) maxHeight = Math.max(96, available);
  } else {
    const h = Math.min(opts.height, Math.max(96, spaceAbove));
    top = opts.trigger.top - gap - h;
    if (top < margin) top = margin;
    if (opts.height > spaceAbove) maxHeight = Math.max(96, spaceAbove);
  }

  let left =
    opts.align === "end" ? opts.trigger.right - width : opts.trigger.left;
  left = Math.min(Math.max(margin, left), vw - margin - width);

  const usedH = maxHeight ?? opts.height;
  if (top + usedH > vh - margin) {
    maxHeight = Math.max(96, vh - margin - top);
  }

  return { left, top, maxHeight };
}

function flyoutStyle(
  trigger: DOMRect,
  panel: HTMLElement | null,
  align: "start" | "end",
  fallbackH: number,
): CSSProperties {
  const box = placeViewportFlyout({
    trigger,
    width: panel?.offsetWidth ?? 240,
    height: panel?.offsetHeight || fallbackH,
    align,
  });
  return {
    position: "fixed",
    left: box.left,
    top: box.top,
    ...(box.maxHeight
      ? { maxHeight: box.maxHeight, overflowY: "auto" as const }
      : {}),
  };
}

export function useToolbarFlyoutPosition(
  open: boolean,
  triggerRef: RefObject<HTMLElement | null>,
  panelRef: RefObject<HTMLElement | null>,
  align: "start" | "end" = "start",
): CSSProperties | null {
  const [style, setStyle] = useState<CSSProperties | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setStyle(null);
      return;
    }
    const place = () => {
      const el = triggerRef.current;
      if (!el) return;
      setStyle(flyoutStyle(el.getBoundingClientRect(), panelRef.current, align, 360));
    };
    place();
    const raf = requestAnimationFrame(place);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, triggerRef, panelRef, align]);

  return style;
}

/** Outside-click + Escape closer that ignores mousedown inside trigger or panel. */
export function useToolbarFlyoutDismiss(
  open: boolean,
  onClose: () => void,
  triggerRef: RefObject<HTMLElement | null>,
  panelRef: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, triggerRef, panelRef]);
}

/** Portal a flyout panel under (or above) a toolbar trigger. */
export function PortalToolbarFlyout({
  open,
  onClose,
  triggerRef,
  align = "start",
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  triggerRef: RefObject<HTMLElement | null>;
  align?: "start" | "end";
  className?: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const style = useToolbarFlyoutPosition(open, triggerRef, panelRef, align);
  useToolbarFlyoutDismiss(open, onClose, triggerRef, panelRef);

  if (!open || !style || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={panelRef}
      className={cn("z-100 rounded-xl border border-ink-200 bg-white shadow-lifted", className)}
      style={style}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => {
        e.stopPropagation();
        // Keep text-box selection / caret alive, but don't block sliders / buttons.
        if (
          (e.target as HTMLElement).closest(
            "input, button, select, textarea, a, [role='switch']",
          )
        ) {
          return;
        }
        e.preventDefault();
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
