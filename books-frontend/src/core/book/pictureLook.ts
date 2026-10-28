/**
 * A character drawn from a picture looks like that picture on every page.
 *
 * In a book with a cast, every named person gets a portrait before the book is
 * drawn, and their reference sheet is drawn from it. The written description a
 * story reading produced for them was invented from the words alone (hair,
 * eyes, an outfit), so it can only disagree with the picture, and an image
 * model shown both follows the words. These keep such words out of the page
 * plan and out of the page prompt, so the picture decides.
 */
import type { Anchor } from "../types";

/**
 * Whether a character's look comes from a picture that no words were read
 * from: a cast member (their portrait) or one carrying the portrait already.
 * A look read from the reader's own drawing (`lookFromArt`) is that picture in
 * words, so it still describes them.
 */
export function looksFromPicture(anchor: Pick<Anchor, "type" | "castId" | "sourceArt" | "lookFromArt">): boolean {
  if (anchor.type !== "character") return false;
  if (anchor.lookFromArt?.trim()) return false;
  return Boolean(anchor.castId) || (anchor.sourceArt ?? []).some((image) => image.origin === "portrait");
}

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The brief without the looks it spells out in brackets after a name: "Amira
 * (curly side buns, teal overalls) waves" becomes "Amira waves", and "Papa's
 * (olive henley) hand" becomes "Papa's hand". Only for the names given.
 */
export function withoutLookAsides(text: string, names: readonly string[]): string {
  let out = text;
  for (const name of new Set(names.map((n) => n.trim()).filter(Boolean))) {
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(${escaped(name)}(?:'s|’s)?)\\s*\\([^()]*\\)`, "giu");
    out = out.replace(pattern, "$1");
  }
  return out === text ? text : out.replace(/ {2,}/g, " ").replace(/\s+([,.;:!?])/g, "$1");
}

/** Every name a character goes by, for {@link withoutLookAsides}. */
export function namesOf(anchors: readonly Pick<Anchor, "name" | "aliasNames">[]): string[] {
  return anchors.flatMap((anchor) => [anchor.name, ...(anchor.aliasNames ?? [])]);
}

const NOT_GARMENTS = new Set(["and", "with", "the", "her", "his", "their", "wears", "wearing", "under", "over", "she", "who"]);

function garmentWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 3 && !NOT_GARMENTS.has(word));
}

/**
 * Whether a page's "outfit change" only repeats the character's stored
 * signature look ("peach t-shirt under teal overalls" for someone described in
 * those clothes). That is not a change: it would put the invented outfit back
 * over the one in their reference.
 */
export function restatesLook(outfit: string, description: string | undefined): boolean {
  const own = new Set(garmentWords(description ?? ""));
  const said = garmentWords(outfit);
  if (own.size === 0 || said.length === 0) return false;
  return said.filter((word) => own.has(word)).length / said.length >= 0.6;
}
