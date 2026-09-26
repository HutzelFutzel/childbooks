"use client";

/**
 * The cover. Before the pages it is a plate in the book's shape: the title,
 * subtitle and author are typed straight onto it, and typing never redraws a
 * picture. Once the cover is drawn it is shown as printed; clicking it puts the
 * cover in the composer.
 */
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { bookProductForConfig } from "../../../core/book";
import { resolveArtStyles } from "../../../core/config/artStyles";
import { COVER_FRONT_ID, type Project } from "../../../core/types";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { useChatStudio } from "../../../state/chatStudio";
import { PreviewSpread } from "../../studio/BookPreview";
import { useStudio } from "../../studio/StudioContext";
import { cn } from "../../lib/cn";
import { setAuthor, setSubtitle, setTitle } from "../bookActions";
import { bookTitle } from "../bookTitle";
import { useGuideT } from "../intl";
import { crossfade } from "../motion";
import { UnitStatus } from "./UnitStatus";

export function CoverView({ project, locked }: { project: Project; locked: boolean }) {
  const { displays } = useStudio();
  const setChip = useChatStudio((s) => s.setChip);
  const chip = useChatStudio((s) => s.chip);
  const drawn = locked ? displays.find((d) => d.cover === "front") : undefined;
  const product = bookProductForConfig(project.config);

  if (drawn) {
    const selected = chip?.kind === "cover";
    return (
      <div className="flex h-full items-center justify-center p-6">
        <button
          type="button"
          onClick={() => setChip(selected ? null : { kind: "cover", unitId: COVER_FRONT_ID })}
          className={cn(
            "relative w-full max-w-md transition focus-visible:outline-none",
            selected && "ring-2 ring-ink-900 ring-offset-4 ring-offset-canvas",
          )}
          style={{ aspectRatio: product.aspect }}
        >
          <PreviewSpread disp={drawn} />
          <UnitStatus unitId={COVER_FRONT_ID} />
        </button>
      </div>
    );
  }
  return <CoverPlate project={project} aspect={product.aspect} locked={locked} />;
}

function CoverPlate({ project, aspect, locked }: { project: Project; aspect: number; locked: boolean }) {
  const t = useGuideT("chrome");
  const artStyles = useAppConfigStore((s) => s.artStyles);
  const style = useMemo(
    () => resolveArtStyles(artStyles, { includeDisabled: true }).find((s) => s.id === project.config.artStyle.presetId),
    [artStyles, project.config.artStyle.presetId],
  );
  const image = style?.examples[0]?.imageUrl;
  const cover = project.authoringState?.cover;
  const title = bookTitle(project);

  return (
    <div className="flex h-full items-center justify-center p-6">
      <motion.div
        layout
        transition={crossfade}
        className="relative flex w-full max-w-sm flex-col overflow-hidden rounded-r-md rounded-l-[3px] bg-white shadow-lifted ring-1 ring-ink-900/5"
        style={{ aspectRatio: aspect }}
      >
        {image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="" className="absolute inset-0 size-full object-cover opacity-90" />
        )}
        <span aria-hidden className="absolute inset-y-0 left-0 w-3 bg-gradient-to-r from-ink-900/15 to-transparent" />
        <div className="relative mt-auto flex flex-col gap-1 bg-gradient-to-t from-white via-white/95 to-white/0 px-6 pt-16 pb-6">
          <CoverField
            value={title}
            onCommit={(v) => void setTitle(v)}
            placeholder={t("titlePlaceholder")}
            disabled={locked}
            className="font-display text-2xl font-semibold leading-tight text-ink-900 sm:text-3xl"
          />
          <CoverField
            value={cover?.subtitle ?? ""}
            onCommit={(v) => void setSubtitle(v)}
            placeholder={t("subtitle")}
            disabled={locked}
            className="text-sm text-ink-600"
          />
          <CoverField
            value={cover?.author ?? ""}
            onCommit={(v) => void setAuthor(v)}
            placeholder={t("author")}
            disabled={locked}
            className="mt-2 text-xs font-medium uppercase tracking-[0.14em] text-ink-500"
          />
        </div>
      </motion.div>
    </div>
  );
}

/** A line typed on the cover. Saves when the reader leaves it or presses Enter. */
function CoverField({
  value,
  onCommit,
  placeholder,
  disabled,
  className,
}: {
  value: string;
  onCommit: (value: string) => void;
  placeholder: string;
  disabled: boolean;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const next = draft.trim();
    if (next !== value.trim()) onCommit(next);
  };
  return (
    <input
      value={draft}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
      placeholder={placeholder}
      aria-label={placeholder}
      className={cn(
        "w-full rounded-md bg-transparent px-1 -mx-1 transition placeholder:text-ink-300 hover:bg-ink-900/[0.03] focus:bg-white/80 focus:outline-none focus:ring-1 focus:ring-ink-300 disabled:hover:bg-transparent",
        className,
      )}
    />
  );
}
