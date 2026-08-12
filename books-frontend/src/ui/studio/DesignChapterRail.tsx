/**
 * Design left accordion: Style → Cast → Pages.
 * Cast / Pages expand to host their filmstrips; Style has no nested list.
 */
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  ImagePlus,
  LayoutTemplate,
  Loader2,
  Lock,
  Palette,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../lib/cn";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { springSoft } from "../lib/motion";
import type { DesignChapter } from "./studioSteps";

const WIDTH_KEY = "childbooks.designChapterRailWidth";
const WIDTH_MIN = 160;
const WIDTH_MAX = 280;
const WIDTH_DEFAULT = 188;
// Below `md` the resizable desktop width (160–280px) would leave the stage
// with little to no room next to the inspector dock, so it collapses to a
// fixed icon-only rail instead — not user-resizable, so no stored width.
const MOBILE_WIDTH = 96;

function readStoredWidth(): number {
  if (typeof window === "undefined") return WIDTH_DEFAULT;
  const raw = window.localStorage.getItem(WIDTH_KEY);
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return WIDTH_DEFAULT;
  return Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, Math.round(n)));
}

const CHAPTERS: {
  id: DesignChapter;
  label: string;
  hint: string;
  icon: LucideIcon;
}[] = [
  { id: "style", label: "Style", hint: "Art look for the book", icon: Palette },
  { id: "cast", label: "Cast", hint: "Character & place looks", icon: ImagePlus },
  { id: "pages", label: "Pages", hint: "Layout & illustrations", icon: LayoutTemplate },
];

export function DesignChapterRail({
  chapter,
  onSelect,
  styleDone,
  castUnlocked,
  pagesUnlocked,
  castDone,
  pagesDone,
  castDetail,
  pagesDetail,
  busyCast,
  busyPages,
  castHostRef,
  pagesHostRef,
}: {
  chapter: DesignChapter;
  onSelect: (ch: DesignChapter) => void;
  styleDone: boolean;
  castUnlocked: boolean;
  pagesUnlocked: boolean;
  castDone: boolean;
  pagesDone: boolean;
  castDetail?: string;
  pagesDetail?: string;
  busyCast: boolean;
  busyPages: boolean;
  castHostRef: (el: HTMLDivElement | null) => void;
  pagesHostRef: (el: HTMLDivElement | null) => void;
}) {
  const [width, setWidth] = useState(WIDTH_DEFAULT);
  const resizing = useRef<{ startX: number; startW: number } | null>(null);
  const isMobile = useMediaQuery("(max-width: 767px)");

  useEffect(() => {
    setWidth(readStoredWidth());
  }, []);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      if (!resizing.current) return;
      const next = Math.min(
        WIDTH_MAX,
        Math.max(WIDTH_MIN, Math.round(resizing.current.startW + (e.clientX - resizing.current.startX))),
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
      className="relative flex h-full shrink-0 flex-col border-r border-ink-100 bg-white/90"
      style={{ width: isMobile ? MOBILE_WIDTH : width }}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        {CHAPTERS.map((meta) => {
          const unlocked =
            meta.id === "style" ? true : meta.id === "cast" ? castUnlocked : pagesUnlocked;
          const done =
            meta.id === "style" ? styleDone : meta.id === "cast" ? castDone : pagesDone;
          const detail =
            meta.id === "cast" ? castDetail : meta.id === "pages" ? pagesDetail : undefined;
          const busy = meta.id === "cast" ? busyCast : meta.id === "pages" ? busyPages : false;
          const open = chapter === meta.id;
          const Icon = meta.icon;
          const fills = open && meta.id !== "style";

          return (
            <div
              key={meta.id}
              className={cn("flex flex-col border-b border-ink-100", fills && "min-h-0 flex-1")}
            >
              <button
                type="button"
                disabled={!unlocked}
                title={
                  !unlocked
                    ? meta.id === "cast"
                      ? "Pick an art style first"
                      : meta.id === "pages"
                        ? "Finish cast references before designing pages"
                        : meta.hint
                    : isMobile
                      ? meta.label
                      : meta.hint
                }
                onClick={() => unlocked && onSelect(meta.id)}
                aria-expanded={open}
                className={cn(
                  "flex w-full shrink-0 items-center gap-2 px-3 py-2.5 text-left transition",
                  isMobile && "flex-col gap-1 px-1.5 py-2 text-center",
                  open
                    ? "bg-brand-50 text-brand-800"
                    : unlocked
                      ? "text-ink-700 hover:bg-ink-50"
                      : "cursor-not-allowed text-ink-300",
                )}
              >
                <span
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-lg",
                    open
                      ? "bg-brand-100 text-brand-700"
                      : done
                        ? "bg-emerald-100 text-emerald-600"
                        : "bg-ink-100 text-ink-500",
                  )}
                >
                  {busy ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : done && !open ? (
                    <Check className="size-3.5" strokeWidth={3} />
                  ) : !unlocked ? (
                    <Lock className="size-3.5" />
                  ) : (
                    <Icon className="size-3.5" />
                  )}
                </span>
                {isMobile ? (
                  <span className="max-w-full truncate text-[11px] font-semibold leading-tight">
                    {meta.label}
                  </span>
                ) : (
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-sm font-semibold">
                      {meta.label}
                      {detail && (
                        <span
                          className={cn(
                            "rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                            done ? "bg-emerald-100 text-emerald-700" : "bg-ink-100 text-ink-500",
                          )}
                        >
                          {detail}
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-[11px] text-ink-400">{meta.hint}</span>
                  </span>
                )}
              </button>

              {!isMobile && (
                <AnimatePresence initial={false}>
                  {open && meta.id === "style" && (
                    <motion.p
                      key="style-hint"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={springSoft}
                      className="overflow-hidden px-3 pb-3 text-[11px] leading-snug text-ink-400"
                    >
                      Choose the look on the stage.
                    </motion.p>
                  )}
                </AnimatePresence>
              )}

              {open && meta.id === "cast" && (
                <motion.div
                  key="cast-host"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.18 }}
                  className="min-h-0 flex-1"
                >
                  <div ref={castHostRef} className="h-full min-h-0" />
                </motion.div>
              )}
              {open && meta.id === "pages" && (
                <motion.div
                  key="pages-host"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.18 }}
                  className="min-h-0 flex-1"
                >
                  <div ref={pagesHostRef} className="h-full min-h-0" />
                </motion.div>
              )}
            </div>
          );
        })}
      </div>

      {!isMobile && (
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
      )}
    </aside>
  );
}
