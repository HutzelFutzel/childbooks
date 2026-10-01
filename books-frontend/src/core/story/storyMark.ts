/**
 * A passage the reader marked in the story, and the exact span it names.
 *
 * The mark is what "make this nicer" refers to. It is data, not a selection
 * object: it is taken from the manuscript at one moment, stays exactly as it
 * was taken, and is only ever turned into a revision selection against the very
 * story it was taken from.
 *
 *   - Offsets are into the saved `storyText`, computed with the serializer that
 *     wrote it (`serializeStoryBeats`), so a section's trimmed text and its
 *     `### Title` heading cannot skew them.
 *   - `baseHash` names that story. If the story changed in any way since, the
 *     mark is stale and is refused — never re-found by searching for its text,
 *     which would silently pick the wrong sentence when words repeat.
 *   - A mark never widens. It either resolves to its exact span or to nothing.
 */
import { serializeStoryBeats, type StoryBeatItem } from "./beats";
import { storyTextHash, type StoryRevisionSelection } from "./revision";

/** Shorter than this is a slip of the mouse, not a passage. */
export const MARK_MIN_CHARS = 3;
/** A longer mark is the story; ask for the whole story instead. */
export const MARK_MAX_CHARS = 1500;
/** What the thread and the composer show of a mark. */
export const MARK_EXCERPT_CHARS = 120;

export interface StoryMark {
  /** The section the text was marked in. */
  beatId: string;
  /** Offsets into the saved story text; `end` is exclusive. */
  start: number;
  end: number;
  /** Exactly `storyText.slice(start, end)`, trimmed at both ends. */
  text: string;
  /** `storyTextHash` of the story the offsets belong to. */
  baseHash: string;
}

/** A private-use pair that cannot occur in a story, to find where a section's text sits. */
const SENTINEL = "\uE000mark\uE001";

/**
 * Turn a textarea selection inside one section into a mark.
 *
 * Returns null unless the editor and the saved story agree (the section list
 * serializes to exactly `storyText`), the selection holds a real passage, and
 * the computed span reads back identically. Anything less and there is no mark:
 * a missing mark is a nuisance, a wrong one edits the wrong words.
 */
export function storyMarkFromSelection(input: {
  beats: readonly StoryBeatItem[];
  beatIndex: number;
  /** `selectionStart` / `selectionEnd` of the section's textarea. */
  selectionStart: number;
  selectionEnd: number;
  storyText: string;
}): StoryMark | null {
  const { beats, beatIndex, selectionStart, selectionEnd, storyText } = input;
  const beat = beats[beatIndex];
  if (!beat || selectionEnd <= selectionStart) return null;
  if (serializeStoryBeats([...beats]) !== storyText) return null;

  // Where this section's text begins in the saved story, by the serializer itself.
  const probe = serializeStoryBeats(beats.map((b, i) => (i === beatIndex ? { ...b, text: SENTINEL } : b)));
  const at = probe.indexOf(SENTINEL);
  if (at < 0) return null;

  // The serializer trims a section's text; the textarea shows it untrimmed.
  const leading = beat.text.length - beat.text.trimStart().length;
  const trimmed = beat.text.trim();
  const from = Math.max(0, Math.min(trimmed.length, selectionStart - leading));
  const to = Math.max(0, Math.min(trimmed.length, selectionEnd - leading));
  if (to <= from) return null;

  // Whitespace around the passage is not part of it.
  const raw = trimmed.slice(from, to);
  const skipped = raw.length - raw.trimStart().length;
  const text = raw.trim();
  if (text.length < MARK_MIN_CHARS || text.length > MARK_MAX_CHARS) return null;
  if (!/[\p{L}\p{N}]/u.test(text)) return null;

  const start = at + from + skipped;
  const end = start + text.length;
  if (storyText.slice(start, end) !== text) return null;
  return { beatId: beat.id, start, end, text, baseHash: storyTextHash(storyText) };
}

/**
 * The revision selection for a mark, or null when the story is no longer the
 * one it was taken from. The caller says so; it does not fall back to the
 * whole story.
 */
export function selectionForMark(mark: StoryMark, storyText: string): StoryRevisionSelection | null {
  if (storyTextHash(storyText) !== mark.baseHash) return null;
  if (storyText.slice(mark.start, mark.end) !== mark.text) return null;
  return { start: mark.start, end: mark.end, text: mark.text };
}

/** The short form shown in the composer and the thread. */
export function markExcerpt(text: string, max = MARK_EXCERPT_CHARS): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}
