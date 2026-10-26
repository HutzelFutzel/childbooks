"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BookOpen, Check, Images, Maximize2 } from "lucide-react";
import type { CatalogPhoto } from "../../core/config/catalogMedia";
import { cn } from "../lib/cn";
import { spring, springSoft } from "../lib/motion";
import { EASE_OUT } from "./CheckoutKit";

/**
 * What a material looks like when nobody has uploaded a photograph of it.
 *
 * `cloth` and `foil` are drawn from the option's swatch colour; `gloss` and
 * `matte` are drawn in the brand colour. They stand in for a missing picture so
 * a row of options never has one blank hole in it — and they are only ever the
 * fallback: an uploaded photo always wins.
 */
export type SwatchKind = "cloth" | "foil" | "gloss" | "matte" | "plain";

function isLight(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150;
}

function Swatch({ color, kind, label }: { color?: string; kind: SwatchKind; label: string }) {
  if (kind === "cloth" && color) {
    return (
      <span aria-hidden className="absolute inset-0 block" style={{ backgroundColor: color }}>
        <span
          className="absolute inset-0"
          style={{
            backgroundImage: [
              "radial-gradient(120% 90% at 28% 18%, rgba(255,255,255,0.22), transparent 58%)",
              "repeating-linear-gradient(0deg, rgba(255,255,255,0.075) 0 1px, transparent 1px 3px)",
              "repeating-linear-gradient(90deg, rgba(0,0,0,0.14) 0 1px, transparent 1px 3px)",
            ].join(", "),
          }}
        />
        <span className="absolute inset-0 shadow-[inset_0_0_22px_rgba(0,0,0,0.35)]" />
      </span>
    );
  }

  if (kind === "foil" && color) {
    // A stamp reads against the cloth it would sit on: light foil on dark
    // cloth, dark foil on light. A black "Aa" on a dark tile is just a dark tile.
    const onDark = isLight(color);
    return (
      <span
        aria-hidden
        className="absolute inset-0 flex items-center justify-center"
        style={{
          background: onDark
            ? "linear-gradient(160deg, #2b3350, #161a2e)"
            : "linear-gradient(160deg, #e6d6b4, #c4ae80)",
        }}
      >
        <span
          className="font-display text-[length:clamp(1.25rem,38cqw,2.25rem)] font-bold leading-none tracking-tight"
          style={{
            backgroundImage: `linear-gradient(135deg, color-mix(in srgb, ${color} 45%, white) 0%, ${color} 42%, color-mix(in srgb, ${color} 62%, black) 100%)`,
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
            filter: "drop-shadow(0 1px 0 rgba(0,0,0,0.35))",
          }}
        >
          Aa
        </span>
      </span>
    );
  }

  if (kind === "gloss" || kind === "matte") {
    return (
      <span
        aria-hidden
        className="absolute inset-0 block"
        style={{
          backgroundImage:
            "linear-gradient(155deg, color-mix(in srgb, var(--color-brand-400) 80%, white), var(--color-brand-600))",
        }}
      >
        {kind === "gloss" ? (
          <>
            <span
              className="absolute inset-0"
              style={{
                backgroundImage:
                  "linear-gradient(115deg, rgba(255,255,255,0.65) 0%, rgba(255,255,255,0.12) 34%, transparent 36%, transparent 100%)",
              }}
            />
            <span className="absolute inset-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]" />
          </>
        ) : (
          <span
            className="absolute inset-0"
            style={{
              backgroundImage:
                "radial-gradient(90% 70% at 50% 0%, rgba(255,255,255,0.14), transparent 70%), repeating-linear-gradient(45deg, rgba(0,0,0,0.035) 0 1px, transparent 1px 2px)",
            }}
          />
        )}
      </span>
    );
  }

  return (
    <span
      aria-hidden
      className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-linear-to-br from-ink-50 to-ink-100 px-2 text-center text-ink-300"
    >
      <BookOpen className="size-5" />
      <span className="line-clamp-2 text-[10px] font-medium uppercase tracking-wide text-ink-400">{label}</span>
    </span>
  );
}

/**
 * One option's picture, filling whatever box it is placed in.
 *
 * Handles the three things an uploaded photograph does that a swatch doesn't:
 * it takes time to arrive (a pulsing placeholder, then a fade-in rather than a
 * pop), it can fail (the swatch drawn for the option takes over rather than a
 * broken-image icon), and it can be any shape (always `cover`; the lightbox is
 * where the whole picture is shown uncropped).
 */
export function OptionVisual({
  photo,
  swatch,
  kind = "plain",
  label,
  className,
}: {
  photo?: CatalogPhoto;
  swatch?: string;
  kind?: SwatchKind;
  label: string;
  className?: string;
}) {
  const url = photo?.imageUrl;
  const [failed, setFailed] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const showPhoto = Boolean(url) && failed !== url;

  // A cached image can finish before React attaches onLoad.
  useEffect(() => {
    const el = imgRef.current;
    if (el && url && el.complete && el.naturalWidth > 0) setLoaded(url);
  }, [url]);

  return (
    <span className={cn("@container absolute inset-0 block overflow-hidden", className)}>
      {showPhoto ? (
        <>
          {loaded !== url && <span aria-hidden className="absolute inset-0 animate-pulse bg-ink-100" />}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imgRef}
            key={url}
            src={url}
            alt={photo?.alt || label}
            loading="lazy"
            decoding="async"
            draggable={false}
            onLoad={() => setLoaded(url ?? null)}
            onError={() => setFailed(url ?? null)}
            className={cn(
              "absolute inset-0 size-full object-cover transition duration-500 ease-out motion-reduce:transition-none",
              loaded === url
                ? "scale-100 opacity-100 group-hover/tile:scale-[1.05]"
                : "scale-[1.06] opacity-0",
            )}
          />
        </>
      ) : (
        <Swatch color={swatch} kind={kind} label={label} />
      )}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_1px_rgba(20,22,58,0.08)]"
      />
    </span>
  );
}

export interface OptionTileProps {
  label: string;
  /** Why you'd pick it. Left off compact tiles; the detail line carries it. */
  description?: string;
  /** The price difference, already formatted. */
  delta?: string | null;
  selected: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onSelect: () => void;
  /** Every active photo of this option; the first one is the tile's picture. */
  photos: readonly CatalogPhoto[];
  swatch?: string;
  kind?: SwatchKind;
  /** Draw a picture area at all. False for a group where nothing has one. */
  showVisual: boolean;
  /** `card` is a wide 4:3 picture over the text; `chip` a square one, for long rows. */
  layout?: "card" | "chip";
  onOpenPhotos?: () => void;
  /** Extra small print under the description. */
  note?: ReactNode;
}

/**
 * A selectable option in a picker, picture first.
 *
 * Two controls overlap the picture and neither is nested in the other: the tile
 * itself (one button over the text, plus a transparent one over the picture so
 * clicking the picture also chooses) and a separate "see photos" button.
 */
export function OptionTile({
  label,
  description,
  delta,
  selected,
  disabled = false,
  disabledReason,
  onSelect,
  photos,
  swatch,
  kind,
  showVisual,
  layout = "card",
  onOpenPhotos,
  note,
}: OptionTileProps) {
  const chip = layout === "chip";
  const photo = photos[0];
  const blocked = disabled && !selected;

  const check = (
    <AnimatePresence initial={false}>
      {selected && (
        <motion.span
          key="check"
          initial={{ scale: 0, rotate: -40, opacity: 0 }}
          animate={{ scale: 1, rotate: 0, opacity: 1 }}
          exit={{ scale: 0, opacity: 0, transition: { duration: 0.12 } }}
          transition={spring}
          className="pointer-events-none flex size-5 items-center justify-center rounded-full bg-brand-500 text-white shadow-md ring-2 ring-white"
        >
          <Check className="size-3" strokeWidth={3.5} />
        </motion.span>
      )}
    </AnimatePresence>
  );

  return (
    <div
      className={cn(
        "group/tile relative rounded-2xl bg-white ring-1 ring-inset transition duration-200 motion-reduce:transition-none",
        "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-400",
        selected
          ? "bg-brand-50/60 ring-transparent"
          : blocked
            ? "bg-ink-50 opacity-60 ring-ink-100"
            : "ring-ink-200 hover:-translate-y-0.5 hover:shadow-soft hover:ring-ink-300",
      )}
    >
      {/* The sliding highlight: one element that travels to whichever tile is
          chosen, rather than each tile fading its own border. */}
      {selected && (
        <motion.span
          layoutId="option-selection"
          aria-hidden
          transition={springSoft}
          className="pointer-events-none absolute inset-0 z-[5]"
          style={{
            borderRadius: 16,
            boxShadow:
              "0 0 0 2px var(--color-brand-500), 0 10px 28px -12px color-mix(in srgb, var(--color-brand-600) 55%, transparent)",
          }}
        />
      )}

      {showVisual && (
        <div className="relative p-1.5 pb-0">
          <div
            className={cn(
              "relative w-full overflow-hidden rounded-xl bg-ink-100",
              chip ? "aspect-square" : "aspect-[3/2]",
            )}
          >
            <OptionVisual
              photo={photo}
              swatch={swatch}
              kind={kind}
              label={label}
              className={cn("transition duration-300", blocked && "opacity-60 grayscale")}
            />
            <button
              type="button"
              tabIndex={-1}
              aria-hidden
              disabled={blocked}
              onClick={onSelect}
              className="absolute inset-0 z-[1] cursor-pointer disabled:cursor-not-allowed"
            />
            <span className="pointer-events-none absolute right-1.5 top-1.5 z-[2]">{check}</span>
            {onOpenPhotos && photos.length > 0 && (
              <button
                type="button"
                onClick={onOpenPhotos}
                aria-label={
                  photos.length > 1 ? `View ${photos.length} photos of ${label}` : `View photo of ${label}`
                }
                className={cn(
                  "absolute bottom-1.5 right-1.5 z-[6] inline-flex items-center gap-1 rounded-full bg-white/90 text-[10px] font-semibold text-ink-700 shadow-sm ring-1 ring-ink-900/10 backdrop-blur transition",
                  "hover:bg-white hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400",
                  chip ? "size-6 justify-center" : "h-6 px-2",
                )}
              >
                {photos.length > 1 ? <Images className="size-3" /> : <Maximize2 className="size-3" />}
                {!chip && photos.length > 1 && <span className="tabular-nums">{photos.length}</span>}
              </button>
            )}
          </div>
        </div>
      )}

      <button
        type="button"
        disabled={blocked}
        onClick={onSelect}
        aria-pressed={selected}
        className={cn(
          "relative z-[1] flex w-full flex-col text-left focus:outline-none disabled:cursor-not-allowed",
          chip ? "gap-0.5 px-2 pb-2 pt-1.5" : "gap-0.5 px-3 pb-2.5 pt-2",
          !showVisual && "pt-2.5",
        )}
      >
        <span className="flex items-center justify-between gap-2">
          <span className={cn("font-medium text-ink-800", chip ? "truncate text-[11px]" : "text-[13px]")}>
            {label}
          </span>
          {!showVisual && <span className="shrink-0">{check}</span>}
          {delta && !blocked && !chip && (
            <span className="shrink-0 text-[11px] font-medium tabular-nums text-ink-500">{delta}</span>
          )}
        </span>
        {chip && delta && !blocked && (
          <span className="text-[10px] font-medium tabular-nums text-ink-500">{delta}</span>
        )}
        {description && !chip && (
          <span className="text-[11px] leading-snug text-ink-500">{description}</span>
        )}
        {blocked && (
          <span className="text-[10px] leading-snug text-ink-500">
            {disabledReason ?? "Not available with the current selection"}
          </span>
        )}
        {note}
      </button>
    </div>
  );
}

/**
 * The selected option, spelled out under a row of compact tiles — where the
 * longer description, and the way into the photographs, live for pickers too
 * dense to print a paragraph on every tile.
 */
export function OptionDetail({
  id,
  label,
  description,
  photos,
  swatch,
  kind,
  onOpenPhotos,
}: {
  id: string;
  label: string;
  description?: string;
  photos: readonly CatalogPhoto[];
  swatch?: string;
  kind?: SwatchKind;
  onOpenPhotos?: () => void;
}) {
  return (
    <div className="relative min-h-[4.25rem] overflow-hidden rounded-2xl bg-ink-50/80 ring-1 ring-inset ring-ink-100">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={id}
          initial={{ opacity: 0, x: 14 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -14 }}
          transition={{ duration: 0.22, ease: EASE_OUT }}
          className="flex items-center gap-3 p-2.5"
        >
          {onOpenPhotos && photos.length > 0 ? (
            <button
              type="button"
              onClick={onOpenPhotos}
              aria-label={`View photos of ${label}`}
              className="group/tile relative size-14 shrink-0 overflow-hidden rounded-xl bg-ink-100"
            >
              <OptionVisual photo={photos[0]} swatch={swatch} kind={kind} label={label} />
            </button>
          ) : (
            <span className="group/tile relative size-14 shrink-0 overflow-hidden rounded-xl bg-ink-100">
              <OptionVisual photo={photos[0]} swatch={swatch} kind={kind} label={label} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-ink-800">{label}</p>
            {description && <p className="text-[11px] leading-snug text-ink-500">{description}</p>}
          </div>
          {onOpenPhotos && photos.length > 0 && (
            <button
              type="button"
              onClick={onOpenPhotos}
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-ink-600 shadow-sm ring-1 ring-ink-200 transition hover:text-ink-900 hover:ring-ink-300"
            >
              <Images className="size-3" />
              {photos.length > 1 ? `${photos.length} photos` : "Photo"}
            </button>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
