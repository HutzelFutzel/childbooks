/**
 * What the guided studio logs besides the sentences a reader types.
 *
 * `guideTurns` records every message the interpreter read, and nothing else: a
 * book answered by tapping options, choosing a card, undoing a change or declining
 * a price leaves no trace there. Those are not edge cases — they are most of what
 * a reader does — and without them the per-book funnel describes people who type
 * and says nothing about people who don't. This is the shared vocabulary for the
 * rest.
 *
 * A closed list on purpose. The route that accepts these is the one place a
 * browser names something that lands in an analysis collection, so an unknown kind
 * is dropped rather than becoming a new column nobody planned. Pure and
 * dependency-free so the client, the route and the report agree on one spelling.
 */

export const GUIDE_EVENT_KINDS = [
  /**
   * A tapped option, card or chip. Never carries the label: it can be a child's
   * name or text the reader pasted. Only whether it was undoable / aimed at a mark.
   */
  "tap",
  /**
   * A typed message that was handled WITHOUT the interpreter — a typed "yes", a
   * pasted manuscript, a sentence about a picture. They leave no turn row, so
   * without this a reader who only ever typed such messages looks silent. `route`
   * says which path took it; the words are never recorded here.
   */
  "typed",
  /** An answer to a question a skill asked. */
  "askAnswer",
  /** A skill's "are you sure" was accepted or declined. */
  "agentConfirm",
  "agentCancel",
  /** A skill run from a button rather than a sentence. */
  "skill",
  /** A question the reader chose not to answer. */
  "skip",
  /** The reader re-sent a message that failed. */
  "retry",
  "undo",
  "redo",
  /** How the book began: guided, own words, … */
  "entry",
  "audience",
  "storyStart",
  /** A price was put in front of the reader. */
  "quoteShown",
  /** …and they paid it. A `quoteShown` with no `paidConfirm` is a declined or ignored price. */
  "paidConfirm",
  /** The order screen was opened. */
  "orderOpened",
  /** Something the reader saw go wrong. */
  "error",
] as const;

export type GuideEventKind = (typeof GUIDE_EVENT_KINDS)[number];

export function isGuideEventKind(value: unknown): value is GuideEventKind {
  return typeof value === "string" && (GUIDE_EVENT_KINDS as readonly string[]).includes(value);
}

/** Detail is flat scalars only: nothing nested, nothing long enough to hold prose. */
export type GuideEventDetail = Record<string, string | number | boolean>;

const MAX_DETAIL_KEYS = 8;
const MAX_KEY = 32;
const MAX_VALUE = 200;

/**
 * Reduce whatever arrived to a safe, small, flat record. Total: any input yields a
 * (possibly empty) record, never a throw, because this runs on the request path of
 * a fire-and-forget beacon and on a client that may send anything.
 */
export function cleanEventDetail(input: unknown): GuideEventDetail {
  const out: GuideEventDetail = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_DETAIL_KEYS) break;
    if (!key || key.length > MAX_KEY) continue;
    if (typeof raw === "string") out[key] = raw.slice(0, MAX_VALUE);
    else if (typeof raw === "number" && Number.isFinite(raw)) out[key] = raw;
    else if (typeof raw === "boolean") out[key] = raw;
  }
  return out;
}
