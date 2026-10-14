"use client";

/**
 * Every look as a printed plate. Choosing one only changes the book; any
 * portrait drawn in another look shows as out of date until it is redrawn.
 */
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Check, Lock, Search, Sparkles } from "lucide-react";
import { resolveArtStyles, type ArtStyleDefinition } from "../../../core/config/artStyles";
import { collectSourceArtGroups } from "../../../core/book/sourceArt";
import { styleArtworkName } from "../../../core/guide/artworkStyle";
import { portraitStatus, portraitSubjects } from "../../../core/guide/portrait";
import { ConfirmModal } from "../../components/ConfirmModal";
import type { Project } from "../../../core/types";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { cn } from "../../lib/cn";
import { useBlobUrl } from "../../hooks/useBlobUrl";
import { useStylePreviewUrls, useStyleStrip } from "../../hooks/useStylePreviews";
import { chooseStyle } from "../bookActions";
import { useGuideT } from "../intl";
import { lineRise } from "../motion";

/** A preset's plate: the admin's picture, or the reader's own first cover in that look. */
function PresetImage({ style }: { style: ArtStyleDefinition }) {
  const strip = useStyleStrip({ key: style.id, adminExamples: style.examples, limit: 1 });
  const [url] = useStylePreviewUrls(strip);
  if (!url) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" className="size-full object-cover" loading="lazy" />;
}

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
  const drawingImage = useBlobUrl(derivedBlobId);
  // The first cover drawn in this look, or its neutral sample, stands in for
  // the drawing it was read from; the drawing is the last resort.
  const lookStrip = useStyleStrip({ key: project.config.artStyle.customStyle?.id, limit: 1 });
  const [lookPreview] = useStylePreviewUrls(lookStrip);
  const derivedImage = lookPreview ?? drawingImage;
  const artworkName = derived ? styleArtworkName(project) : "";
  const anyDrawn = portraitSubjects(project).some((m) => portraitStatus(project, m.id) === "current");
  const [switching, setSwitching] = useState<ArtStyleDefinition | null>(null);
  // The look is a drawing's: taking a preset takes the drawing off the book, so it asks first.
  const pick = (style: ArtStyleDefinition) => {
    if (derived) setSwitching(style);
    else void chooseStyle(style.id);
  };

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
        {derived && (
          <div className="flex items-center gap-4 rounded-2xl bg-white p-3 shadow-soft ring-2 ring-inset ring-ink-900 sm:gap-5 sm:p-4">
            <span className="relative block aspect-4/5 w-24 shrink-0 overflow-hidden rounded-sm bg-[#efe9df] p-2 shadow-soft sm:w-28">
              {derivedImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={derivedImage}
                  alt=""
                  className="size-full rounded-xs border border-ink-900/5 bg-white object-contain p-1 shadow-inner"
                />
              ) : (
                <span className="flex size-full items-center justify-center text-magic-600">
                  <Sparkles className="size-6" />
                </span>
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-ink-500 uppercase">
                <Lock className="size-3" aria-hidden />
                {t("fromDrawing")}
              </span>
              <span className="mt-1 block font-display text-lg leading-snug font-medium text-ink-900">
                {artworkName ? t("styleFromArtwork", { name: artworkName }) : t("styleFromArtworkAny")}
              </span>
              <span className="mt-1 block text-sm leading-snug text-ink-600">{t("styleFromArtworkHint")}</span>
            </span>
          </div>
        )}
        {derived && !locked && <p className="text-xs font-medium text-ink-500">{t("styleFromArtworkPick")}</p>}
        <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 xl:grid-cols-4">
        {shown.map((style, index) => {
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
              onClick={() => pick(style)}
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
                <PresetImage style={style} />
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
      <ConfirmModal
        open={switching !== null}
        onClose={() => setSwitching(null)}
        onConfirm={() => {
          const style = switching;
          setSwitching(null);
          if (style) void chooseStyle(style.id);
        }}
        title={t("switchStyleTitle", { style: switching?.label ?? "" })}
        confirmLabel={t("switchStyleConfirm", { style: switching?.label ?? "" })}
        cancelLabel={t("switchStyleKeep")}
        danger
      >
        <p>{artworkName ? t("switchStyleBody", { name: artworkName }) : t("switchStyleBodyAny")}</p>
        {anyDrawn && <p className="mt-2 text-ink-500">{t("switchStyleUndo")}</p>}
      </ConfirmModal>
    </div>
  );
}
