/**
 * Left rail for Design · Cast — same role as PageFilmstrip: pick who is on
 * stage. Vertical thumbs of every cast member (including skipped).
 */
import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Lock, Plus, UserPlus } from "lucide-react";
import type { Anchor } from "../../core/types";
import { anchorThumbBlobId, currentAnchorImage } from "../../state/ai";
import { BlobThumbnail } from "../components/BlobThumbnail";
import { GenerationOverlay } from "../generation/GenerationOverlay";
import { cn } from "../lib/cn";
import { ANCHOR_TYPE_ICON } from "../anchors/AnchorCard";

const WIDTH_KEY = "childbooks.castFilmstripWidth";
const WIDTH_MIN = 140;
const WIDTH_MAX = 240;
const WIDTH_DEFAULT = 168;

function readStoredWidth(): number {
  if (typeof window === "undefined") return WIDTH_DEFAULT;
  const raw = window.localStorage.getItem(WIDTH_KEY);
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return WIDTH_DEFAULT;
  return Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, Math.round(n)));
}

export function CastFilmstrip({
  anchors,
  activeId,
  generatingIds,
  onSelect,
  onAdd,
  onImport,
  canImport,
  importLocked,
}: {
  anchors: Anchor[];
  activeId: string | null;
  generatingIds: Set<string>;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onImport?: () => void;
  canImport?: boolean;
  importLocked?: boolean;
}) {
  const [width, setWidth] = useState(WIDTH_DEFAULT);
  const resizing = useRef<{ startX: number; startW: number } | null>(null);

  useEffect(() => {
    setWidth(readStoredWidth());
  }, []);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      if (!resizing.current) return;
      const next = Math.min(
        WIDTH_MAX,
        Math.max(WIDTH_MIN, resizing.current.startW + (e.clientX - resizing.current.startX)),
      );
      setWidth(next);
    }
    function onUp() {
      if (!resizing.current) return;
      resizing.current = null;
      setWidth((w) => {
        window.localStorage.setItem(WIDTH_KEY, String(w));
        return w;
      });
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  return (
    <aside
      className="relative flex h-full shrink-0 flex-col border-r border-ink-100 bg-white/80"
      style={{ width }}
    >
      <div className="border-b border-ink-100 px-3 py-2">
        <p className="text-xs font-semibold text-ink-500">Cast</p>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
        {anchors.map((anchor) => (
          <CastCell
            key={anchor.id}
            anchor={anchor}
            active={activeId === anchor.id}
            generating={generatingIds.has(anchor.id)}
            onSelect={() => onSelect(anchor.id)}
          />
        ))}
        <button
          type="button"
          onClick={onAdd}
          className="flex w-full flex-col items-center gap-1 rounded-lg border border-dashed border-ink-200 px-2 py-3 text-ink-400 transition hover:border-brand-300 hover:bg-brand-50/40 hover:text-brand-600"
        >
          <Plus className="size-4" />
          <span className="text-[11px] font-medium">Add</span>
        </button>
        {canImport && (
          <button
            type="button"
            onClick={onImport}
            className="flex w-full flex-col items-center gap-1 rounded-lg border border-dashed border-ink-200 px-2 py-3 text-ink-400 transition hover:border-brand-300 hover:bg-brand-50/40 hover:text-brand-600"
          >
            {importLocked ? <Lock className="size-4" /> : <UserPlus className="size-4" />}
            <span className="text-[11px] font-medium">
              {importLocked ? "Import · Pro" : "Import"}
            </span>
          </button>
        )}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        title="Drag to resize"
        onPointerDown={(e) => {
          e.preventDefault();
          resizing.current = { startX: e.clientX, startW: width };
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }}
        className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize hover:bg-brand-200/50"
      />
    </aside>
  );
}

function CastCell({
  anchor,
  active,
  generating,
  onSelect,
}: {
  anchor: Anchor;
  active: boolean;
  generating: boolean;
  onSelect: () => void;
}) {
  const Icon = ANCHOR_TYPE_ICON[anchor.type];
  const ready = Boolean(currentAnchorImage(anchor));
  const skipped = !anchor.include;

  return (
    <button
      type="button"
      onClick={onSelect}
      title={skipped ? `${anchor.name} — skipped` : anchor.name}
      className={cn(
        "group relative block w-full overflow-hidden rounded-lg bg-white ring-2 transition",
        active ? "ring-brand-500" : "ring-ink-200 hover:ring-brand-300",
        skipped && "opacity-45 saturate-0",
      )}
    >
      <div className="relative aspect-3/4 w-full bg-ink-50">
        {generating ? (
          <GenerationOverlay action="anchorImage" compact />
        ) : (
          <BlobThumbnail
            blobId={anchorThumbBlobId(anchor)}
            alt={anchor.name}
            instant
            className="absolute inset-0 size-full rounded-none"
            fallback={<Icon className="size-6 text-ink-300" />}
          />
        )}
        {ready && !generating && (
          <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-emerald-500 text-white shadow-soft">
            <Check className="size-2.5" strokeWidth={3} />
          </span>
        )}
        {generating && (
          <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-brand-500 text-white shadow-soft">
            <Loader2 className="size-2.5 animate-spin" />
          </span>
        )}
      </div>
      <p className="truncate px-1 py-1 text-center text-[11px] font-medium text-ink-500">
        {anchor.name}
      </p>
    </button>
  );
}
