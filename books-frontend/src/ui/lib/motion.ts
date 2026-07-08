/**
 * Shared motion tokens so every animated surface feels like one product.
 * Import these instead of hand-tuning springs/durations per component.
 */
import type { Transition, Variants } from "framer-motion";

/** Snappy spring for interactive feedback (buttons, toggles, taps). */
export const springSnappy: Transition = { type: "spring", stiffness: 420, damping: 34 };

/** Softer spring for entrances / layout shifts (cards, panels). */
export const springSoft: Transition = { type: "spring", stiffness: 320, damping: 30 };

/** Standard eased tween for opacity / small moves. */
export const easeOut: Transition = { duration: 0.22, ease: [0.22, 1, 0.36, 1] };

/** Fade + rise, the default entrance for content blocks. */
export const fadeRise: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: easeOut },
};

/** Stagger container for lists/galleries. */
export const staggerContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05, delayChildren: 0.02 } },
};

/** Pop-in for popovers / menus. */
export const popIn: Variants = {
  hidden: { opacity: 0, y: -6, scale: 0.97 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.14 } },
  exit: { opacity: 0, y: -6, scale: 0.97, transition: { duration: 0.1 } },
};
