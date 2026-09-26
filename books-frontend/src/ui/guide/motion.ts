/**
 * Motion for the Chat studio. Quick, modern and quiet: motion explains a
 * change of place, size or presence and nothing bounces.
 *
 * Reduced motion is handled at the studio root (`MotionConfig
 * reducedMotion="user"`): transforms are dropped and the same change plays as
 * a fade, which is "without the travel". The violet trace checks it directly
 * because it is a stroke animation, not a transform.
 */
import type { Transition, Variants } from "framer-motion";

const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** A new line rises about 8px and fades in, about 200ms. */
export const lineRise: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.2, ease: EASE_OUT } },
};

/** The chat centering, the book arriving, the column settling left. */
export const layoutMove: Transition = { type: "tween", duration: 0.42, ease: EASE_OUT };

/** A view changing aspect. */
export const frameMove: Transition = { type: "tween", duration: 0.25, ease: EASE_OUT };

/** A new picture landing over the old one. */
export const crossfade: Transition = { duration: 0.35, ease: "easeOut" };

/** A well appearing above the field. */
export const wellIn: Variants = {
  hidden: { opacity: 0, y: 6, height: 0 },
  show: { opacity: 1, y: 0, height: "auto", transition: { duration: 0.22, ease: EASE_OUT } },
  exit: { opacity: 0, y: 4, height: 0, transition: { duration: 0.16, ease: "easeIn" } },
};

/** The book pane arriving from the right. */
export const paneIn: Variants = {
  hidden: { opacity: 0, x: 24 },
  show: { opacity: 1, x: 0, transition: layoutMove },
  exit: { opacity: 0, x: 24, transition: { duration: 0.2 } },
};

/** The one violet trace around the composer ring when work starts. */
export const traceDuration = 1.4;
