/**
 * Server-side reader for the cookie consent config (`appConfig/cookieConfig`).
 *
 * Runs in the App Router (Node) against the public doc so the banner copy +
 * consent version are available during SSR (no flash before the client store
 * hydrates). Mirrors `server/siteContent.ts`.
 */
import { doc, getDoc } from "firebase/firestore";
import { getFirebaseDb } from "../lib/firebase";
import {
  createDefaultCookieConfig,
  normalizeCookieConfig,
  type CookieConfig,
} from "../core/config/cookieConfig";

export async function getCookieConfig(): Promise<CookieConfig> {
  try {
    const snap = await getDoc(doc(getFirebaseDb(), "appConfig", "cookieConfig"));
    return normalizeCookieConfig(snap.exists() ? snap.data() : undefined);
  } catch {
    return createDefaultCookieConfig();
  }
}
