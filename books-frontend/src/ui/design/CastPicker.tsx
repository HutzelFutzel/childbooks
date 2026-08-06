/**
 * Page/cover cast picker for the illustration toolbox. Toggles commit to the
 * brief immediately; regenerating the art stays optional (stale banner / Update).
 */
import { useMemo, useState } from "react";
import { ChevronDown, MapPin, Users } from "lucide-react";
import type { Anchor } from "../../core/types";
import { InfoHint } from "../components/InfoHint";
import { useBlobUrl } from "../hooks/useBlobUrl";
import { cn } from "../lib/cn";
import { anchorThumbBlobId } from "../../state/ai";
import type { PageIllustrationApi } from "../studio/usePageIllustration";

export function CastPicker({
  illo,
  collapsible = true,
  defaultOpen = false,
}: {
  illo: PageIllustrationApi;
  collapsible?: boolean;
  /** When collapsible, whether the body starts expanded. */
  defaultOpen?: boolean;
}) {
  const {
    anchors,
    activeIds,
    drawnAnchorIds,
    coverMode,
    toggleAnchor,
    cursor,
    changedHere,
    staleRefAnchors,
  } = illo;

  const [open, setOpen] = useState(defaultOpen || !collapsible);

  const staleLookIds = useMemo(() => {
    const ids = new Set(changedHere.map((a) => a.id));
    for (const a of staleRefAnchors) ids.add(a.id);
    return ids;
  }, [changedHere, staleRefAnchors]);

  const activeSet = useMemo(() => new Set(activeIds), [activeIds]);
  const characters = anchors.filter((a) => a.type !== "place");
  const places = anchors.filter((a) => a.type === "place");
  const label = coverMode ? "On this cover" : "In this picture";
  const artMismatch =
    !!cursor &&
    drawnAnchorIds.length > 0 &&
    (drawnAnchorIds.length !== activeIds.length ||
      drawnAnchorIds.some((id) => !activeSet.has(id)));

  const body =
    anchors.length === 0 ? (
      <p className="text-[11px] leading-snug text-ink-400">
        No characters or places in the cast yet. Add them in the Characters step.
      </p>
    ) : (
      <div className="space-y-3">
        <div className="flex items-center gap-1 text-[11px] text-ink-400">
          Tap to include or leave out
          <InfoHint topic="pageAnchors" />
        </div>
        {characters.length > 0 && (
          <CastGroup
            label="Characters"
            anchors={characters}
            activeSet={activeSet}
            staleLookIds={staleLookIds}
            coverMode={coverMode}
            onToggle={toggleAnchor}
          />
        )}
        {places.length > 0 && (
          <CastGroup
            label="Places"
            anchors={places}
            activeSet={activeSet}
            staleLookIds={staleLookIds}
            coverMode={coverMode}
            onToggle={toggleAnchor}
          />
        )}
        <p className="text-[11px] leading-snug text-ink-400">
          {artMismatch
            ? "Cast updated — the picture is out of date until you refresh it."
            : "Saved to this page’s brief. Generate or update the picture when you’re ready."}
        </p>
      </div>
    );

  if (!collapsible) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-ink-600">
            <Users className="size-3.5 text-ink-400" />
            {label}
          </div>
          <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-ink-600">
            {activeIds.length}
          </span>
        </div>
        {body}
      </div>
    );
  }

  return (
    <div className="rounded-xl ring-1 ring-inset ring-ink-100">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition hover:bg-ink-50/80"
      >
        <Users className="size-3.5 shrink-0 text-ink-400" />
        <span className="min-w-0 flex-1 text-xs font-semibold text-ink-700">{label}</span>
        {artMismatch && (
          <span className="size-1.5 shrink-0 rounded-full bg-amber-400" title="Picture out of date" />
        )}
        <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-ink-600">
          {activeIds.length}
        </span>
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-ink-400 transition",
            open ? "" : "-rotate-90",
          )}
        />
      </button>
      {open && <div className="space-y-3 border-t border-ink-100 p-3">{body}</div>}
    </div>
  );
}

function CastGroup({
  label,
  anchors,
  activeSet,
  staleLookIds,
  coverMode,
  onToggle,
}: {
  label: string;
  anchors: Anchor[];
  activeSet: Set<string>;
  staleLookIds: Set<string>;
  coverMode?: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">{label}</p>
      <div className="grid grid-cols-3 gap-2">
        {anchors.map((a) => (
          <PortraitChip
            key={a.id}
            anchor={a}
            active={activeSet.has(a.id)}
            lookStale={staleLookIds.has(a.id)}
            coverMode={coverMode}
            onClick={() => onToggle(a.id)}
          />
        ))}
      </div>
    </div>
  );
}

function PortraitChip({
  anchor,
  active,
  lookStale,
  coverMode,
  onClick,
}: {
  anchor: Anchor;
  active: boolean;
  lookStale?: boolean;
  coverMode?: boolean;
  onClick: () => void;
}) {
  const url = useBlobUrl(anchorThumbBlobId(anchor));
  const isPlace = anchor.type === "place";
  const where = coverMode ? "cover" : "picture";
  return (
    <button
      type="button"
      onClick={onClick}
      title={active ? `On this ${where} — click to remove` : `Add to this ${where}`}
      className={cn(
        "flex flex-col items-center gap-1.5 rounded-xl px-1.5 py-2 transition active:scale-[0.98]",
        active ? "bg-brand-50 ring-1 ring-inset ring-brand-200" : "bg-ink-50/80 hover:bg-ink-100",
      )}
    >
      <span className="relative">
        <span
          className={cn(
            "flex size-12 items-center justify-center overflow-hidden rounded-full bg-ink-100",
            active ? "ring-2 ring-brand-500 ring-offset-2 ring-offset-brand-50" : "opacity-55 grayscale",
            lookStale && active && "ring-amber-500",
          )}
        >
          {url ? (
            <img src={url} alt="" className="size-full object-cover" />
          ) : isPlace ? (
            <MapPin className="size-5 text-ink-400" />
          ) : (
            <span className="text-sm font-semibold text-ink-400">
              {anchor.name.slice(0, 1).toUpperCase()}
            </span>
          )}
        </span>
        {lookStale && active && (
          <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-amber-400 ring-2 ring-white" />
        )}
        {isPlace && (
          <span className="absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-ink-100">
            <MapPin className="size-2.5 text-ink-500" />
          </span>
        )}
      </span>
      <span
        className={cn(
          "line-clamp-2 w-full text-center text-[11px] font-medium leading-tight",
          active ? "text-brand-800" : "text-ink-400",
        )}
      >
        {anchor.name}
      </span>
    </button>
  );
}
