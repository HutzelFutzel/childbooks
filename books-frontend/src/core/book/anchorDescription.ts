/**
 * The description is of somebody else: it names this person as their own
 * relative ("Arthur's twin sister" is the sister, not Arthur). A story told in
 * the first person makes a model do this, and the portrait then draws the
 * wrong person. Descriptions stay in English, so the check does too.
 */
export function describesSomeoneElse(name: string, description: string): boolean {
  const who = name.trim();
  const text = description.trim();
  if (!who || !text) return false;
  const escaped = who.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const relative =
    "(?:(?:twin|little|older|younger|big|baby)\\s+){0,2}(?:sisters?|brothers?|siblings?|mothers?|moms?|fathers?|dads?|parents?|daughters?|sons?|grandmothers?|grandmas?|grandfathers?|grandpas?|aunts?|uncles?|cousins?|wives|husbands?)";
  const ownRelative = new RegExp(`\\b${escaped}(?:'s|’s)\\s+${relative}\\b`, "i");
  if (ownRelative.test(text)) return true;
  const relativeOf = new RegExp(`\\b${relative}\\s+of\\s+${escaped}\\b`, "i");
  return relativeOf.test(text);
}

/** The look to hand an image model. A description of someone else is left out. */
export function visualDescription(name: string, description: string | undefined): string {
  const text = description?.trim() ?? "";
  return text && !describesSomeoneElse(name, text) ? text : "";
}

/** Keep numeric age exclusively in Anchor.ageYears, even when a model repeats it. */
export function stripNumericAgeFromDescription(description: string): string {
  return description
    .replace(
      /\s+\b(?:is|was)\s+\d+(?:\.\d+)?\s*[-–—]?\s*years?\s*[-–—]?\s*old\s+and\s+/gi,
      " ",
    )
    .replace(
      /,\s*(?:aged?\s*[:–—-]?\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*[-–—]?\s*years?\s*[-–—]?\s*old)\s*,/gi,
      " ",
    )
    .replace(
      /\s+\b(?:is|was)\s+\d+(?:\.\d+)?\s*[-–—]?\s*years?\s*[-–—]?\s*old(?=[,.;]|$)/gi,
      "",
    )
    .replace(/\b\d+(?:\.\d+)?\s*[-–—]?\s*years?\s*[-–—]?\s*old\b/gi, "")
    .replace(/\b\d+(?:\.\d+)?\s+years?\s+of\s+age\b/gi, "")
    .replace(/\baged?\s*[:–—-]?\s*\d+(?:\.\d+)?\b/gi, "")
    .replace(/\bage\s*[:–—-]\s*\d+(?:\.\d+)?\b/gi, "")
    .replace(/\(\s*[,;:–—-]?\s*\)/g, "")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/([,;:])(?:\s*\1)+/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}
