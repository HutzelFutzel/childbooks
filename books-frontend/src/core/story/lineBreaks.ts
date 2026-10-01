/**
 * A model writing JSON sometimes puts a newline in the string as the two
 * characters `\` and `n`, on top of the escape JSON already parses. The story
 * is valid either way, so one draft shows line breaks and the next shows `\n`.
 * Real newlines are left as they are. One pass is enough: a second would also
 * eat a backslash the author typed in front of a letter n.
 */
export function restoreModelLineBreaks(text: string): string {
  if (!text.includes("\\")) return text;
  return text.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\\r/g, "\n");
}
