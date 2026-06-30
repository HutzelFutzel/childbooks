/**
 * Public shared-book schema.
 *
 * When a user publishes a book, the studio rasterizes every finished page (the
 * same render path the export uses) and writes a single self-contained document
 * to Firestore at `publishedBooks/{shareId}` with public read access. The SSR
 * preview route reads it directly — no auth, no per-page lookups — so it renders
 * fast and crawlers get real `<meta>`/OpenGraph tags.
 *
 * Page images are public Firebase Storage download URLs (token-bearing), so the
 * preview needs no Storage auth. Nothing here references the owner's private
 * `users/{uid}` space.
 */

/** One rendered page in a published book. */
export interface PublishedPage {
  /** Source page/spread id (cover ids included). */
  id: string;
  label: string;
  /** Public, fetchable image URL of the fully-composited page. */
  url: string;
  /** Aspect ratio width / height of the page surface. */
  aspect: number;
  isCover: boolean;
}

/** A book published for public preview. Stored at `publishedBooks/{shareId}`. */
export interface PublishedBook {
  shareId: string;
  /** Auth uid of the publisher (enforced by security rules on write). */
  ownerUid: string;
  /** Source project id, so re-publishing updates the same share. */
  projectId: string;
  title: string;
  /** Short blurb (story analysis summary), used for the description meta tag. */
  summary?: string;
  /** Front-cover image URL for OpenGraph / hero, if a cover was rendered. */
  coverUrl?: string;
  pages: PublishedPage[];
  /** Number of non-cover content pages. */
  pageCount: number;
  /**
   * Whether the share watermark is suppressed for this book. Denormalized at
   * publish time from the publisher's plan entitlement (`removeWatermark`) so
   * the anonymous SSR viewer never needs to read the owner's private plan.
   */
  watermarkRemoved?: boolean;
  createdAt: number;
  updatedAt: number;
}
