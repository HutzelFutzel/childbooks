/**
 * Server-side reader for published books.
 *
 * Runs in the App Router (Node) using the isomorphic Firebase client SDK against
 * the public `publishedBooks/{shareId}` collection (public read rules). In dev it
 * talks to the Firestore emulator; in production, the live database.
 */
import { doc, getDoc } from "firebase/firestore";
import { getFirebaseDb } from "../lib/firebase";
import type { PublishedBook } from "../core/share/types";

/** Fetch a published book by share id, or null if missing/unreadable. */
export async function getPublishedBook(shareId: string): Promise<PublishedBook | null> {
  try {
    const snap = await getDoc(doc(getFirebaseDb(), "publishedBooks", shareId));
    return snap.exists() ? (snap.data() as PublishedBook) : null;
  } catch {
    return null;
  }
}
