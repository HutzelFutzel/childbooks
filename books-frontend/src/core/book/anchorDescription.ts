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
