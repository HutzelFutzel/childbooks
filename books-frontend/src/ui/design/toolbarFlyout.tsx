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

export function useToolbarFlyoutPosition(
  open: boolean,
  triggerRef: RefObject<HTMLElement | null>,
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
      const r = el.getBoundingClientRect();
      const next: CSSProperties = {
        position: "fixed",
        top: r.bottom + GAP,
      };
      if (align === "end") next.right = window.innerWidth - r.right;
      else next.left = r.left;
      // Flip above when there's no room below.
      const estimatedH = 200;
      if (r.bottom + GAP + estimatedH > window.innerHeight - 8 && r.top > estimatedH) {
        delete next.top;
        next.bottom = window.innerHeight - r.top + GAP;
      }
      setStyle(next);
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, triggerRef, align]);

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
  const style = useToolbarFlyoutPosition(open, triggerRef, align);
  useToolbarFlyoutDismiss(open, onClose, triggerRef, panelRef);

  if (!open || !style || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={panelRef}
      className={cn("z-100 rounded-xl border border-ink-200 bg-white shadow-lifted", className)}
      style={style}
      onMouseDown={(e) => {
        // Keep text-box selection / caret alive, but don't block menu buttons.
        if ((e.target as HTMLElement).closest("input, button, select, textarea, a")) return;
        e.preventDefault();
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
