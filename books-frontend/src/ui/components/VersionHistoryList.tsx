/**
 * Dock-friendly version history: current version first, then recent ones in a
 * vertical list. Collapses to 3 rows with a Show all toggle — no horizontal scroll.
 */
import { useState } from "react";
import { ChevronDown, Trash2 } from "lucide-react";
import { cn } from "../lib/cn";
import { BlobThumbnail } from "./BlobThumbnail";

const COLLAPSED_OTHERS = 2; // plus current → up to 3 visible

export interface VersionHistoryItem {
  id: string;
  blobId: string;
  /** 1-based display number (stable across collapse). */
  index: number;
  aspect?: number;
}

export function VersionHistoryList({
  items,
  activeId,
  onSelect,
  onDelete,
  hint = "Click to restore. New edits always add a version.",
  /** When the parent panel already titles this section. */
  hideTitle = false,
}: {
  items: VersionHistoryItem[];
  activeId: string | null | undefined;
  onSelect: (id: string) => void;
  onDelete?: (id: string) => void;
  hint?: string;
  hideTitle?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  if (items.length === 0) return null;

  // Newest first for "recent" ordering; `items` is typically oldest-first.
  const newestFirst = [...items].reverse();
  const current =
    newestFirst.find((v) => v.id === activeId) ?? newestFirst[0]!;
  const others = newestFirst.filter((v) => v.id !== current.id);
  const needsToggle = others.length > COLLAPSED_OTHERS;
  const shownOthers =
    expanded || !needsToggle ? others : others.slice(0, COLLAPSED_OTHERS);
  const shown = [current, ...shownOthers];

  return (
    <div>
      {!hideTitle && (
        <p className="mb-1.5 text-xs font-medium text-ink-500">Versions</p>
      )}
      <ul className="flex flex-col gap-1">
        {shown.map((item) => {
          const active = item.id === activeId;
          const aspect = item.aspect ?? 1;
          return (
            <li key={item.id}>
              <div
                className={cn(
                  "group relative flex w-full items-center gap-2.5 rounded-lg border px-2 py-1.5 transition",
                  active
                    ? "border-brand-500 bg-brand-50/60 ring-1 ring-brand-200"
                    : "border-ink-100 bg-white hover:border-brand-300 hover:bg-ink-50",
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelect(item.id)}
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                >
                  <span
                    className="relative h-11 shrink-0 overflow-hidden rounded-md bg-ink-50 ring-1 ring-ink-100"
                    style={{ aspectRatio: String(aspect) }}
                  >
                    <BlobThumbnail
                      blobId={item.blobId}
                      alt={`Version ${item.index}`}
                      aspect={aspect}
                      className="size-full rounded-none"
                      instant
                    />
                  </span>
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block text-sm font-semibold text-ink-800">
                      Version {item.index}
                    </span>
                    <span className="block text-[11px] text-ink-400">
                      {active ? "Current" : "Earlier"}
                    </span>
                  </span>
                </button>
                {onDelete && (
                  <button
                    type="button"
                    onClick={() => onDelete(item.id)}
                    title="Delete this version"
                    aria-label={`Delete version ${item.index}`}
                    className="rounded-md p-1.5 text-ink-300 opacity-0 transition hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 focus:opacity-100 pointer-coarse:opacity-70"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {needsToggle && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1.5 flex w-full items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-ink-500 transition hover:bg-ink-50 hover:text-brand-600"
        >
          <ChevronDown
            className={cn("size-3.5 transition", expanded && "rotate-180")}
          />
          {expanded
            ? "Show less"
            : `Show all (${items.length})`}
        </button>
      )}
      {hint && <p className="mt-1.5 text-[11px] leading-snug text-ink-400">{hint}</p>}
    </div>
  );
}
