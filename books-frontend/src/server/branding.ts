/**
 * Server-side reader for global branding (the share watermark).
 *
 * Runs in the App Router (Node) using the isomorphic Firebase client SDK against
 * the public `appConfig/branding` doc (public read rules), mirroring
 * {@link getPublishedBook}. Returns the watermark or null when none is set.
 */
import { doc, getDoc } from "firebase/firestore";
import { getFirebaseDb } from "../lib/firebase";
import { normalizeBrandingConfig, type BrandingWatermark } from "../core/config/branding";

/** Fetch the configured share watermark, or null if unset/unreadable. */
export async function getBrandingWatermark(): Promise<BrandingWatermark | null> {
  try {
    const snap = await getDoc(doc(getFirebaseDb(), "appConfig", "branding"));
    return normalizeBrandingConfig(snap.exists() ? snap.data() : undefined).watermark;
  } catch {
    return null;
  }
}
