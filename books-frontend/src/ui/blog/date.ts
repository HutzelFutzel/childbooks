/** Format an epoch-ms timestamp as a human date, e.g. "Jul 23, 2026". */
export function formatPostDate(ms: number): string {
  try {
    return new Date(ms).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}
