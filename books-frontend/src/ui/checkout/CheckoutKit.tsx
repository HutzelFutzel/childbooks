"use client";

/**
 * Small motion primitives shared by the checkout screens. They exist so every
 * transition on the page speaks the same language (the easing and durations
 * below) instead of each block inventing its own.
 *
 * Reduced motion is handled app-wide by `<MotionConfig reducedMotion="user">`;
 * the one primitive that doesn't go through framer (the price tween) checks the
 * preference itself.
 */
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { animate, AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { cn } from "../lib/cn";

/** Decelerating "settle" curve, the same one the house `fadeRise` uses. */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/** Fade + rise on mount, optionally staggered with `delay` (seconds). */
export function Enter({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: EASE_OUT, delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/**
 * Height-animated mount/unmount for a block that appears and disappears (a
 * warning, an optional field). Put it directly inside `<AnimatePresence>`.
 *
 * `stacked` animates the top margin too, for blocks inside a column whose
 * siblings are spaced with `[&>*+*]:mt-5`: otherwise the 20px of spacing pops in
 * at once while the block itself is still zero high.
 */
export function Collapse({
  children,
  className,
  stacked = false,
}: {
  children: ReactNode;
  className?: string;
  stacked?: boolean;
}) {
  const open = { height: "auto", opacity: 1, ...(stacked ? { marginTop: "1.25rem" } : {}) };
  const shut = { height: 0, opacity: 0, ...(stacked ? { marginTop: 0 } : {}) };
  return (
    <motion.div
      initial={{ ...shut, overflow: "hidden" }}
      animate={{ ...open, transitionEnd: { overflow: "visible" } }}
      exit={{ ...shut, overflow: "hidden" }}
      transition={{ duration: 0.3, ease: EASE_OUT }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/**
 * A piece of text that rolls to its next value: the old one lifts away, the new
 * one rises into place. For labels that change as the customer chooses.
 */
export function AnimatedSwap({
  value,
  className,
}: {
  value: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("relative inline-flex max-w-full overflow-hidden align-bottom", className)}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={typeof value === "string" || typeof value === "number" ? String(value) : "node"}
          initial={{ y: "70%", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: "-70%", opacity: 0 }}
          transition={{ duration: 0.22, ease: EASE_OUT }}
          className="block truncate"
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export function formatMoney(amount: number, currency: string, signed = false): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      ...(signed ? { signDisplay: "exceptZero" as const } : {}),
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/**
 * A price that counts to its new value instead of jumping. The digits are
 * written straight to the DOM on each frame — a total that updates while typing
 * an address shouldn't re-render the page sixty times a second.
 */
export function AnimatedMoney({
  value,
  currency,
  signed,
  className,
}: {
  value: number;
  currency: string;
  signed?: boolean;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const write = (n: number) => {
      el.textContent = formatMoney(n, currency, signed);
    };
    const from = shown.current;
    if (from == null || reduce || from === value) {
      shown.current = value;
      write(value);
      return;
    }
    const controls = animate(from, value, {
      duration: 0.6,
      ease: EASE_OUT,
      onUpdate: (n) => {
        shown.current = n;
        write(n);
      },
      onComplete: () => {
        shown.current = value;
        write(value);
      },
    });
    return () => controls.stop();
  }, [value, currency, signed, reduce]);

  return <span ref={ref} suppressHydrationWarning className={cn("tabular-nums", className)} />;
}
