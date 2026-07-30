import { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Ruler, X } from "lucide-react";
import type { Anchor } from "../../core/types";
import { standsOnGround } from "../../core/types";
import { anchorThumbBlobId, currentAnchorImage } from "../../state/ai";
import { useProjectsStore } from "../../state/projectsStore";
import { BlobThumbnail } from "../components/BlobThumbnail";
import { cn } from "../lib/cn";
import { formatList } from "../lib/formatList";
import { ANCHOR_TYPE_ICON } from "./AnchorCard";

/**
 * Familiar rungs the drag snaps to, so a size can be chosen in one gesture
 * without anyone ever seeing a centimetre. The labels are the point: they're
 * how a parent actually thinks about how big someone is.
 */
const RUNGS: { cm: number; label: string }[] = [
  { cm: 50, label: "Baby" },
  { cm: 85, label: "Toddler" },
  { cm: 110, label: "Young child" },
  { cm: 140, label: "Big kid" },
  { cm: 165, label: "Teen" },
  { cm: 178, label: "Grown-up" },
  { cm: 195, label: "Very tall" },
];

const MIN_CM = 15;
const MAX_CM = 260;
/** Snap when within this many cm of a rung, or of another character's height
 *  — the same radius for both so neither feels like it fights the other. */
const SNAP_CM = 4;
/** Keyboard nudge step. */
const NUDGE_CM = 5;
/** Every bar gets at least this much width, even the shortest — a 0%-wide bar
 *  reads as "broken", not "small". */
const MIN_BAR_PCT = 6;
/** Even the tallest character's bar stops short of the very end of the
 *  track. Nothing stops someone from being dragged taller than anyone
 *  currently in the cast — a bar already pinned to the far edge would have
 *  nowhere left to go, which reads as "maxed out" even though it isn't. */
const MAX_BAR_PCT = 90;

/**
 * Snaps to whichever is closer: a familiar rung, or another character's
 * current height (`targets`) — so it's just as easy to land a character on
 * "the same size as Amanda" as it is to land on "Toddler". Rungs and targets
 * within the same tolerance are on equal footing; a `target` is checked first
 * so it wins ties (matching a sibling exactly is more useful feedback than
 * matching a generic rung by coincidence).
 */
function snap(cm: number, targets: number[] = []): number {
  const clamped = Math.max(MIN_CM, Math.min(MAX_CM, cm));
  let best = Math.round(clamped);
  let bestDist = SNAP_CM;
  for (const c of [...targets, ...RUNGS.map((r) => r.cm)]) {
    const d = Math.abs(c - clamped);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

function labelFor(cm: number): string | null {
  return RUNGS.find((r) => Math.abs(r.cm - cm) <= SNAP_CM)?.label ?? null;
}

/** True when the current viewer's locale prefers imperial units — the only
 *  case where showing centimetres while dragging would be more confusing
 *  than helpful. Computed once; a locale doesn't change mid-session. */
const PREFERS_IMPERIAL: boolean = (() => {
  if (typeof navigator === "undefined") return false;
  try {
    return new Intl.Locale(navigator.language).maximize().region === "US";
  } catch {
    return navigator.language?.toLowerCase() === "en-us";
  }
})();

/** `110` → `"110cm"`, or `"3'7\""` for a viewer whose locale prefers feet and
 *  inches — the live readout while dragging, so the number that appears
 *  actually means something to whoever's reading it. */
function formatHeight(cm: number): string {
  if (!PREFERS_IMPERIAL) return `${cm}cm`;
  const totalInches = Math.round(cm / 2.54);
  const feet = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  return `${feet}'${inches}"`;
}

export interface CastLineupProps {
  /** Whether the panel is expanded. It's an inline section of the Characters
   *  step, not a modal — closing it doesn't lose anything, it's just tucked
   *  away again. */
  open: boolean;
  onClose: () => void;
  anchors: Anchor[];
}

/**
 * The cast as horizontal bars, so relative size can be judged the only way
 * it can actually be judged — by looking at it.
 *
 * Rows keep the same order as the casting reel above (NOT re-sorted by
 * height): resorting live while a bar is being dragged would make rows jump
 * around under the user's cursor mid-gesture, which reads as broken rather
 * than as "ranked". Bar length alone already shows who's tallest.
 *
 * Lives inline in the Characters step (not a modal): sizing is something
 * you'll likely recheck after every regeneration, and a popup you have to
 * reopen each time gets in the way of that more than it helps. Bars are
 * sized as a percentage of their own track, so the row fits the available
 * width instead of needing horizontal scrolling for a normal cast on a
 * normal screen; the list itself scrolls vertically if the cast is long,
 * which is the scroll direction everyone already knows how to use.
 *
 * Heights are inferred during story analysis, so this opens already correct
 * in the common case and the user's job is to confirm, not to author.
 * Dragging a bar adjusts that character; the exact centimetre number only
 * appears while actively dragging — otherwise a friendly label ("Toddler",
 * "Grown-up"...) stands in for it, because nobody thinks in centimetres but
 * knowing the number is there while you're actually adjusting it helps.
 */
export function CastLineup({ open, onClose, anchors }: CastLineupProps) {
  const updateAnchor = useProjectsStore((s) => s.updateAnchor);

  // Only characters that can stand on a ground line, and only ones with art —
  // a lineup of placeholder icons tells you nothing about size.
  const cast = useMemo(
    () =>
      anchors.filter(
        (a) =>
          a.type === "character" &&
          a.include &&
          standsOnGround(a.bodyPlan) &&
          Boolean(currentAnchorImage(a)),
      ),
    [anchors],
  );

  // Included characters left OUT of the list above, and why — so "someone's
  // missing" reads as an explained exception instead of looking like a bug.
  const left = useMemo(
    () =>
      anchors
        .filter((a) => a.type === "character" && a.include && !cast.includes(a))
        .map((a) => ({
          anchor: a,
          reason: !currentAnchorImage(a)
            ? "no reference art yet"
            : "doesn't stand on a shared ground line",
        })),
    [anchors, cast],
  );

  // Local heights while dragging, committed to the project on release, so a
  // drag doesn't write to Firestore on every pointer move.
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const heightOf = (a: Anchor) => draft[a.id] ?? a.heightCm ?? 110;
  const tallest = Math.max(...cast.map(heightOf), 1);

  const dragRef = useRef<{ id: string; startX: number; startCm: number; trackPx: number } | null>(
    null,
  );

  function onPointerDown(e: React.PointerEvent, a: Anchor) {
    const button = e.currentTarget as HTMLElement;
    button.setPointerCapture?.(e.pointerId);
    // The track is the bar's immediate parent — measured fresh at drag start
    // so a resized panel (or a different viewport) is always converted
    // correctly, rather than baking in a stale pixels-per-cm constant.
    const trackPx = button.parentElement?.getBoundingClientRect().width ?? 200;
    dragRef.current = { id: a.id, startX: e.clientX, startCm: heightOf(a), trackPx };
    setDraggingId(a.id);
  }
  // Other characters' current heights — what a drag or nudge can snap onto,
  // besides the familiar rungs.
  function peerHeights(excludeId: string): number[] {
    return cast.filter((c) => c.id !== excludeId).map(heightOf);
  }

  function onPointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const deltaCm = ((e.clientX - drag.startX) / drag.trackPx) * tallest;
    const next = snap(drag.startCm + deltaCm, peerHeights(drag.id));
    setDraft((d) => (d[drag.id] === next ? d : { ...d, [drag.id]: next }));
  }
  function endDrag() {
    const drag = dragRef.current;
    dragRef.current = null;
    setDraggingId(null);
    if (!drag) return;
    const value = draft[drag.id];
    if (value !== undefined) {
      void updateAnchor(drag.id, { heightCm: value, heightUserSet: true });
    }
  }
  function nudge(a: Anchor, deltaCm: number) {
    const next = snap(heightOf(a) + deltaCm, peerHeights(a.id));
    setDraft((d) => ({ ...d, [a.id]: next }));
    void updateAnchor(a.id, { heightCm: next, heightUserSet: true });
  }

  // While a character is being dragged (or nudged) onto exactly another
  // character's height, both bars light up together — the visual confirmation
  // that the snap actually landed on a match, not just a coincidence.
  const draggingAnchor = draggingId ? cast.find((c) => c.id === draggingId) : undefined;
  const draggingCm = draggingAnchor ? heightOf(draggingAnchor) : null;
  const hasPeerMatch =
    draggingCm !== null &&
    cast.some((c) => c.id !== draggingId && heightOf(c) === draggingCm);

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="overflow-hidden"
        >
          <div className="mt-3 rounded-2xl border border-ink-200 bg-white p-4">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-ink-700">
                <Ruler className="size-4 text-ink-400" />
                Does everyone look the right size?
              </span>
              <button
                type="button"
                onClick={onClose}
                aria-label="Done checking sizes"
                className="rounded-md p-1 text-ink-400 transition hover:bg-ink-100 hover:text-ink-600"
              >
                <X className="size-4" />
              </button>
            </div>

            {cast.length < 2 ? (
              <p className="py-4 text-center text-xs text-ink-400">
                Sizes matter once at least two characters have reference art.
              </p>
            ) : (
              <>
                <p className="mb-4 text-xs leading-relaxed text-ink-500">
                  We guessed how tall everyone is from your story. Drag any bar if someone looks
                  off.
                </p>
                <div
                  className="max-h-72 space-y-2 overflow-y-auto pr-1"
                  onPointerMove={onPointerMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                >
                  {cast.map((a) => {
                    const cm = heightOf(a);
                    const label = labelFor(cm);
                    const pct = Math.max(MIN_BAR_PCT, (cm / tallest) * MAX_BAR_PCT);
                    const dragging = draggingId === a.id;
                    const matched = hasPeerMatch && cm === draggingCm;
                    const Icon = ANCHOR_TYPE_ICON[a.type];
                    return (
                      <div key={a.id} className="flex items-center gap-2.5">
                        <BlobThumbnail
                          blobId={anchorThumbBlobId(a)}
                          alt={a.name}
                          instant
                          className="size-9 shrink-0 rounded-lg"
                          fallback={<Icon className="size-4 text-ink-300" />}
                        />
                        <span className="w-16 shrink-0 truncate text-xs font-medium text-ink-700 sm:w-24">
                          {a.name}
                        </span>
                        <div className="relative h-6 min-w-0 flex-1 rounded-full bg-ink-100">
                          <div
                            className={cn(
                              "h-full rounded-full transition-colors",
                              matched ? "bg-emerald-400" : dragging ? "bg-brand-400" : "bg-brand-300",
                              dragging ? "transition-[background-color]" : "transition-[width,background-color]",
                            )}
                            style={{ width: `${pct}%` }}
                          />
                          <button
                            type="button"
                            aria-label={`Adjust the size of ${a.name}`}
                            onPointerDown={(e) => onPointerDown(e, a)}
                            onKeyDown={(e) => {
                              if (e.key === "ArrowRight" || e.key === "ArrowUp") {
                                e.preventDefault();
                                nudge(a, NUDGE_CM);
                              } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
                                e.preventDefault();
                                nudge(a, -NUDGE_CM);
                              }
                            }}
                            className={cn(
                              "absolute inset-y-0 flex w-4 -translate-x-1/2 cursor-ew-resize touch-none",
                              "items-center justify-center rounded-full outline-none",
                              "focus-visible:ring-2 focus-visible:ring-brand-400",
                            )}
                            style={{ left: `${pct}%` }}
                          >
                            <span
                              className={cn(
                                "h-4 w-1.5 rounded-full",
                                matched ? "bg-emerald-600" : "bg-brand-600",
                              )}
                            />
                          </button>
                        </div>
                        <span
                          className={cn(
                            "w-16 shrink-0 text-right text-[11px] font-medium",
                            matched ? "text-emerald-600" : "text-ink-400",
                          )}
                        >
                          {dragging ? formatHeight(cm) : matched ? "Same size" : label ?? "\u00a0"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {left.length > 0 && (
              <p className="mt-3 text-xs leading-relaxed text-ink-400">
                Not shown: {formatList(left.map((l) => `${l.anchor.name} (${l.reason})`))}.
              </p>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
