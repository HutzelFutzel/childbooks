/**
 * Where the chat and the book sit, as a pure function of the book and the window.
 *
 * - `centered`: the book has nothing to show; the chat sits in the middle.
 * - `split`: the chat column on the left (26–30rem), the book pane takes the rest.
 * - `focus`: page focus. Only when the pane would drop under ~960px; the spread
 *   grows, the transcript becomes an overlay, the composer docks on the book.
 * - `mobile`: the centered choice before the book exists, then the book with
 *   the composer docked at the bottom and the live choice as a sheet.
 */

export type GuideLayout = "centered" | "split" | "focus" | "mobile";

/** Below this the window is a phone: no side-by-side columns. */
export const GUIDE_MOBILE_MAX = 767;
/** The chat column's width at its widest (30rem). */
export const GUIDE_CHAT_COLUMN_PX = 480;
/** Page focus hides the transcript only when the book would get less than this. */
export const GUIDE_FOCUS_MIN_PANE = 960;

export function guideLayout(args: {
  hasBook: boolean;
  width: number;
  /** The reader opened page focus on a page. */
  focusRequested: boolean;
}): GuideLayout {
  if (args.width <= GUIDE_MOBILE_MAX) return "mobile";
  if (!args.hasBook) return "centered";
  if (args.focusRequested && args.width - GUIDE_CHAT_COLUMN_PX < GUIDE_FOCUS_MIN_PANE) return "focus";
  return "split";
}
