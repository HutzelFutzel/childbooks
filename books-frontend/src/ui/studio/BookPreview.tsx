/**
 * A read-only "flip through the book as-is" viewer. Renders each facing spread
 * (the same units the editor shows) with the same PageStage used for editing —
 * just non-interactive — so what you preview is exactly what prints and binds.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { PageDesign } from "../../core/types";
import { PageStage } from "../design/PageStage";
import { useBlobUrl } from "../hooks/useBlobUrl";
import { defaultIllustrationFocus, type DesignPage } from "../design/designInit";
import { useStudio } from "./StudioContext";
import type { DisplaySpread, Entry, SpreadSide } from "./SpreadEditor";

const FOLD_GRADIENT =
  "linear-gradient(to right, rgba(15,23,42,0) 0%, rgba(15,23,42,0.12) 42%, rgba(15,23,42,0.2) 50%, rgba(15,23,42,0.12) 58%, rgba(15,23,42,0) 100%)";

export function BookPreview({
  displays,
  onClose,
}: {
  displays: DisplaySpread[];
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState(1);

  const count = displays.length;
  const go = (next: number, d: number) => {
    if (next < 0 || next >= count) return;
    setDir(d);
    setIndex(next);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setIndex((i) => (i < count - 1 ? (setDir(1), i + 1) : i));
      if (e.key === "ArrowLeft") setIndex((i) => (i > 0 ? (setDir(-1), i - 1) : i));
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [count, onClose]);

  const disp = displays[Math.min(index, count - 1)];

  return createPortal(
    <motion.div
      className="fixed inset-0 z-60 flex flex-col bg-ink-900/90 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 py-3 text-white/90">
        <span className="text-sm font-medium">Book preview</span>
        <span className="text-xs text-white/60">{disp?.label}</span>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-white/70 transition hover:bg-white/10 hover:text-white"
          aria-label="Close preview"
        >
          <X className="size-5" />
        </button>
      </div>

      {/* Stage */}
      <div className="flex flex-1 items-center justify-center gap-4 px-4 pb-2">
        <NavArrow dir="left" disabled={index === 0} onClick={() => go(index - 1, -1)} />
        <div className="flex h-full max-h-[78vh] w-full max-w-5xl items-center justify-center">
          {disp && (
            <AnimatePresence mode="wait" custom={dir}>
              <motion.div
                key={disp.id}
                className="w-full"
                custom={dir}
                initial={{ opacity: 0, x: dir * 40, rotateY: dir * 8 }}
                animate={{ opacity: 1, x: 0, rotateY: 0 }}
                exit={{ opacity: 0, x: dir * -40, rotateY: dir * -8 }}
                transition={{ duration: 0.28, ease: "easeOut" }}
              >
                <PreviewSpread disp={disp} />
              </motion.div>
            </AnimatePresence>
          )}
        </div>
        <NavArrow dir="right" disabled={index >= count - 1} onClick={() => go(index + 1, 1)} />
      </div>

      {/* Dots */}
      <div className="flex items-center justify-center gap-1.5 pb-5">
        {displays.map((d, i) => (
          <button
            key={d.id}
            onClick={() => go(i, i > index ? 1 : -1)}
            aria-label={`Go to ${d.label}`}
            className={
              i === index
                ? "h-1.5 w-5 rounded-full bg-white transition-all"
                : "h-1.5 w-1.5 rounded-full bg-white/35 transition-all hover:bg-white/60"
            }
          />
        ))}
      </div>
    </motion.div>,
    document.body,
  );
}

function PreviewSpread({ disp }: { disp: DisplaySpread }) {
  if (disp.kind === "full") {
    return (
      <div className="relative w-full overflow-hidden rounded-xl bg-white shadow-lifted">
        <PreviewPage entry={disp.entry} />
      </div>
    );
  }
  const aspect = sideAspect(disp.left, disp.right);
  return (
    <div className="relative flex w-full overflow-hidden rounded-xl bg-white shadow-lifted">
      <PreviewHalf side={disp.left} aspect={aspect} />
      <PreviewHalf side={disp.right} aspect={aspect} />
      <div
        className="pointer-events-none absolute inset-y-0 left-1/2 w-10 -translate-x-1/2"
        style={{ background: FOLD_GRADIENT }}
      />
    </div>
  );
}

function sideAspect(left: SpreadSide, right: SpreadSide): number {
  const fromPage = (s: SpreadSide) => (s.kind === "page" ? s.entry.page.aspect : undefined);
  return fromPage(left) ?? fromPage(right) ?? 1;
}

function PreviewHalf({ side, aspect }: { side: SpreadSide; aspect: number }) {
  if (side.kind === "page") {
    return (
      <div className="relative min-w-0 flex-1">
        <PreviewPage entry={side.entry} />
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
      onClick={onClick}
      disabled={disabled}
      className="flex size-11 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 disabled:opacity-20"
      aria-label={dir === "left" ? "Previous page" : "Next page"}
    >
      {dir === "left" ? <ChevronLeft className="size-6" /> : <ChevronRight className="size-6" />}
    </button>
  );
}
