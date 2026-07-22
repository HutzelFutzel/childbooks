/**
 * Spread-centric data model + presentation primitives for the Studio. The
 * editor always presents the book as facing spreads — never lone narrow
 * pages — so what you see matches the opened, bound result:
 *   - a true double-page spread fills one wide frame;
 *   - two facing single pages sit side by side in one wide frame with a fold;
 *   - a lone page (cover / first page) keeps the wide frame with a blank facing
 *     half, so every unit on screen is the same size.
 *
 * The design stage (`BookCanvas.tsx`) shows exactly ONE display spread at a
 * time, always live/interactive — there is no separate "review" vs "edit"
 * mode. This file supplies the data helpers (`buildDisplaySpreads`,
 * `contentSpreadIds`) plus the small presentational pieces (`HalfFrame` for
 * the live editor, `SpreadThumbnail` for the filmstrip) that both the main
 * stage and the filmstrip share.
 */
import type { ScreenplayDoc } from "../../core/types";
import { COVER_BACK_ID, COVER_FRONT_ID } from "../../core/types";
import { paginate, type PageSlot } from "../../core/pipeline/pagination";
import { useJobsStore } from "../../state/jobsStore";
import { useBlobUrl } from "../hooks/useBlobUrl";
import { PageStage } from "../design/PageStage";
import { GenerationOverlay } from "../generation/GenerationOverlay";
import { defaultIllustrationFocus, type DesignPage } from "../design/designInit";
import { useStudio } from "./StudioContext";
import { PageStagePanel, type PageSubject } from "./PageEditorCard";

export interface Entry {
  page: DesignPage;
  subject: PageSubject;
}

/** Which cover a display spread represents (covers get a distinct treatment). */
export type CoverKind = "front" | "back";

/** One half of a facing spread. */
export type SpreadSide =
  | { kind: "page"; entry: Entry; label: string }
  | { kind: "filler"; label: string }
  | { kind: "edge" };

export type DisplaySpread =
  | { id: string; kind: "full"; label: string; entry: Entry; endInsertIndex: number; cover?: CoverKind }
  | {
      id: string;
      kind: "pair";
      label: string;
      left: SpreadSide;
      right: SpreadSide;
      endInsertIndex: number;
      cover?: CoverKind;
    };

/**
 * The editable (screenplay) spread ids a display unit stands for — covers and
 * blank fillers excluded. Drives drag-and-drop page reordering in the filmstrip.
 */
export function contentSpreadIds(disp: DisplaySpread): string[] {
  if (disp.cover) return [];
  if (disp.kind === "full") return [disp.entry.page.id];
  const ids: string[] = [];
  for (const side of [disp.left, disp.right]) {
    if (side.kind === "page" && side.entry.subject.kind === "spread") ids.push(side.entry.page.id);
  }
  return ids;
}

function sideFromSlot(slot: PageSlot | null, byId: Map<string, Entry>): SpreadSide {
  if (!slot) return { kind: "edge" };
  if (slot.spread.placeholder) return { kind: "filler", label: `Page ${slot.pageNumber}` };
  const entry = byId.get(slot.spread.id);
  return entry
    ? { kind: "page", entry, label: `Page ${slot.pageNumber}` }
    : { kind: "filler", label: `Page ${slot.pageNumber}` };
}

/** Group reading-order entries into facing spreads using physical pagination. */
export function buildDisplaySpreads(doc: ScreenplayDoc, entries: Entry[]): DisplaySpread[] {
  const byId = new Map<string, Entry>();
  for (const e of entries) if (e.subject.kind === "spread") byId.set(e.page.id, e);

  const docIndexById = new Map<string, number>();
  doc.spreads.forEach((s, i) => docIndexById.set(s.id, i));

  const front = entries.find((e) => e.page.id === COVER_FRONT_ID);
  const back = entries.find((e) => e.page.id === COVER_BACK_ID);

  const out: DisplaySpread[] = [];

  if (front) {
    out.push({
      id: "disp-front",
      kind: "pair",
      label: "Front cover",
      cover: "front",
      left: { kind: "edge" },
      right: { kind: "page", entry: front, label: "Front cover" },
      endInsertIndex: 0,
    });
  }

  const pag = paginate(doc);
  for (const pair of pag.pairs) {
    const { left, right } = pair;

    // A true double-page spread occupies both facing slots (same spread ref).
    if (left && right && left.spread === right.spread && left.spread.kind === "spread") {
      const entry = byId.get(left.spread.id);
      if (entry) {
        out.push({
          id: `disp-${left.spread.id}`,
          kind: "full",
          label: `Pages ${left.pageNumber}–${right.pageNumber}`,
          entry,
          endInsertIndex: (docIndexById.get(left.spread.id) ?? doc.spreads.length - 1) + 1,
        });
        continue;
      }
    }

    const leftSide = sideFromSlot(left, byId);
    const rightSide = sideFromSlot(right, byId);
    const trailingId = right?.spread.id ?? left?.spread.id;
    const endInsertIndex =
      trailingId !== undefined ? (docIndexById.get(trailingId) ?? doc.spreads.length - 1) + 1 : 0;

    out.push({
      id: `disp-${left?.pageNumber ?? "x"}-${right?.pageNumber ?? "x"}`,
      kind: "pair",
      label:
        left && right
          ? `Pages ${left.pageNumber}–${right.pageNumber}`
          : `Page ${(left ?? right)!.pageNumber}`,
      left: leftSide,
      right: rightSide,
      endInsertIndex,
    });
  }

  if (back) {
    out.push({
      id: "disp-back",
      kind: "pair",
      label: "Back cover",
      cover: "back",
      left: { kind: "page", entry: back, label: "Back cover" },
      right: { kind: "edge" },
      endInsertIndex: doc.spreads.length,
    });
  }

  return out;
}

export const FOLD_GRADIENT =
  "linear-gradient(to right, rgba(15,23,42,0) 0%, rgba(15,23,42,0.10) 42%, rgba(15,23,42,0.16) 50%, rgba(15,23,42,0.10) 58%, rgba(15,23,42,0) 100%)";

export function sideAspect(left: SpreadSide, right: SpreadSide): number {
  const fromPage = (s: SpreadSide) => (s.kind === "page" ? s.entry.page.aspect : undefined);
  return fromPage(left) ?? fromPage(right) ?? 1;
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
      <div className="relative flex min-w-0 flex-1 items-center justify-center">
        <PageStagePanel
          page={side.entry.page}
          subject={side.entry.subject}
          chromeless
          bindingSide={half === "left" ? "right" : "left"}
        />
      </div>
    );
  }
  return (
    <div className="relative flex min-w-0 flex-1 items-center justify-center">
      <div className="flex w-full items-center justify-center" style={{ aspectRatio: String(aspect) }}>
        {side.kind === "filler" ? (
          <span className="text-[11px] font-medium text-ink-300">Blank page</span>
        ) : null}
      </div>
    </div>
  );
}

export const COVER_META: Record<CoverKind, { title: string; hint: string }> = {
  front: { title: "Front cover", hint: "The first thing readers see — title and headline art." },
  back: { title: "Back cover", hint: "The closing panel — blurb, and the back of the printed book." },
};

/** Pull the cover's page side (front sits on the right, back on the left). */
export function coverSideOf(disp: Extract<DisplaySpread, { kind: "pair" }>): SpreadSide | null {
  if (disp.left.kind === "page") return disp.left;
  if (disp.right.kind === "page") return disp.right;
  return null;
}

/** All live page entries a display unit shows, in reading order. */
export function displayEntries(disp: DisplaySpread): { entry: Entry; label: string }[] {
  if (disp.kind === "full") return [{ entry: disp.entry, label: disp.label }];
  const out: { entry: Entry; label: string }[] = [];
  for (const side of [disp.left, disp.right]) {
    if (side.kind === "page") out.push({ entry: side.entry, label: side.label });
  }
  return out;
}

export function isBlankEntry(entry: Entry): boolean {
  return entry.subject.kind === "spread" && !!entry.subject.spread.blankCanvas;
}

/**
 * Static, non-interactive render of one page surface — used by the filmstrip
 * and the read-through preview. Same design layer and illustration as the
 * editor, but no Konva transformers/selection. Still shows the live
 * generation overlay so filmstrip thumbnails reflect in-flight renders.
 */
export function PagePreview({ entry, compact }: { entry: Entry; compact?: boolean }) {
  const { pageDesign, generatingPages } = useStudio();
  const page = entry.page;
  const blank = isBlankEntry(entry);
  const coverMode = entry.subject.kind === "cover";
  const url = useBlobUrl(page.blobId);
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
      selectedId={null}
      onSelectElement={() => {}}
      onChangeElement={() => {}}
      overlay={
        generating && !blank ? (
          <GenerationOverlay
            action={coverMode ? "coverIllustration" : "pageIllustration"}
            refCount={refCount}
            compact={compact ?? true}
            className="rounded-xl"
          />
        ) : undefined
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
  const entries = displayEntries(disp)
    .map((e) => e.entry)
    .filter((e) => !isBlankEntry(e));
  const ids = entries.map((e) => e.page.id);
  const jobActive = useJobsStore((s) => ids.some((id) => s.activeUnitIds.has(id)));
  if (entries.length === 0) return "empty";
  const generating = jobActive || ids.some((id) => generatingPages.has(id));
  if (generating) return "generating";
  if (entries.some((e) => !e.page.blobId)) return "missing";
  if (entries.some((e) => e.page.blobId && stale(e.page.id))) return "stale";
  return "ready";
}