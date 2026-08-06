/**
 * Viewport-clamped portal host for Canva-style selection toolbars.
 * Re-measures the bar after layout so wide toolbars near screen edges stay on-screen.
 */
import {
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  floatingBarPortalProps,
  type FloatingBarPlacement,
} from "./floatingBarPlacement";

const MARGIN = 8;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function FloatingBarPortal({
  placement,
  children,
  className,
  style,
  ...rest
}: {
  placement: FloatingBarPlacement;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, "children">) {
  const ref = useRef<HTMLDivElement>(null);
  const [x, setX] = useState(placement.x);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = () => {
      const width = el.getBoundingClientRect().width;
      const vw = window.innerWidth;
      const half = width > 0 ? width / 2 : 200;
      const min = MARGIN + half;
      const max = vw - MARGIN - half;
      const next = min <= max ? clamp(placement.x, min, max) : vw / 2;
      setX((prev) => (Math.abs(prev - next) < 0.5 ? prev : next));
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [placement.x, placement.y, placement.side, placement.gap]);

  const portal = floatingBarPortalProps({ ...placement, x });

  return createPortal(
    <div
      ref={ref}
      {...rest}
      className={className ? `${portal.className} ${className}` : portal.className}
      style={{ ...portal.style, ...style }}
    >
      {children}
    </div>,
    document.body,
  );
}
