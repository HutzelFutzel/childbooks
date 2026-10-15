/**
 * Whether a typed picture change can be made on one subject in place, or is a
 * change to the whole scene.
 *
 * "Make Arthur's hair yellow" belongs to one subject: it can be done where he
 * stands, and the rest of the picture stays. "Make Arthur the same size as
 * Amanda" belongs to the pair: a subject cannot grow inside the box it was
 * drawn in, and the answer depends on the other one. Those redraw the page,
 * from every sheet on it, keeping the scene around them.
 */
import { anchorsNamedIn } from "../book/pageCast";
import type { Anchor } from "../types";

/** Words that compare, place or scale subjects: a change to how they sit together. */
const SCENE_WORDS = new RegExp(
  [
    "same\\s+(?:size|height|scale)",
    "(?:as\\s+)?(?:big|tall|small|short|large)\\s+as",
    "\\b(?:bigger|larger|smaller|taller|shorter|closer|nearer|farther|further)\\b",
    "\\b(?:size|scale|proportion|proportions|height)\\b",
    "swap|switch\\s+places|trade\\s+places|side\\s+by\\s+side",
    "gleich\\s+(?:gro(?:ß|ss)|hoch)|(?:gr(?:ö|oe)(?:ß|ss)er|kleiner)\\b|vertausch\\w*|\\bgr(?:ö|oe)(?:ß|ss)e\\b",
  ].join("|"),
  "iu",
);

/** True when the sentence is about how subjects relate, not about one of them. */
export function changesTheScene(sentence: string, anchors: readonly Anchor[] | undefined): boolean {
  const text = sentence.trim();
  if (!text) return false;
  if (anchorsNamedIn(text, anchors).length >= 2) return true;
  return SCENE_WORDS.test(text);
}
