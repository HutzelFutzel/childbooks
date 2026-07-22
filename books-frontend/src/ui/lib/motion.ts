/**
 * The house motion vocabulary — a small, named set of framer-motion variants
 * and transitions reused across the whole app. Nothing outside this file
 * should define its own entrance/pop physics; consuming the shared vocabulary
 * is what makes the product feel crafted instead of animated ad-hoc.
 *
 * Reduced motion: wrap app roots in `<MotionConfig reducedMotion="user">` so
 * every variant here respects the OS preference without per-callsite checks.
 */
import type { TargetAndTransition, Transition, Variants } from "framer-motion";

/** House spring — every interactive pop (buttons, toggles, cards) uses this. */
export const spring: Transition = { type: "spring", stiffness: 380, damping: 26 };

/** Softer spring for larger surfaces sliding in (drawers, panels). */
export const springSoft: Transition = { type: "spring", stiffness: 320, damping: 30 };

/** Fade + small rise, the default entrance for content blocks. */
export const fadeRise: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] } },
};

/** Pop-in for popovers / menus. */
export const popIn: Variants = {
  hidden: { opacity: 0, y: -6, scale: 0.97 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.14 } },
  exit: { opacity: 0, y: -6, scale: 0.97, transition: { duration: 0.1 } },
};

/** Transition for the `reveal` entrance (exported so callers can add delay). */
export const revealTransition: Transition = { type: "spring", stiffness: 260, damping: 22 };

/** The `reveal` targets, typed for direct use in `initial` / `whileInView`. */
export const revealHidden: TargetAndTransition = { opacity: 0, y: 18, scale: 0.98 };
export const revealVisible: TargetAndTransition = { opacity: 1, y: 0, scale: 1 };

/** Storybook pop-up entrance: gentle rise with a hint of overshoot. */
export const reveal: Variants = {
  hidden: revealHidden,
  visible: { ...revealVisible, transition: revealTransition },
};

/**
 * Signature reveal for generated art — the image "dries in" like watercolor.
 * Apply to `motion.img` the first time a generated image appears.
 */
export const paintIn: Variants = {
  hidden: { opacity: 0, scale: 1.04, filter: "blur(14px) saturate(0.55)" },
  visible: {
    opacity: 1,
    scale: 1,
    filter: "blur(0px) saturate(1)",
    transition: { duration: 0.9, ease: [0.22, 1, 0.36, 1] },
  },
};

/** Idle float for hero / empty-state illustration so no screen is fully still. */
export const breathe = {
  animate: { y: [0, -6, 0] },
  transition: { duration: 5, repeat: Infinity, ease: "easeInOut" as const },
};

/** Shared page-turn timing for the flipbook preview (and the share page later). */
export const pageTurn: Transition = { duration: 0.55, ease: [0.4, 0, 0.2, 1] };
