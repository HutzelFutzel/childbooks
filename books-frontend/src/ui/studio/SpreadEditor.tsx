/**
 * Spread-centric rendering for the Studio. The editor always presents the book
 * as facing spreads — never lone narrow pages — so what you see matches the
 * opened, bound result:
 *   - a true double-page spread fills one wide frame;
 *   - two facing single pages sit side by side in one wide frame with a fold;
 *   - a lone page (cover / first page) keeps the wide frame with a blank facing
 *     half, so every unit on screen is the same size.
 */
import { motion } from "framer-motion";
import { BookmarkCheck, BookOpenText } from "lucide-react";
import type { Anchor, ScreenplayDoc } from "../../core/types";
import { COVER_BACK_ID, COVER_FRONT_ID } from "../../core/types";
import { paginate, type PageSlot } from "../../core/pipeline/pagination";
import { cn } from "../lib/cn";
import type { DesignPage } from "../design/designInit";
import { PageControls, PageStagePanel, type PageSubject } from "./PageEditorCard";

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

const FOLD_GRADIENT =
  "linear-gradient(to right, rgba(15,23,42,0) 0%, rgba(15,23,42,0.10) 42%, rgba(15,23,42,0.16) 50%, rgba(15,23,42,0.10) 58%, rgba(15,23,42,0) 100%)";

function sideAspect(left: SpreadSide, right: SpreadSide): number {
  const fromPage = (s: SpreadSide) => (s.kind === "page" ? s.entry.page.aspect : undefined);
  return fromPage(left) ?? fromPage(right) ?? 1;
}

/** One half of the spread frame: a live page, a blank filler, or the book edge. */
function HalfFrame({ side, aspect }: { side: SpreadSide; aspect: number }) {
  if (side.kind === "page") {
    return (
      <div className="relative flex min-w-0 flex-1 items-center justify-center">
        <PageStagePanel page={side.entry.page} subject={side.entry.subject} chromeless />
      </div>
    );
  }
  return (
    <div className="relative flex min-w-0 flex-1 items-center justify-center">
      <div
        className="flex w-full items-center justify-center"
        style={{ aspectRatio: String(aspect) }}
      >
        {side.kind === "filler" ? (
          <span className="text-[11px] font-medium text-ink-300">Blank page</span>
        ) : null}
      </div>
    </div>
  );
}

const COVER_META: Record<CoverKind, { title: string; hint: string; icon: typeof BookOpenText }> = {
  front: {
    title: "Front cover",
    hint: "The first thing readers see — title and headline art.",
    icon: BookOpenText,
  },
  back: {
    title: "Back cover",
    hint: "The closing panel — blurb, and the back of the printed book.",
    icon: BookmarkCheck,
  },
};

/** Pull the cover's page side (front sits on the right, back on the left). */
function coverSideOf(disp: Extract<DisplaySpread, { kind: "pair" }>): SpreadSide | null {
  if (disp.left.kind === "page") return disp.left;
  if (disp.right.kind === "page") return disp.right;
  return null;
}

/** A single spread unit: header, the wide page frame, and per-page controls. */
export function SpreadCard({
  disp,
  anchors,
  stale,
}: {
  disp: DisplaySpread;
  anchors: Anchor[];
  /** Whether a given page id needs a reference refresh. */
  stale: (pageId: string) => boolean;
}) {
  // Covers get a distinct, standalone presentation so they read clearly as the
  // book's front/back — not as just another interior page.
  if (disp.cover && disp.kind === "pair") {
    const side = coverSideOf(disp);
    const meta = COVER_META[disp.cover];
    const Icon = meta.icon;
    return (
      <motion.div
        layout
        className="overflow-hidden rounded-3xl bg-linear-to-b from-brand-50/70 to-white shadow-soft ring-2 ring-brand-200"
      >
        <div className="flex items-center gap-3 border-b border-brand-100/80 px-4 py-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white shadow-soft">
            <Icon className="size-5" />
          </span>
          <div className="min-w-0 leading-tight">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-ink-900">{meta.title}</span>
              <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand-700">
                Cover
              </span>
            </div>
            <span className="text-[11px] text-ink-500">{meta.hint}</span>
          </div>
        </div>

        <div className="space-y-4 p-4">
          {side && side.kind === "page" ? (
            <>
              <div className="mx-auto w-full max-w-sm">
                <div className="relative overflow-hidden rounded-xl bg-white shadow-lifted ring-1 ring-brand-200">
                  <PageStagePanel page={side.entry.page} subject={side.entry.subject} chromeless />
                  <span className="pointer-events-none absolute left-2 top-2 rounded-md bg-ink-900/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white backdrop-blur-sm">
                    {meta.title}
                  </span>
                </div>
              </div>
              <div className="mx-auto w-full max-w-sm">
                <PageControls
                  page={side.entry.page}
                  subject={side.entry.subject}
                  anchors={anchors}
                  stale={stale(side.entry.page.id)}
                  label={meta.title}
                />
              </div>
            </>
          ) : (
            <p className="py-8 text-center text-sm text-ink-400">No {meta.title.toLowerCase()} yet.</p>
          )}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div layout className="overflow-hidden rounded-3xl bg-white ring-1 ring-ink-100 shadow-soft">
      <div className="flex items-center gap-2 border-b border-ink-100 px-4 py-2.5">
        <span className="text-sm font-semibold text-ink-800">{disp.label}</span>
      </div>

      <div className="space-y-4 p-4">
        {disp.kind === "full" ? (
          <>
            <div className="relative mx-auto w-full overflow-hidden rounded-xl bg-white shadow-soft ring-1 ring-ink-200">
              <PageStagePanel page={disp.entry.page} subject={disp.entry.subject} chromeless />
            </div>
            <PageControls
              page={disp.entry.page}
              subject={disp.entry.subject}
              anchors={anchors}
              stale={stale(disp.entry.page.id)}
              label={disp.label}
            />
          </>
        ) : (
          <>
            <div className="relative mx-auto flex w-full overflow-hidden rounded-xl bg-white shadow-soft ring-1 ring-ink-200">
              <HalfFrame side={disp.left} aspect={sideAspect(disp.left, disp.right)} />
              <HalfFrame side={disp.right} aspect={sideAspect(disp.left, disp.right)} />
              <div
                className="pointer-events-none absolute inset-y-0 left-1/2 w-10 -translate-x-1/2"
                style={{ background: FOLD_GRADIENT }}
              />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <SideControls side={disp.left} anchors={anchors} stale={stale} />
              <SideControls side={disp.right} anchors={anchors} stale={stale} />
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}

function SideControls({
  side,
  anchors,
  stale,
}: {
  side: SpreadSide;
  anchors: Anchor[];
  stale: (pageId: string) => boolean;
}) {
  if (side.kind === "page") {
    return (
      <PageControls
        page={side.entry.page}
        subject={side.entry.subject}
        anchors={anchors}
        stale={stale(side.entry.page.id)}
        label={side.label}
      />
    );
  }
  if (side.kind === "filler") {
    return (
      <div className="flex flex-col gap-1 rounded-xl border border-dashed border-ink-200 p-3 text-xs text-ink-400">
        <span className="font-medium text-ink-500">{side.label} · Blank</span>
        <span>Inserted so the facing spread prints correctly. Turn it into a page from the “+”.</span>
      </div>
    );
  }
  return <div className="hidden lg:block" aria-hidden />;
}
