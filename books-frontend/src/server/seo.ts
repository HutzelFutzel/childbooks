/**
 * Server-side reader for the marketing SEO config.
 *
 * Runs in the App Router (Node) using the isomorphic Firebase client SDK against
 * the public `appConfig/seo` doc (public read rules), mirroring
 * {@link getBrandingWatermark}. Always returns a fully-normalized config,
 * falling back to sensible defaults when the doc is missing/unreadable — so
 * `generateMetadata`, `sitemap` and `robots` never throw.
 */
import { doc, getDoc } from "firebase/firestore";
import { getFirebaseDb } from "../lib/firebase";
import { createDefaultSeoConfig, normalizeSeoConfig, type SeoConfig } from "../core/config/seo";

/** Fetch the marketing SEO config, or defaults when unset/unreadable. */
export async function getSeoConfig(): Promise<SeoConfig> {
  try {
    const snap = await getDoc(doc(getFirebaseDb(), "appConfig", "seo"));
    return normalizeSeoConfig(snap.exists() ? snap.data() : undefined);
  } catch {
    return createDefaultSeoConfig();
  }
}
