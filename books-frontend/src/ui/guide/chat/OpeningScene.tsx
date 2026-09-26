"use client";

import { motion, useReducedMotion } from "framer-motion";

/**
 * A quiet invitation, not another choice. The empty book is the only object on
 * the opening screen besides the conversation, so it explains what is being made
 * without asking the reader to understand the studio first.
 */
export function OpeningScene() {
  const reduced = useReducedMotion();
  return (
    <div aria-hidden className="flex min-h-32 flex-1 items-end justify-center overflow-hidden px-8 pt-8 pb-3 sm:min-h-44">
      <motion.div
        initial={reduced ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="relative h-28 w-56 sm:h-32 sm:w-64"
      >
        <span className="absolute right-5 bottom-1 left-5 h-7 rounded-[50%] bg-ink-900/8 blur-xl" />

        <span className="absolute top-0 left-7 size-1.5 rotate-45 rounded-[1px] bg-magic-400/70" />
        <span className="absolute top-5 right-4 size-2 rotate-45 rounded-xs bg-ink-300" />
        <span className="absolute top-1 right-16 size-1 rounded-full bg-ink-300" />

        <div className="absolute inset-x-3 bottom-3 flex h-22 items-stretch justify-center sm:h-25">
          <div className="relative w-1/2 origin-bottom-right -skew-y-3 overflow-hidden rounded-l-[18px] rounded-r-[3px] border border-ink-900/8 bg-white shadow-[-8px_12px_24px_-16px_rgba(15,23,42,0.35)]">
            <span className="absolute inset-y-0 right-0 w-5 bg-linear-to-l from-ink-100/80 to-transparent" />
            <span className="absolute top-7 right-7 left-8 h-px rounded-full bg-ink-100" />
            <span className="absolute top-11 right-10 left-6 h-px rounded-full bg-ink-100" />
            <span className="absolute top-15 right-6 left-10 h-px rounded-full bg-ink-100" />
          </div>
          <div className="relative w-1/2 origin-bottom-left skew-y-3 overflow-hidden rounded-r-[18px] rounded-l-[3px] border border-ink-900/8 bg-white shadow-[8px_12px_24px_-16px_rgba(15,23,42,0.35)]">
            <span className="absolute inset-y-0 left-0 w-5 bg-linear-to-r from-ink-100/80 to-transparent" />
            <span className="absolute top-7 right-8 left-7 h-px rounded-full bg-ink-100" />
            <span className="absolute top-11 right-6 left-10 h-px rounded-full bg-ink-100" />
            <span className="absolute top-15 right-11 left-6 h-px rounded-full bg-ink-100" />
            <span className="absolute -bottom-1 left-7 h-8 w-2 -rotate-3 rounded-t-sm bg-ink-800" />
          </div>
          <span className="absolute top-1 bottom-0 left-1/2 w-px -translate-x-1/2 bg-ink-900/12" />
        </div>
      </motion.div>
    </div>
  );
}
