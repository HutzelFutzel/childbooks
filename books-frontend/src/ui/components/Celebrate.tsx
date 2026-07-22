"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { cn } from "../lib/cn";

export interface CelebrateProps {
  /** Fire the burst. Each rising edge plays once. */
  play: boolean;
  className?: string;
}

interface Particle {
  id: number;
  x: number;
  y: number;
  rotate: number;
  scale: number;
  delay: number;
  color: string;
  glyph: string;
}

const COLORS = [
  "var(--color-brand-500)",
  "var(--color-accent-400)",
  "var(--color-magic-500)",
  "var(--color-brand-300)",
  "var(--color-accent-300)",
];

function makeParticles(): Particle[] {
  return Array.from({ length: 14 }, (_, i) => {
    const angle = (i / 14) * Math.PI * 2 + Math.random() * 0.5;
    const distance = 48 + Math.random() * 56;
    return {
      id: i,
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance - 16,
      rotate: (Math.random() - 0.5) * 240,
      scale: 0.6 + Math.random() * 0.8,
      delay: Math.random() * 0.12,
      color: COLORS[i % COLORS.length],
      glyph: i % 3 === 0 ? "✦" : "●",
    };
  });
}

/**
 * A restrained, fire-once sparkle burst for the product's three peak moments
 * (first character generated, book completed, order placed). Overlay it on a
 * `relative` parent; it is purely decorative and never intercepts pointer events.
 */
export function Celebrate({ play, className }: CelebrateProps) {
  const [burst, setBurst] = useState(0);
  useEffect(() => {
    if (play) setBurst((n) => n + 1);
  }, [play]);

  const particles = useMemo(() => (burst > 0 ? makeParticles() : []), [burst]);
  if (burst === 0) return null;

  return (
    <div
      key={burst}
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 z-10 overflow-visible", className)}
    >
      {particles.map((p) => (
        <motion.span
          key={p.id}
          className="absolute left-1/2 top-1/2 text-sm leading-none"
          style={{ color: p.color }}
          initial={{ x: 0, y: 0, opacity: 1, scale: 0, rotate: 0 }}
          animate={{ x: p.x, y: p.y, opacity: 0, scale: p.scale, rotate: p.rotate }}
          transition={{ duration: 0.9, delay: p.delay, ease: [0.22, 1, 0.36, 1] }}
        >
          {p.glyph}
        </motion.span>
      ))}
    </div>
  );
}
