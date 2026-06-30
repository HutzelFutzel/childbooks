/**
 * Publishing wiring for public shared-book previews (client side).
 *
 * Rasterized page images are uploaded to a world-readable Storage path
 * (`public/books/{shareId}/…`) and the assembled {@link PublishedBook} document
 * is written to `publishedBooks/{shareId}` (public read; owner-only write). The
 * SSR preview route reads that document directly.
 */
import { doc, setDoc } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { getFirebaseDb, getFirebaseStorage } from "../lib/firebase";
import type { PublishedBook } from "../core/share/types";

/** A short, URL-friendly share id. */
export function newShareId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  const stamp = Date.now().toString(36).slice(-4);
  return `${stamp}${rand}`;
}

/** Sanitize a page id into a safe storage object name. */
function safeName(pageId: string): string {
  return pageId.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "page";
}

/**
 * Upload one rendered page image and return its public download URL.
 * The token-bearing URL is fetchable without auth, which is what the public
 * preview needs. Objects live under the owner's namespace
 * (`public/books/{ownerUid}/{shareId}/…`) so Storage rules can scope writes to
 * the owner and stop anyone overwriting another user's published preview.
 */
export async function uploadPreviewImage(
  ownerUid: string,
  shareId: string,
  pageId: string,
  blob: Blob,
): Promise<string> {
  const object = ref(
    getFirebaseStorage(),
    `public/books/${ownerUid}/${shareId}/${safeName(pageId)}.png`,
  );
  await uploadBytes(object, blob, { contentType: blob.type || "image/png" });
  return getDownloadURL(object);
}

/** Write (or overwrite) the published-book document. */
export async function savePublishedBook(book: PublishedBook): Promise<void> {
  await setDoc(doc(getFirebaseDb(), "publishedBooks", book.shareId), book);
}
