/**
 * A short fingerprint of what a page's picture was asked to show.
 *
 * A picture is drawn from "what's happening" on its page. When that text
 * changes afterwards, the picture on the page no longer matches it, and the
 * reader should be told so (and offered the redraw) rather than left to find
 * out. The fingerprint is stored on each drawn picture, so the check is a
 * comparison of two short strings with no model involved.
 *
 * Only the meaning-carrying text counts: spacing, line breaks and capital
 * letters do not make a picture out of date.
 */

function normalized(scene: string): string {
  return scene.replace(/\s+/gu, " ").trim().toLowerCase();
}

/** The fingerprint of a page's "what's happening" text. Empty text has one too. */
export function sceneSignatureOf(scene: string | undefined): string {
  const text = normalized(scene ?? "");
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `sc_${(h >>> 0).toString(36)}_${text.length}`;
}
