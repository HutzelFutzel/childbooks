/**
 * How full a book's stored document is.
 *
 * A book is stored as one document with a hard size limit. Nothing is wrong while it is small, so the
 * point is to see it coming: log when a book first crosses a quarter of the way up, and what is big
 * in it, long before a save can fail.
 */
import type { Project } from "../types";

/** The most a stored book may be (Firestore's 1 MiB per document, with room for the key and field names). */
export const STORED_BOOK_LIMIT_BYTES = 1_048_000;

/** Fractions of the limit worth a log line the first time a book reaches them in a session. */
export const SIZE_LEVELS = [0.5, 0.75, 0.9] as const;
export type SizeLevel = (typeof SIZE_LEVELS)[number];

/** The highest level `bytes` has reached, or null below the first. */
export function sizeLevelOf(bytes: number, limit: number = STORED_BOOK_LIMIT_BYTES): SizeLevel | null {
  const ratio = bytes / limit;
  let level: SizeLevel | null = null;
  for (const step of SIZE_LEVELS) if (ratio >= step) level = step;
  return level;
}

/**
 * Remembers the highest level each book has been reported at, so a book is reported once per level,
 * and only on the way up (a book that shrinks and grows again is not reported twice).
 */
export function createSizeWatch(limit: number = STORED_BOOK_LIMIT_BYTES) {
  const reported = new Map<string, number>();
  return {
    /** The level to report now, or null when this size is nothing new. */
    observe(projectId: string, bytes: number): SizeLevel | null {
      const level = sizeLevelOf(bytes, limit);
      if (level === null) return null;
      const seen = reported.get(projectId) ?? 0;
      if (level <= seen) return null;
      reported.set(projectId, level);
      return level;
    },
  };
}

/** The largest top-level parts of a book, by serialized length (characters), biggest first. */
export function biggestParts(project: Project, count = 6): { part: string; chars: number }[] {
  const sizes: { part: string; chars: number }[] = [];
  for (const [part, value] of Object.entries(project as unknown as Record<string, unknown>)) {
    if (value === undefined) continue;
    let chars = 0;
    try {
      chars = JSON.stringify(value)?.length ?? 0;
    } catch {
      chars = 0;
    }
    sizes.push({ part, chars });
  }
  return sizes.sort((a, b) => b.chars - a.chars).slice(0, count);
}
