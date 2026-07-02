/**
 * Server-side reader for the landing-page copy overrides (`appConfig/siteContent`).
 *
 * Runs in the App Router (Node) using the isomorphic Firebase client SDK against
 * the public doc (public read rules). Returns the override map so the landing
 * page renders the final copy during SSR (no layout shift; SEO sees real text).
 */
import { doc, getDoc } from "firebase/firestore";
import { getFirebaseDb } from "../lib/firebase";
import {
  createDefaultSiteContentConfig,
  normalizeSiteContentConfig,
  type SiteContentConfig,
} from "../core/config/siteContent";

export async function getSiteContentConfig(): Promise<SiteContentConfig> {
  try {
    const snap = await getDoc(doc(getFirebaseDb(), "appConfig", "siteContent"));
    return normalizeSiteContentConfig(snap.exists() ? snap.data() : undefined);
  } catch {
    return createDefaultSiteContentConfig();
  }
}
