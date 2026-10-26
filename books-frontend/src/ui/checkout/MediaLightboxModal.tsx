"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, type PanInfo } from "framer-motion";
import { ChevronLeft, ChevronRight, Info, X } from "lucide-react";
import type { CatalogPhoto } from "../../core/config/catalogMedia";
import { cn } from "../lib/cn";
import { spring } from "../lib/motion";
import { EASE_OUT } from "./CheckoutKit";

export interface MediaLightboxModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  photos: readonly CatalogPhoto[];
  initialIndex?: number;
}

/** A swipe has to travel this far, or flick this fast, to turn the page. */
const SWIPE_DISTANCE = 70;
const SWIPE_VELOCITY = 450;

const slide = {
  enter: (dir: number) => ({ x: dir * 56, opacity: 0, scale: 0.97 }),
  center: { x: 0, opacity: 1, scale: 1 },
  exit: (dir: number) => ({ x: dir * -56, opacity: 0, scale: 0.97 }),
};

/**
 * Full-size look at the photographs an admin uploaded for a binding, cloth,
 * foil or finish. The picker tiles crop to a fixed frame; this is where the
 * whole picture is shown, uncropped, with every other photo of the same option
 * a swipe, arrow key or thumbnail away.
 */
export function MediaLightboxModal({
  isOpen,
  onClose,
  title,
  subtitle,
  photos,
  initialIndex = 0,
}: MediaLightboxModalProps) {
  const [mounted, setMounted] = useState(false);
  const [index, setIndex] = useState(initialIndex);
  const [dir, setDir] = useState(1);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const count = photos.length;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isOpen) {
      setDir(1);
      setIndex(Math.min(Math.max(0, initialIndex), Math.max(0, count - 1)));
    }
  }, [isOpen, initialIndex, count]);

  const go = useCallback(
    (to: number) => {
      if (count < 2 || to === index) return;
      setDir(to > index ? 1 : -1);
      setIndex(to);
    },
    [count, index],
  );
  const step = useCallback(
    (by: 1 | -1) => {
      if (count < 2) return;
      setDir(by);
      setIndex((i) => (i + by + count) % count);
    },
    [count],
  );

  useEffect(() => {
    if (!isOpen) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      } else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      returnFocus.current?.focus?.({ preventScroll: true });
    };
  }, [isOpen, onClose, step]);

  // Have the neighbours ready, so a swipe lands on a picture rather than a gap.
  useEffect(() => {
    if (!isOpen || count < 2) return;
    for (const offset of [-1, 1]) {
      const near = photos[(index + offset + count) % count];
      if (near) new Image().src = near.imageUrl;
    }
  }, [isOpen, index, count, photos]);

  if (!mounted) return null;

  const current = photos[index] ?? photos[0];
  const hasMultiple = count > 1;

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x < -SWIPE_DISTANCE || info.velocity.x < -SWIPE_VELOCITY) step(1);
    else if (info.offset.x > SWIPE_DISTANCE || info.velocity.x > SWIPE_VELOCITY) step(-1);
  };

  return createPortal(
    <AnimatePresence>
      {isOpen && current && (
        <motion.div
          key="lightbox-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-ink-900/80 p-3 backdrop-blur-md sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label={title}
        >
          <motion.div
            key="lightbox-panel"
            initial={{ opacity: 0, scale: 0.94, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8, transition: { duration: 0.16 } }}
            transition={spring}
            onClick={(e) => e.stopPropagation()}
            className="relative flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-ink-900 text-white shadow-2xl"
          >
            <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <h3 className="truncate font-display text-base font-semibold text-white sm:text-lg">
                  {title}
                </h3>
                {subtitle && <p className="truncate text-xs text-ink-300">{subtitle}</p>}
              </div>
              <div className="flex items-center gap-2">
                {hasMultiple && (
                  <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-medium tabular-nums text-ink-200">
                    {index + 1} / {count}
                  </span>
                )}
                <button
                  ref={closeRef}
                  type="button"
                  onClick={onClose}
                  aria-label="Close photo preview"
                  className="flex size-8 items-center justify-center rounded-full text-ink-300 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>

            <div className="relative flex h-[min(60vh,32rem)] shrink-0 items-center justify-center overflow-hidden bg-black/35 p-2 sm:p-4">
              <AnimatePresence initial={false} custom={dir} mode="popLayout">
                <motion.img
                  key={current.imageUrl}
                  src={current.imageUrl}
                  alt={current.alt || title}
                  custom={dir}
                  variants={slide}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: 0.28, ease: EASE_OUT }}
                  drag={hasMultiple ? "x" : false}
                  dragConstraints={{ left: 0, right: 0 }}
                  dragElastic={0.3}
                  onDragEnd={onDragEnd}
                  draggable={false}
                  className={cn(
                    "max-h-full w-auto max-w-full select-none rounded-xl object-contain shadow-[0_18px_50px_-18px_rgba(0,0,0,0.8)]",
                    hasMultiple && "cursor-grab active:cursor-grabbing",
                  )}
                />
              </AnimatePresence>

              {hasMultiple && (
                <>
                  <button
                    type="button"
                    onClick={() => step(-1)}
                    aria-label="Previous photo"
                    className="absolute left-3 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-ink-900/70 text-white shadow-lg ring-1 ring-white/10 backdrop-blur transition hover:scale-105 hover:bg-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                  >
                    <ChevronLeft className="size-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => step(1)}
                    aria-label="Next photo"
                    className="absolute right-3 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-ink-900/70 text-white shadow-lg ring-1 ring-white/10 backdrop-blur transition hover:scale-105 hover:bg-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                  >
                    <ChevronRight className="size-5" />
                  </button>
                </>
              )}
            </div>

            <div className="p-3 sm:p-4">
              <AnimatePresence mode="wait" initial={false}>
                {(current.caption || current.alt) && (
                  <motion.div
                    key={current.imageUrl}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.16 }}
                    className="flex items-start gap-2 text-xs text-ink-200"
                  >
                    <Info className="mt-0.5 size-3.5 shrink-0 text-brand-400" />
                    <p className="leading-relaxed">{current.caption || current.alt}</p>
                  </motion.div>
                )}
              </AnimatePresence>

              {hasMultiple && (
                <div className="mt-3 flex items-center justify-center gap-2 overflow-x-auto p-1">
                  {photos.map((p, idx) => (
                    <button
                      key={p.storagePath || p.imageUrl}
                      type="button"
                      onClick={() => go(idx)}
                      aria-label={`View photo ${idx + 1}`}
                      aria-current={idx === index ? "true" : undefined}
                      className={cn(
                        "relative size-12 shrink-0 overflow-hidden rounded-lg transition duration-200",
                        idx === index
                          ? "scale-105 ring-2 ring-brand-400 ring-offset-2 ring-offset-ink-900"
                          : "opacity-55 hover:opacity-100",
                      )}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={p.imageUrl}
                        alt=""
                        loading="lazy"
                        draggable={false}
                        className="size-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
