/**
 * The studio's routes.
 *
 * A book lives at `/studio/{bookId}` and the Chat studio derives everything else
 * (where the book is, what it needs next) from the book itself, so the path
 * carries no destination. Older links of the form `/studio/{bookId}/{anything}`
 * still resolve to the book — `canonical: false` tells the shell to rewrite them.
 */

export type StudioRoute =
  | { kind: "library" }
  | {
      kind: "project";
      bookId: string;
      /** False for an old `/studio/{bookId}/{destination}` link, which the shell rewrites. */
      canonical: boolean;
    }
  | { kind: "invalid" };

const BOOK_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function parseStudioPath(pathname: string): StudioRoute {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] !== "studio") return { kind: "invalid" };
  if (segments.length === 1) return { kind: "library" };
  if (segments.length > 3) return { kind: "invalid" };

  let bookId: string;
  try {
    bookId = decodeURIComponent(segments[1]);
  } catch {
    return { kind: "invalid" };
  }
  if (!BOOK_ID.test(bookId)) return { kind: "invalid" };
  return { kind: "project", bookId, canonical: segments.length === 2 };
}

export function studioPath(bookId: string): string {
  return `/studio/${encodeURIComponent(bookId)}`;
}
