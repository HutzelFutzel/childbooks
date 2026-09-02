/**
 * Presentation primitives for the Studio's facing-spread editor. The editor
 * always presents the book as facing spreads — never lone narrow pages — so
 * what you see matches the opened, bound result:
 *   - a true double-page spread fills one wide frame;
 *   - two facing single pages sit side by side in one wide frame with a fold
 *     (and, when both are live pages, share one interactive canvas — see
 *     `PairPageStage.tsx` — so elements can be dragged across the fold);
 *   - a lone page (cover / first page) keeps the wide frame with a blank facing
 *     half, so every unit on screen is the same size.
 *
 * The design stage (`BookCanvas.tsx`) shows exactly ONE display spread at a
 * time, always live/interactive — there is no separate "review" vs "edit"
 * mode. The data model itself (`buildDisplaySpreads`, `contentSpreadIds`, …)
 * lives in `spreadModel.ts` (no React/Konva deps, so `StudioContext` can use it
 * too); this file re-exports it and supplies the small presentational pieces
 * (`HalfFrame` for the live editor, `SpreadThumbnail` for the filmstrip) that
 * both the main stage and the filmstrip share.
 */
import { useMemo } from "react";
import { Ban } from "lucide-react";
import { useJobsStore } from "../../state/jobsStore";
import { getCursor } from "../../core/versioning";
import { FastDraftBadge } from "../components/FastDraftBadge";
import { useBlobUrl } from "../hooks/useBlobUrl";
import { PageStage } from "../design/PageStage";
import { defaultIllustrationFocus } from "../design/designInit";
import { useStudio } from "./StudioContext";
import { PageStagePanel } from "./PageEditorCard";
import {
  coverSideOf,
  displayEntries,
  FOLD_GRADIENT,
  isBlankEntry,
  sideAspect,
  type DisplaySpread,
  type Entry,
  type SpreadSide,
} from "./spreadModel";

export * from "./spreadModel";

/**
 * Fill for a `SpreadSide` that isn't a real page at all — the book's binding
 * means one side of a facing pair is sometimes structurally empty (page 1 is
 * always a lone right-hand page, so its facing left is the inside of the
 * front cover; a book with an odd number of leaves ends the same way on the
 * last spread). A diagonal hatch + explicit caption makes it obvious this
 * isn't a blank/undesigned page — there's nothing to add here, ever.
 */
export function DeadPageFill({ aspect, compact = false }: { aspect: number; compact?: boolean }) {
  return (
    <div
      className="flex w-full items-center justify-center bg-ink-50"
      style={{
        aspectRatio: String(aspect),
        backgroundImage:
          "repeating-linear-gradient(135deg, rgba(15,23,42,0.05) 0px, rgba(15,23,42,0.05) 5px, transparent 5px, transparent 13px)",
      }}
    >
      {!compact && (
        <div className="flex flex-col items-center gap-1.5 px-4 text-center">
          <Ban className="size-5 text-ink-300" />
          <span className="text-[11px] font-semibold text-ink-400">No page here</span>
          <span className="max-w-[16ch] text-[10px] leading-snug text-ink-300">
            The printed book doesn&apos;t have a page on this side.
          </span>
        </div>
      )}
    </div>
  );
}

/** One half of the LIVE spread frame: an interactive page, a blank filler, or
 * the book edge. A left page binds on its right edge and a right page on its
 * left edge, so the gutter guide is placed on the inner (facing) side. */
export function HalfFrame({
  side,
  aspect,
  half,
}: {
  side: SpreadSide;
  aspect: number;
  half: "left" | "right";
}) {
  if (side.kind === "page") {
    return (
      <div className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center">
        <PageStagePanel
          page={side.entry.page}
          subject={side.entry.subject}
          chromeless
          fillParent
          bindingSide={half === "left" ? "right" : "left"}
        />
      </div>
    );
  }
  if (side.kind === "edge") {
    return (
      <div className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden">
        <DeadPageFill aspect={aspect} />
      </div>
    );
  }
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center">
      <div className="flex w-full items-center justify-center" style={{ aspectRatio: String(aspect) }}>
        <span className="text-[11px] font-medium text-ink-300">Blank page</span>
      </div>
    </div>
  );
}

/**
 * Static, non-interactive render of one page surface — used by the filmstrip
 * and the read-through preview. Same design layer and illustration as the
 * editor, but no Konva transformers/selection. Still shows the live
 * generation overlay so filmstrip thumbnails reflect in-flight renders.
 */
export function PagePreview({ entry, compact }: { entry: Entry; compact?: boolean }) {
  const { pageDesign, generatingPages, project } = useStudio();
  const page = entry.page;
  const blank = isBlankEntry(entry);
  const coverMode = entry.subject.kind === "cover";
  const url = useBlobUrl(page.blobId);
  const tree = project.illustrations?.[page.id];
  const cursor = tree ? getCursor(tree).content : null;
  const jobActive = useJobsStore((s) => s.activeUnitIds.has(page.id));
  const generating = generatingPages.has(page.id) || jobActive;
  const refCount =
    (entry.subject.kind === "spread" ? entry.subject.spread.anchorIds : entry.subject.cover.anchorIds)
      ?.length ?? 0;
  return (
    <PageStage
      pageDesign={pageDesign(page.id)}
      imageUrl={blank ? undefined : url ?? undefined}
      aspect={page.aspect}
      illustrationFocus={defaultIllustrationFocus(page)}
      editable={false}
      chromeless
      overlay={cursor?.imageTier === "quick" ? <FastDraftBadge compact /> : undefined}
      selectedId={null}
      onSelectElement={() => {}}
      onChangeElement={() => {}}
      artBusy={
        generating && !blank
          ? {
              left: {
                action: coverMode ? "coverIllustration" : "pageIllustration",
                refCount,
                compact: compact ?? true,
                illustrationId: page.id,
              },
            }
          : undefined
      }
    />
  );
}

function PreviewHalfFrame({ side, aspect }: { side: SpreadSide; aspect: number }) {
  if (side.kind === "page") {
    return (
      <div className="relative flex min-w-0 flex-1 items-center justify-center">
        <PagePreview entry={side.entry} />
      </div>
    );
  }
  if (side.kind === "edge") {
    return (
      <div className="relative flex min-w-0 flex-1 items-center justify-center">
        <DeadPageFill aspect={aspect} compact />
      </div>
    );
  }
  return (
    <div className="relative flex min-w-0 flex-1 items-center justify-center">
      <div className="flex w-full items-center justify-center" style={{ aspectRatio: String(aspect) }} />
    </div>
  );
}

/**
 * A cover thumbnail: a single upright cover panel with a printed-spine edge —
 * deliberately NOT the facing-spread look (no fold, no blank facing half), so a
 * cover reads as a cover in the rail. Front binds on the left (spine left), back
 * binds on the right (spine right).
 */
function CoverThumbnail({ disp }: { disp: Extract<DisplaySpread, { kind: "pair" }> }) {
  const side = coverSideOf(disp);
  const spineLeft = disp.cover === "front";
  return (
    <div className="relative flex w-full">
      {spineLeft && <span className="w-1.5 shrink-0 rounded-l bg-linear-to-b from-ink-700 to-ink-900" />}
      <div className="relative min-w-0 flex-1">
        {side && side.kind === "page" ? (
          <PagePreview entry={side.entry} />
        ) : (
          <div className="flex aspect-3/4 w-full items-center justify-center bg-ink-50 text-[10px] font-medium text-ink-300">
            No cover
          </div>
        )}
      </div>
      {!spineLeft && <span className="w-1.5 shrink-0 rounded-r bg-linear-to-b from-ink-700 to-ink-900" />}
    </div>
  );
}

/** Small, static rendering of a whole display spread — the filmstrip's thumbnail. */
export function SpreadThumbnail({ disp }: { disp: DisplaySpread }) {
  if (disp.kind === "full") return <PagePreview entry={disp.entry} />;
  if (disp.cover) return <CoverThumbnail disp={disp} />;
  return (
    <div className="relative flex w-full">
      <PreviewHalfFrame side={disp.left} aspect={sideAspect(disp.left, disp.right)} />
      <PreviewHalfFrame side={disp.right} aspect={sideAspect(disp.left, disp.right)} />
      <div
        className="pointer-events-none absolute inset-y-0 left-1/2 w-3 -translate-x-1/2"
        style={{ background: FOLD_GRADIENT }}
      />
    </div>
  );
}

export type UnitStatus = "empty" | "missing" | "generating" | "stale" | "ready";

export function displayStatusFor(
  disp: DisplaySpread,
  stale: (pageId: string) => boolean,
  generatingPages: Set<string>,
  activeUnitIds: Set<string>,
): UnitStatus {
  const entries = displayEntries(disp)
    .map((e) => e.entry)
    .filter((e) => !isBlankEntry(e));
  if (entries.length === 0) return "empty";
  const ids = entries.map((e) => e.page.id);
  if (ids.some((id) => generatingPages.has(id) || activeUnitIds.has(id))) {
    return "generating";
  }
  if (entries.some((e) => !e.page.blobId)) return "missing";
  if (entries.some((e) => stale(e.page.id))) return "stale";
  return "ready";
}

/** Filtering ignores generation overlays; only missing or stale art needs action. */
export function displayNeedsAttention(
  disp: DisplaySpread,
  stale: (pageId: string) => boolean,
): boolean {
  return displayEntries(disp)
    .map((side) => side.entry)
    .filter((entry) => !isBlankEntry(entry))
    .some((entry) => !entry.page.blobId || stale(entry.page.id));
}

/** Statuses for a whole display list, shared by filtering and status dots. */
export function useDisplayStatuses(
  displays: DisplaySpread[],
  stale: (pageId: string) => boolean,
): Map<string, UnitStatus> {
  const { generatingPages } = useStudio();
  const activeUnitIds = useJobsStore((s) => s.activeUnitIds);
  return useMemo(
    () =>
      new Map(
        displays.map((disp) => [
          disp.id,
          displayStatusFor(disp, stale, generatingPages, activeUnitIds),
        ]),
      ),
    [activeUnitIds, displays, generatingPages, stale],
  );
}

/** Live generation status for one page/cover entry — drives chip badges & dots. */
export function useEntryStatus(entry: Entry, stale: (pageId: string) => boolean): UnitStatus {
  const { generatingPages } = useStudio();
  const id = entry.page.id;
  const jobActive = useJobsStore((s) => s.activeUnitIds.has(id));
  if (isBlankEntry(entry)) return "ready";
  const generating = generatingPages.has(id) || jobActive;
  if (generating) return "generating";
  if (!entry.page.blobId) return "missing";
  if (stale(id)) return "stale";
  return "ready";
}

/** Worst-of status across every live page a display spread shows — for the filmstrip dot. */
export function useDisplayStatus(disp: DisplaySpread, stale: (pageId: string) => boolean): UnitStatus {
  const { generatingPages } = useStudio();
  const activeUnitIds = useJobsStore((s) => s.activeUnitIds);
  return displayStatusFor(disp, stale, generatingPages, activeUnitIds);
}