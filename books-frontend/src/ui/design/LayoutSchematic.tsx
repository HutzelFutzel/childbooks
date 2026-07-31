/**
 * Schematic of a layout, drawn from the layout's own plan.
 *
 * Deliberately not hand-authored: a diagram maintained separately from the
 * geometry is a diagram that eventually lies about it. Every rectangle here is
 * the same `ResolvedSlot.pageRect` the editor seeds text into and the prompt is
 * compiled from, so the picture is correct by construction — including the way
 * it flips between left- and right-hand pages and shifts with the gutter.
 */
import { Image as ImageIcon, Type } from "lucide-react";
import type { BookLayout, CompositionMode, PageSide } from "../../core/book/layouts";
import { computePageGuides, resolveFormatCapabilities } from "../../core/book/format";
import { bindingSideFor } from "../../core/book/pageLayout";
import type { BookProduct } from "../../core/fulfillment/types";
import { cn } from "../lib/cn";

function pct(v: number): string {
  return `${v * 100}%`;
}

/**
 * One page of the schematic. `product` supplies the real trim so the safe-area
 * inset is to scale — a half-inch margin looks very different on a 7″ square
 * than on an 11″ page, and that difference is the point.
 */
function SchematicPage({
  layout,
  product,
  side,
  mode,
  showSafeArea,
}: {
  layout: BookLayout;
  product: BookProduct;
  side: PageSide;
  mode: CompositionMode;
  showSafeArea?: boolean;
}) {
  const caps = resolveFormatCapabilities(product, product.minPages);
  const spread = side === "spread";
  const { safe } = computePageGuides({ caps, spread, bindingSide: bindingSideFor(side) });
  const plan = layout.plan({
    side,
    safe,
    aspect: spread ? product.aspect * 2 : product.aspect,
    trim: product.trim,
    isCover: false,
    mode,
  });

  const surfaceAspect = spread ? product.aspect * 2 : product.aspect;
  const insetArt = plan.mode === "inset-art";

  return (
    <div
      className="relative overflow-hidden rounded-md bg-white ring-1 ring-ink-200"
      style={{ aspectRatio: String(surfaceAspect), height: "100%" }}
    >
      {/* Artwork: the whole page, or just the art rectangle when inset. */}
      <div
        className="absolute flex items-center justify-center bg-brand-200/70 text-brand-700"
        style={{
          left: pct(plan.artRect.x),
          top: pct(plan.artRect.y),
          width: pct(plan.artRect.w),
          height: pct(plan.artRect.h),
        }}
      >
        <ImageIcon className="size-3.5" />
      </div>

      {/* Full-bleed layouts keep the text band calm rather than empty, so it's
          drawn as a translucent wash over the art instead of a solid block. */}
      {plan.slots
        .filter((s) => s.role === "text")
        .map((slot) => (
          <div
            key={slot.id}
            className={cn(
              "absolute flex items-center justify-center rounded-[3px]",
              insetArt ? "bg-accent-100 text-accent-600" : "bg-white/75 text-accent-600",
            )}
            style={{
              left: pct(slot.pageRect.x),
              top: pct(slot.pageRect.y),
              width: pct(slot.pageRect.w),
              height: pct(slot.pageRect.h),
            }}
          >
            <Type className="size-3.5" />
          </div>
        ))}

      {showSafeArea && (
        <div
          className="pointer-events-none absolute border border-dashed border-brand-400/60"
          style={{ left: pct(safe.x), top: pct(safe.y), width: pct(safe.w), height: pct(safe.h) }}
        />
      )}
      {spread && (
        <div className="pointer-events-none absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-ink-300/60" />
      )}
    </div>
  );
}

/**
 * A facing pair (verso + recto) showing how the layout alternates across the
 * gutter — the thing a static single-page diagram can't communicate.
 */
export function LayoutSchematic({
  layout,
  product,
  mode,
  sides = ["left", "right"],
  showSafeArea,
  className,
}: {
  layout: BookLayout;
  product: BookProduct;
  mode: CompositionMode;
  sides?: PageSide[];
  showSafeArea?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex h-20 items-center justify-center gap-0.5 rounded-lg bg-ink-50 p-2", className)}>
      {sides.map((side) => (
        <SchematicPage
          key={side}
          layout={layout}
          product={product}
          side={side}
          mode={mode}
          showSafeArea={showSafeArea}
        />
      ))}
    </div>
  );
}
