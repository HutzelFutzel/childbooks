/**
 * Serialize structured data for a `<script type="application/ld+json">` tag.
 *
 * `JSON.stringify` alone isn't safe to inline in HTML: a string containing
 * `</script>` ends the tag and what follows is parsed as markup. Escaping `<`
 * (and the two line separators that break some parsers) keeps the output valid
 * JSON with the same value, so a headline or FAQ answer can never break out of
 * the script element, whoever wrote it.
 */
export function jsonLdHtml(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
