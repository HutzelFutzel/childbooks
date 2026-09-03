/**
 * A read-only "flip through the book as-is" viewer. Renders each facing spread
 * (the same units the editor shows) with the same PageStage used for editing —
 * just non-interactive — so what you preview is exactly what prints and binds.
 */
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { BookOpen, ChevronLeft, ChevronRight, X } from "lucide-react";
import type { PageDesign } from "../../core/types";
import { PageStage } from "../design/PageStage";
import { useBlobUrl } from "../hooks/useBlobUrl";
import { defaultIllustrationFocus, type DesignPage } from "../design/designInit";
import { cn } from "../lib/cn";
import { useStudio } from "./StudioContext";
import {
  COVER_META,
  coverSideOf,
  DeadPageFill,
  sideAspect,
  type DisplaySpread,
  type Entry,
  type SpreadSide,
} from "./SpreadEditor";

const FOLD_GRADIENT =
  "linear-gradient(to right, rgba(15,23,42,0) 0%, rgba(15,23,42,0.12) 42%, rgba(15,23,42,0.2) 50%, rgba(15,23,42,0.12) 58%, rgba(15,23,42,0) 100%)";

export function BookPreview({
  displays,
  startId,
  onClose,
}: {
  displays: DisplaySpread[];
  startId?: string | null;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(() => {
    const initial = startId ? displays.findIndex((disp) => disp.id === startId) : -1;
    return initial >= 0 ? initial : 0;
  });
  const [dir, setDir] = useState(1);
  const rootRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const reduceMotion = useReducedMotion();

  const count = displays.length;
  const go = (next: number, d: number) => {
    if (next < 0 || next >= count) return;
    setDir(d);
    setIndex(next);
  };

  useEffect(() => {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setIndex((i) => (i < count - 1 ? (setDir(1), i + 1) : i));
      if (e.key === "ArrowLeft") setIndex((i) => (i > 0 ? (setDir(-1), i - 1) : i));
      if (e.key === "Tab") {
        const focusable = Array.from(
          rootRef.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled), [href], [tabindex]:not([tabindex='-1'])",
          ) ?? [],
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      returnFocusRef.current?.focus();
    };
  }, [count, onClose]);

  const disp = displays[Math.min(index, count - 1)];

  return createPortal(
    <motion.div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-60 flex flex-col bg-ink-900/90 backdrop-blur-sm"
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 py-3 text-white/90">
        <div className="flex items-center gap-2.5">
          <span id={titleId} className="text-sm font-medium">Book preview</span>
          {disp?.cover && (
            <span className="rounded-md border border-brand-400/30 bg-brand-500/20 px-2 py-0.5 text-[11px] font-medium text-brand-200">
              {disp.cover === "front" ? "Front cover" : "Back cover"}
            </span>
          )}
        </div>
        <span className="text-xs text-white/60" aria-live="polite">{disp?.label}</span>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="flex size-11 items-center justify-center rounded-lg text-white/70 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          aria-label="Close preview"
        >
          <X className="size-5" />
        </button>
      </div>

      {/* Stage */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center gap-4 px-2 pb-2 sm:px-4">
        <div className="hidden sm:block">
          <NavArrow dir="left" disabled={index === 0} onClick={() => go(index - 1, -1)} />
        </div>
        <div className="flex h-full max-h-[78vh] w-full max-w-5xl items-center justify-center">
          {disp && (
            <AnimatePresence mode="wait" custom={dir}>
              <motion.div
                key={disp.id}
                className="flex w-full items-center justify-center"
                custom={dir}
                initial={
                  reduceMotion ? { opacity: 0 } : { opacity: 0, x: dir * 40, rotateY: dir * 8 }
                }
                animate={{ opacity: 1, x: 0, rotateY: 0 }}
                exit={
                  reduceMotion ? { opacity: 0 } : { opacity: 0, x: dir * -40, rotateY: dir * -8 }
                }
                transition={{ duration: reduceMotion ? 0.08 : 0.28, ease: "easeOut" }}
              >
                <PreviewSpread disp={disp} />
              </motion.div>
            </AnimatePresence>
          )}
        </div>
        <div className="hidden sm:block">
          <NavArrow dir="right" disabled={index >= count - 1} onClick={() => go(index + 1, 1)} />
        </div>
        <div className="pointer-events-none absolute inset-x-2 top-1/2 flex -translate-y-1/2 justify-between sm:hidden">
          <div className="pointer-events-auto">
            <NavArrow dir="left" disabled={index === 0} onClick={() => go(index - 1, -1)} />
          </div>
          <div className="pointer-events-auto">
            <NavArrow
              dir="right"
              disabled={index >= count - 1}
              onClick={() => go(index + 1, 1)}
            />
          </div>
        </div>
      </div>

      {/* Dots */}
      <div className="flex max-w-full items-center justify-start gap-1 overflow-x-auto px-4 pb-4 sm:justify-center sm:pb-5">
        {displays.map((d, i) => (
          <button
            key={d.id}
            type="button"
            onClick={() => go(i, i > index ? 1 : -1)}
            aria-label={`Go to ${d.label}`}
            title={d.label}
            aria-current={i === index ? "page" : undefined}
            className="flex size-6 shrink-0 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <span
              className={cn(
                "transition-all",
                i === index
                  ? "h-1.5 w-4 rounded-full bg-white"
                  : "size-1.5 rounded-full bg-white/35 hover:bg-white/60",
                d.cover && i !== index && "bg-brand-300/50 hover:bg-brand-300/80",
              )}
            />
          </button>
        ))}
      </div>
    </motion.div>,
    document.body,
  );
}

function PreviewCover({ disp }: { disp: DisplaySpread }) {
  const isFront = disp.cover === "front";
  const side = disp.kind === "pair" ? coverSideOf(disp) : null;
  const entry =
    side && side.kind === "page" ? side.entry : disp.kind === "full" ? disp.entry : null;
  const meta = disp.cover ? COVER_META[disp.cover] : null;
  const aspect = entry?.page.aspect ?? 1;

  return (
    <div className="relative flex w-full items-center justify-center">
      {/* Closed-book cover presentation sized to exactly one page (50% width of the spread) so height matches page spreads */}
      <div
        className={cn(
          "relative w-1/2 overflow-hidden bg-white shadow-lifted transition-all",
          isFront ? "rounded-r-xs rounded-l-sm" : "rounded-l-xs rounded-r-sm",
        )}
      >
        {entry ? (
          <PreviewPage entry={entry} />
        ) : (
          <div
            className="flex w-full flex-col items-center justify-center gap-2 bg-ink-900/60 p-8 text-center text-white"
            style={{ aspectRatio: String(aspect) }}
          >
            <BookOpen className="size-8 text-white/40" />
            <span className="text-sm font-semibold text-white/80">{meta?.title ?? "Cover"}</span>
            <span className="text-xs text-white/50">No cover artwork yet</span>
          </div>
        )}

        {/* Tactile spine and book-edge treatment */}
        {isFront ? (
          <>
            {/* Left bound spine crease shadow */}
            <div
              className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-linear-to-r from-black/35 via-black/12 to-transparent"
              aria-hidden="true"
            />
            {/* Subtle spine hinge highlight */}
            <div
              className="pointer-events-none absolute inset-y-0 left-3 w-px bg-white/20"
              aria-hidden="true"
            />
            {/* Right page trim edge */}
            <div
              className="pointer-events-none absolute inset-y-0 right-0 w-2 bg-linear-to-l from-black/15 to-transparent"
              aria-hidden="true"
            />
          </>
        ) : (
          <>
            {/* Right bound spine crease shadow */}
            <div
              className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-linear-to-l from-black/35 via-black/12 to-transparent"
              aria-hidden="true"
            />
            {/* Subtle spine hinge highlight */}
            <div
              className="pointer-events-none absolute inset-y-0 right-3 w-px bg-white/20"
              aria-hidden="true"
            />
            {/* Left page trim edge */}
            <div
              className="pointer-events-none absolute inset-y-0 left-0 w-2 bg-linear-to-r from-black/15 to-transparent"
              aria-hidden="true"
            />
          </>
        )}
      </div>
    </div>
  );
}

function PreviewSpread({ disp }: { disp: DisplaySpread }) {
  if (disp.cover) {
    return <PreviewCover disp={disp} />;
  }
  if (disp.kind === "full") {
    return (
      <div className="relative w-full overflow-hidden bg-white shadow-lifted">
        <PreviewPage entry={disp.entry} />
      </div>
    );
  }
  const aspect = sideAspect(disp.left, disp.right);
  return (
    <div className="relative flex w-full overflow-hidden bg-white shadow-lifted">
      <PreviewHalf side={disp.left} aspect={aspect} />
      <PreviewHalf side={disp.right} aspect={aspect} />
      <div
        className="pointer-events-none absolute inset-y-0 left-1/2 w-10 -translate-x-1/2"
        style={{ background: FOLD_GRADIENT }}
      />
    </div>
  );
}

function PreviewHalf({ side, aspect }: { side: SpreadSide; aspect: number }) {
  if (side.kind === "page") {
    return (
      <div className="relative min-w-0 flex-1">
        <PreviewPage entry={side.entry} />
      </div>
    );
  }
  if (side.kind === "edge") {
    return (
      <div className="relative flex min-w-0 flex-1 items-center justify-center">
        <DeadPageFill aspect={aspect} />
      </div>
    );
  }
  return (
    <div className="relative flex min-w-0 flex-1 items-center justify-center bg-ink-50">
      <div style={{ aspectRatio: String(aspect), width: "100%" }} />
    </div>
  );
}

function PreviewPage({ entry }: { entry: Entry }) {
  const { design } = useStudio();
  const pd: PageDesign = design.pages[entry.page.id] ?? { textBoxes: [] };
  return <PreviewSurface page={entry.page} pd={pd} />;
}

function PreviewSurface({ page, pd }: { page: DesignPage; pd: PageDesign }) {
  const url = useBlobUrl(page.blobId);
  return (
    <PageStage
      pageDesign={pd}
      imageUrl={url ?? undefined}
      aspect={page.aspect}
      illustrationFocus={defaultIllustrationFocus(page)}
      editable={false}
      chromeless
      selectedId={null}
      onSelectElement={() => {}}
      onChangeElement={() => {}}
    />
  );
}

function NavArrow({
  dir,
  disabled,
  onClick,
}: {
  dir: "left" | "right";
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex size-11 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-20"
      aria-label={dir === "left" ? "Previous page" : "Next page"}
    >
      {dir === "left" ? <ChevronLeft className="size-6" /> : <ChevronRight className="size-6" />}
    </button>
  );
}
