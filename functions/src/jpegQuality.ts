/**
 * A JPEG quality sharp accepts: an integer from 1 to 100. A fraction (0.85) is
 * read as a share of 100, since sharp throws on it and a thrown error here used
 * to turn into a silently skipped downscale.
 */
export function jpegQuality(value: number): number {
  if (!Number.isFinite(value)) return 80;
  const scaled = value > 0 && value <= 1 ? value * 100 : value;
  return Math.min(100, Math.max(1, Math.round(scaled)));
}
