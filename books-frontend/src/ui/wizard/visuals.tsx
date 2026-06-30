import { Image as ImageIcon, Type } from "lucide-react";
import type { GraphicsDensity, LayoutTemplate, SpreadUsage } from "../../core/config/options";
import { cn } from "../lib/cn";

/**
 * Art-style sample tile. Shows the admin-uploaded example image when one exists;
 * otherwise falls back to the preset's gradient swatch.
 */
export function StyleSwatch({ swatch, imageUrl }: { swatch: string; imageUrl?: string }) {
  if (imageUrl) {
    return (
      <div className="h-24 w-full overflow-hidden rounded-xl ring-1 ring-inset ring-black/5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt="Art style example" className="size-full object-cover" />
      </div>
    );
  }
  return (
    <div
      className={cn(
        "h-24 w-full rounded-xl bg-gradient-to-br ring-1 ring-inset ring-black/5",
        swatch,
      )}
    >
      <div className="flex h-full items-end p-2">
        <span className="rounded-md bg-white/70 px-1.5 py-0.5 text-[10px] font-medium text-ink-700 backdrop-blur">
          sample
        </span>
      </div>
    </div>
  );
}

/** A page shape rendered at the given aspect ratio. */
export function BookSizeShape({ aspect }: { aspect: number }) {
  // Normalize so the larger dimension is ~64px.
  const max = 64;
  const w = aspect >= 1 ? max : Math.round(max * aspect);
  const h = aspect >= 1 ? Math.round(max / aspect) : max;
  return (
    <div className="flex h-20 items-center justify-center">
      <div
        className="rounded-md bg-brand-100 ring-2 ring-brand-300"
        style={{ width: w, height: h }}
      />
    </div>
  );
}

function Region({
  kind,
  style,
}: {
  kind: "text" | "graphic";
  style: React.CSSProperties;
}) {
  return (
    <div
      className={cn(
        "absolute flex items-center justify-center rounded-[3px]",
        kind === "graphic" ? "bg-brand-200/70 text-brand-700" : "bg-accent-100 text-accent-600",
      )}
      style={style}
    >
      {kind === "graphic" ? <ImageIcon className="size-3.5" /> : <Type className="size-3.5" />}
    </div>
  );
}

/** Schematic diagram of a layout template's regions. */
export function LayoutDiagram({ template }: { template: LayoutTemplate }) {
  if (template.id === "auto" || template.regions.length === 0) {
    return (
      <div className="flex h-20 items-center justify-center rounded-lg bg-gradient-to-br from-brand-50 to-accent-50 text-xs font-medium text-brand-600">
        Auto layout
      </div>
    );
  }
  const isSpread = template.spread;
  return (
    <div className="flex h-20 items-center justify-center gap-1 rounded-lg bg-ink-50 p-2">
      <div
        className="relative h-full rounded-md bg-white ring-1 ring-ink-200"
        style={{ width: isSpread ? "100%" : "62%" }}
      >
        {isSpread && (
          <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-ink-200" />
        )}
        {template.regions.map((r, i) => (
          <Region
            key={i}
            kind={r.kind}
            style={{
              left: `${r.x * 100}%`,
              top: `${r.y * 100}%`,
              width: `${r.w * 100}%`,
              height: `${r.h * 100}%`,
              padding: "2px",
            }}
          />
        ))}
      </div>
    </div>
  );
}

export function DensityDiagram({ density }: { density: GraphicsDensity }) {
  return (
    <div className="flex h-20 items-center justify-center gap-1.5 rounded-lg bg-ink-50 p-2">
      {density === "one-per-page" && (
        <div className="flex size-14 items-center justify-center rounded-md bg-brand-200/70 text-brand-700">
          <ImageIcon className="size-5" />
        </div>
      )}
      {density === "multiple-per-page" && (
        <div className="grid size-14 grid-cols-2 gap-1">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-sm bg-brand-200/70" />
          ))}
        </div>
      )}
      {density === "combination" && (
        <>
          <div className="flex h-14 w-8 items-center justify-center rounded-md bg-brand-200/70 text-brand-700">
            <ImageIcon className="size-4" />
          </div>
          <div className="grid h-14 w-8 grid-rows-2 gap-1">
            <div className="rounded-sm bg-brand-200/70" />
            <div className="rounded-sm bg-brand-200/70" />
          </div>
        </>
      )}
    </div>
  );
}

export function SpreadDiagram({ usage }: { usage: SpreadUsage }) {
  return (
    <div className="flex h-20 items-center justify-center gap-2 rounded-lg bg-ink-50 p-2">
      {usage === "single" && (
        <>
          <div className="h-12 w-9 rounded-md bg-brand-200/70" />
          <div className="h-12 w-9 rounded-md bg-accent-100" />
        </>
      )}
      {usage === "double" && (
        <div className="relative h-12 w-20 rounded-md bg-brand-200/70">
          <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-white/70" />
        </div>
      )}
      {usage === "mixed" && (
        <>
          <div className="h-12 w-9 rounded-md bg-brand-200/70" />
          <div className="relative h-12 w-14 rounded-md bg-accent-200/70">
            <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-white/70" />
          </div>
        </>
      )}
    </div>
  );
}
