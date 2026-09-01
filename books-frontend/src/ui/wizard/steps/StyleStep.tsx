"use client";

import { motion } from "framer-motion";
import { Check } from "lucide-react";
import type { ArtStyleSelection } from "../../../core/types";
import { ART_STYLE_PRESETS } from "../../../core/config/options";
import { resolveArtStyleLabel } from "../../../core/prompts/style";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { cn } from "../../lib/cn";
import { fadeRise, spring } from "../../lib/motion";

/** Compare preset + custom direction (trim-normalized). */
export function artStylesEqual(a: ArtStyleSelection, b: ArtStyleSelection): boolean {
  return (
    a.presetId === b.presetId &&
    (a.customDescription ?? "").trim() === (b.customDescription ?? "").trim()
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
  const artStyles = useAppConfigStore((s) => s.artStyles);
  const examples = artStyles.examples;
  const committed = committedArtStyle ?? artStyle;

  return (
    <motion.div
      variants={fadeRise}
      initial="hidden"
      animate="show"
      className="space-y-6"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ART_STYLE_PRESETS.map((style, i) => {
          const selected = artStyle.presetId === style.id;
          const isCurrent = committed.presetId === style.id;
          const title = resolveArtStyleLabel(style.id, artStyles);
          const imageUrl = examples[style.id]?.imageUrl;

          return (
            <motion.button
              key={style.id}
              type="button"
              onClick={() => onChange({ ...artStyle, presetId: style.id })}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring, delay: i * 0.03 }}
              whileHover={{ y: -3 }}
              whileTap={{ scale: 0.99 }}
              className={cn(
                "group relative flex flex-col overflow-hidden rounded-3xl text-left shadow-soft ring-1 transition",
                selected
                  ? "bg-white ring-2 ring-brand-500 shadow-lifted"
                  : isCurrent
                    ? "bg-white/90 ring-1 ring-ink-300 hover:ring-brand-300 hover:shadow-lifted"
                    : "bg-white/80 ring-ink-100 hover:bg-white hover:ring-brand-300 hover:shadow-lifted",
              )}
            >
              {/* Visual artwork preview banner */}
              <div className="relative h-36 w-full overflow-hidden bg-ink-100 sm:h-40">
                {imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={imageUrl}
                    alt={title}
                    className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                ) : (
                  <div
                    className={cn(
                      "size-full bg-linear-to-br transition-transform duration-500 group-hover:scale-105",
                      style.swatch,
                    )}
                  >
                    <div className="flex h-full items-end p-3">
                      <span className="rounded-md bg-white/75 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-700 backdrop-blur shadow-2xs">
                        Sample preview
                      </span>
                    </div>
                  </div>
                )}

                {/* Subtle vignette gradient for depth */}
                <div className="pointer-events-none absolute inset-0 bg-linear-to-t from-black/20 via-transparent to-black/10" />

                {/* Status Badges */}
                {isCurrent && (
                  <span
                    className={cn(
                      "absolute left-3 top-3 rounded-full px-2.5 py-0.5 text-[10px] font-semibold tracking-wide backdrop-blur shadow-2xs transition",
                      selected
                        ? "bg-brand-600/90 text-white"
                        : "bg-ink-900/75 text-white",
                    )}
                  >
                    Current style
                  </span>
                )}

                {/* Selection Check Circle */}
                <span
                  className={cn(
                    "absolute right-3 top-3 flex size-6 items-center justify-center rounded-full border shadow-2xs transition",
                    selected
                      ? "border-brand-500 bg-brand-500 text-(--color-brand-foreground)"
                      : "border-ink-200/80 bg-white/80 text-transparent group-hover:border-brand-300",
                  )}
                >
                  <Check className="size-3.5" strokeWidth={3} />
                </span>
              </div>

              {/* Information body */}
              <div className="flex flex-1 flex-col justify-between gap-1.5 p-4 sm:p-5">
                <div>
                  <h3 className="font-display text-base font-bold tracking-tight text-ink-900 transition-colors group-hover:text-brand-700 sm:text-lg">
                    {title}
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-ink-500 sm:text-sm">
                    {style.description}
                  </p>
                </div>
              </div>
            </motion.button>
          );
        })}
      </div>
    </motion.div>
  );
}
