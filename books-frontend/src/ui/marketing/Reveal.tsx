"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";
import { revealHidden, revealTransition, revealVisible } from "../lib/motion";

/**
 * Pop a section into view on scroll using the house `reveal` vocabulary.
 * Honors `prefers-reduced-motion` by rendering statically. Kept tiny so every
 * marketing section can wrap itself.
 */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={revealHidden}
      whileInView={revealVisible}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ ...revealTransition, delay }}
    >
      {children}
    </motion.div>
  );
}
