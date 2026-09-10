"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import type { ArtStyleSelection } from "../../../core/types";
import {
  resolveArtStyle,
  resolveArtStyles,
  type ArtStyleDefinition,
} from "../../../core/config/artStyles";
import { ART_STYLE_PRESETS } from "../../../core/config/options";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { cn } from "../../lib/cn";

/** Compare preset + custom direction (trim-normalized). */
export function artStylesEqual(a: ArtStyleSelection, b: ArtStyleSelection): boolean {
  return (
    a.presetId === b.presetId &&
    (a.customDescription ?? "").trim() === (b.customDescription ?? "").trim()
  );
}

function StyleCard({
  style,
  selected,
  current,
  onSelect,
}: {
  style: ArtStyleDefinition;
  selected: boolean;
  current: boolean;
  onSelect: () => void;
}) {
  const [exampleIndex, setExampleIndex] = useState(0);
  const [failedImages, setFailedImages] = useState<Set<string>>(() => new Set());
  const pointerStart = useRef<number | null>(null);
  const suppressClick = useRef(false);
  const examples = style.examples;
  const example = examples[exampleIndex];
  const exampleKey = example?.storagePath ?? example?.imageUrl;
  const fallback = ART_STYLE_PRESETS.find((preset) => preset.id === style.id)?.swatch;

  useEffect(() => {
    if (exampleIndex >= examples.length) setExampleIndex(0);
  }, [exampleIndex, examples.length]);

  const show = (index: number) => {
    if (!examples.length) return;
    setExampleIndex((index + examples.length) % examples.length);
  };

  return (
    <article
      className={cn(
        "group relative flex h-full min-w-0 flex-col overflow-hidden rounded-2xl bg-white text-left transition duration-200",
        "shadow-[0_8px_30px_rgba(38,35,31,0.07)]",
        selected
          ? "ring-2 ring-brand-500 shadow-[0_16px_42px_rgba(38,35,31,0.13)]"
          : "ring-1 ring-ink-200/80 hover:-translate-y-0.5 hover:ring-brand-300 hover:shadow-[0_14px_38px_rgba(38,35,31,0.11)]",
      )}
    >
      <button
        type="button"
        aria-label={`Choose ${style.label}`}
        aria-pressed={selected}
        onPointerDown={(event) => {
          pointerStart.current = event.clientX;
        }}
        onPointerUp={(event) => {
          if (pointerStart.current === null || examples.length < 2) return;
          const distance = event.clientX - pointerStart.current;
          pointerStart.current = null;
          if (Math.abs(distance) < 44) return;
          suppressClick.current = true;
          show(exampleIndex + (distance < 0 ? 1 : -1));
        }}
        onClick={() => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          onSelect();
        }}
        className="absolute inset-0 z-10 rounded-2xl focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-300 focus-visible:ring-offset-2"
      >
        <span className="sr-only">Choose {style.label}</span>
      </button>

      <div className="pointer-events-none relative aspect-4/3 w-full overflow-hidden bg-ink-100">
        {example && exampleKey && !failedImages.has(exampleKey) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={exampleKey}
            src={example.imageUrl}
            alt=""
            draggable={false}
            className="size-full object-cover"
            onError={() =>
              setFailedImages((failed) => new Set(failed).add(exampleKey))
            }
          />
        ) : (
          <div
            className={cn(
              "size-full bg-linear-to-br",
              fallback ?? "from-ink-100 via-white to-brand-100",
            )}
          />
        )}
      </div>

      {examples.length > 1 && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 aspect-4/3">
          <button
            type="button"
            aria-label={`Previous ${style.label} example`}
            onClick={() => show(exampleIndex - 1)}
            className="pointer-events-auto absolute left-2.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-ink-700 shadow-soft ring-1 ring-black/5 backdrop-blur transition hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            aria-label={`Next ${style.label} example`}
            onClick={() => show(exampleIndex + 1)}
            className="pointer-events-auto absolute right-2.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-ink-700 shadow-soft ring-1 ring-black/5 backdrop-blur transition hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      )}

      <div className="pointer-events-none flex min-h-27 flex-1 flex-col px-4 pb-4 pt-3.5">
        {examples.length > 1 && (
          <div className="pointer-events-auto relative z-20 mb-3 flex min-h-2 items-center gap-1.5">
            {examples.map((item, index) => (
              <button
                key={item.storagePath ?? item.imageUrl}
                type="button"
                aria-label={`Show ${style.label} example ${index + 1}`}
                aria-current={index === exampleIndex}
                onClick={() => show(index)}
                className={cn(
                  "h-1.5 rounded-full transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400",
                  index === exampleIndex
                    ? "w-5 bg-ink-700"
                    : "w-1.5 bg-ink-300 hover:bg-ink-500",
                )}
              />
            ))}
          </div>
        )}
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <h3 className="font-display text-lg font-bold tracking-tight text-ink-900">
                {style.label}
              </h3>
              {current && (
                <span className="text-[11px] font-semibold text-ink-400">
                  Current
                </span>
              )}
            </div>
            {style.description && (
              <p className="mt-1 line-clamp-2 text-sm leading-snug text-ink-500">
                {style.description}
              </p>
            )}
          </div>
          <span
            className={cn(
              "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border transition",
              selected
                ? "border-brand-500 bg-brand-500 text-(--color-brand-foreground)"
                : "border-ink-300 bg-white text-transparent",
            )}
          >
            <Check className="size-3.5" strokeWidth={3} />
          </span>
        </div>
      </div>
    </article>
  );
}

export function StyleStep({
  artStyle,
  committedArtStyle,
  onChange,
}: {
  /** Draft / selected style in the picker. */
  artStyle: ArtStyleSelection;
  /** Style currently applied on the book (shown as "Current" when different). */
  committedArtStyle?: ArtStyleSelection;
  onChange: (next: ArtStyleSelection) => void;
}) {
  const config = useAppConfigStore((state) => state.artStyles);
  const styles = useMemo(() => {
    const available = resolveArtStyles(config);
    const currentId = committedArtStyle?.presetId;
    if (!currentId || available.some((style) => style.id === currentId)) {
      return available;
    }
    const hiddenCurrent = resolveArtStyle(currentId, config);
    return hiddenCurrent ? [...available, hiddenCurrent] : available;
  }, [committedArtStyle?.presetId, config]);

  const gridClass =
    styles.length <= 1
      ? "mx-auto max-w-xl grid-cols-1"
      : styles.length === 2
        ? "mx-auto max-w-5xl grid-cols-1 sm:grid-cols-2"
        : styles.length <= 6
          ? "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3"
          : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4";

  if (!styles.length) {
    return (
      <div className="flex min-h-72 items-center justify-center rounded-2xl border border-dashed border-ink-300 bg-white/60 px-6 text-center">
        <div>
          <h2 className="font-display text-lg font-bold text-ink-800">
            Looks are not available yet
          </h2>
          <p className="mt-1 text-sm text-ink-500">
            Please come back shortly while the illustration styles are prepared.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("grid w-full gap-4 sm:gap-5", gridClass)}>
      {styles.map((style) => (
        <StyleCard
          key={style.id}
          style={style}
          selected={artStyle.presetId === style.id}
          current={committedArtStyle?.presetId === style.id}
          onSelect={() =>
            onChange(
              artStyle.origin === "derived"
                ? { presetId: style.id, origin: "preset" }
                : { ...artStyle, presetId: style.id, origin: "preset" },
            )
          }
        />
      ))}
    </div>
  );
}
