/**
 * Whether a message is a finished manuscript, a request to write one, a brief,
 * or something that could be either.
 *
 * This runs before the interpreter. A pasted story must be saved exactly and
 * must never be sent through story drafting. A short brief still goes to the
 * guide. Anything in between waits for the reader to say which it is.
 */

export type OpeningTextKind = "manuscript" | "ownIntent" | "brief" | "ambiguous";

const OWN_INTENT =
  /\b(my own words|i(?:'ll| will) write|i wrote|i(?:'ve| have) written|paste (?:my |the )?story|here(?:'s| is) my story|use my story)\b/i;

const NARRATIVE =
  /\b(once upon|chapter\s+\d+|the end)\b|["“][^"”]{8,}["”]/i;

function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Classify text that arrives before a manuscript exists. */
export function classifyOpeningText(text: string): OpeningTextKind {
  const trimmed = text.trim();
  const count = words(trimmed).length;
  const blocks = paragraphs(trimmed);
  const sentences = trimmed.split(/[.!?]+/).filter((part) => part.trim().length > 12).length;
  const narrative = NARRATIVE.test(trimmed);

  const manuscript =
    (blocks.length >= 2 && sentences >= 2) ||
    (count >= 120 && sentences >= 3) ||
    (count >= 80 && narrative);

  if (manuscript) return "manuscript";
  if (count <= 40 && OWN_INTENT.test(trimmed) && sentences < 3) return "ownIntent";
  if (count < 80 && !narrative) return "brief";
  return "ambiguous";
}
