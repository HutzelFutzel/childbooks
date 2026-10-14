/**
 * Read access to the reader's saved custom art styles and the covers drawn in
 * each look. Both are written only by the backend; the owner reads them live.
 *
 *   users/{uid}/artStyles/{styleId}        the saved style (wording lives in its revisions)
 *   users/{uid}/styleShowcase/{styleKey}   covers drawn in a style, by custom style id or preset id
 */
import { collection, onSnapshot, type Unsubscribe } from "firebase/firestore";
import { getFirebaseDb } from "../lib/firebase";
import type { CustomArtStyle, StyleShowcase } from "../core/config/customArtStyles";

function failed(what: string, err: unknown): void {
  // Previews are decoration: say so in the console, never in the way of drawing.
  console.warn(`[styles] ${what} listener failed — previews will fall back.`, err);
}

export function subscribeCustomStyles(uid: string, cb: (styles: CustomArtStyle[]) => void): Unsubscribe {
  return onSnapshot(
    collection(getFirebaseDb(), `users/${uid}/artStyles`),
    (snap) => cb(snap.docs.map((doc) => doc.data() as CustomArtStyle)),
    (err) => failed("saved styles", err),
  );
}

export function subscribeStyleShowcase(
  uid: string,
  cb: (showcase: Record<string, StyleShowcase>) => void,
): Unsubscribe {
  return onSnapshot(
    collection(getFirebaseDb(), `users/${uid}/styleShowcase`),
    (snap) => cb(Object.fromEntries(snap.docs.map((doc) => [doc.id, doc.data() as StyleShowcase]))),
    (err) => failed("style covers", err),
  );
}
