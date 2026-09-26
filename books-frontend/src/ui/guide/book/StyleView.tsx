"use client";

/**
 * Every look as a printed plate. Choosing one only changes the book; any
 * portrait drawn in another look shows as out of date until it is redrawn.
 */
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Check, Search, Sparkles } from "lucide-react";
import { resolveArtStyles } from "../../../core/config/artStyles";
import { collectSourceArtGroups } from "../../../core/book/sourceArt";
import type { Project } from "../../../core/types";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { cn } from "../../lib/cn";
import { useBlobUrl } from "../../hooks/useBlobUrl";
import { chooseStyle } from "../bookActions";
import { useGuideT } from "../intl";
import { lineRise } from "../motion";

export function StyleView({ project, locked }: { project: Project; locked: boolean }) {
  const t = useGuideT("chrome");
  const artStyles = useAppConfigStore((s) => s.artStyles);
  const [query, setQuery] = useState("");
  const styles = useMemo(() => resolveArtStyles(artStyles, { includeDisabled: locked }), [artStyles, locked]);
  const current = project.config.styleReady !== false ? project.config.artStyle.presetId : null;
  const shown = useMemo(() => {
    const available = locked
      ? styles.filter((style) => style.id === current)
      : styles;
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return available;
    return available.filter((style) =>
      `${style.label} ${style.description}`.toLocaleLowerCase().includes(needle),
    );
  }, [current, locked, query, styles]);
  const derived = project.config.styleReady !== false && project.config.artStyle.origin === "derived";
  const derivedBlobId =
    project.config.artStyle.referenceArt?.[0]?.blobId ??
    collectSourceArtGroups(project)[0]?.images[0]?.blobId;
  const derivedImage = useBlobUrl(derivedBlobId);

  return (
    <div className="h-full overflow-y-auto px-5 py-6 sm:px-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-5">
        {!locked && styles.length > 8 && (
          <label className="relative block max-w-md">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-400" />
            <span className="sr-only">{t("searchStyles")}</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("searchStyles")}
              className="h-11 w-full rounded-xl bg-white pr-3 pl-10 text-sm text-ink-900 shadow-xs ring-1 ring-ink-200 outline-none placeholder:text-ink-400 focus:ring-2 focus:ring-magic-400"
            />
          </label>
        )}
        <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 xl:grid-cols-4">
        {derived && (
          <div className="flex flex-col gap-2 text-left">
            <span className="relative block aspect-4/5 w-full overflow-hidden rounded-sm bg-[#efe9df] p-3 shadow-soft ring-2 ring-inset ring-ink-900">
              {derivedImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={derivedImage}
                  alt=""
                  className="size-full rounded-xs border border-ink-900/5 bg-white object-contain p-2 shadow-inner"
                />
              ) : (
                <span className="flex size-full items-center justify-center text-magic-600">
                  <Sparkles className="size-8" />
                </span>
              )}
              <span className="absolute top-2 right-2 flex size-6 items-center justify-center rounded-full bg-ink-900 text-white shadow-soft">
                <Check className="size-3.5" strokeWidth={3} />
              </span>
            </span>
            <span className="px-0.5">
              <span className="block font-display text-sm font-medium text-ink-900">
                {t("fromDrawing")}
              </span>
              <span className="line-clamp-2 text-xs leading-snug text-ink-500">
                {t("drawingDefinesLook")}
              </span>
            </span>
          </div>
        )}
        {shown.map((style, index) => {
          const image = style.examples[0]?.imageUrl;
          const selected = style.id === current;
          return (
            <motion.button
              key={style.id}
              type="button"
              variants={lineRise}
              initial="hidden"
              animate="show"
              transition={{ delay: Math.min(index, 8) * 0.03 }}
              disabled={locked}
              onClick={() => void chooseStyle(style.id)}
              aria-pressed={selected}
              className="group flex flex-col gap-2 text-left focus-visible:outline-none disabled:cursor-default"
            >
              <span
                className={cn(
                  "relative block aspect-4/5 w-full overflow-hidden rounded-sm bg-ink-100 shadow-soft ring-1 transition duration-200",
                  "group-hover:-translate-y-1 group-hover:shadow-lifted group-focus-visible:ring-2 group-focus-visible:ring-inset group-disabled:translate-y-0",
                  selected ? "ring-2 ring-inset ring-ink-900" : "ring-ink-900/5",
                )}
              >
                {image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={image} alt="" className="size-full object-cover" loading="lazy" />
                )}
                {selected && (
                  <motion.span
                    layoutId="guide-style-check"
                    className="absolute top-2 right-2 flex size-6 items-center justify-center rounded-full bg-ink-900 text-white shadow-soft"
                  >
                    <Check className="size-3.5" strokeWidth={3} />
                  </motion.span>
                )}
              </span>
              <span className="px-0.5">
                <span className="block font-display text-sm font-medium text-ink-900">{style.label}</span>
                <span className="line-clamp-2 text-xs leading-snug text-ink-500">{style.description}</span>
              </span>
            </motion.button>
          );
        })}
        </div>
      </div>
    </div>
  );
}
