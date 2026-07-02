/**
 * Server-side reader for global branding (the share watermark).
 *
 * Runs in the App Router (Node) using the isomorphic Firebase client SDK against
 * the public `appConfig/branding` doc (public read rules), mirroring
 * {@link getPublishedBook}. Returns the watermark or null when none is set.
 */
import { doc, getDoc } from "firebase/firestore";
import { getFirebaseDb } from "../lib/firebase";
import {
  createDefaultBrandingConfig,
  normalizeBrandingConfig,
  type BrandingConfig,
  type BrandingWatermark,
} from "../core/config/branding";

/** Fetch the full branding config, or defaults if unset/unreadable. */
export async function getBrandingConfig(): Promise<BrandingConfig> {
  try {
    const snap = await getDoc(doc(getFirebaseDb(), "appConfig", "branding"));
    return normalizeBrandingConfig(snap.exists() ? snap.data() : undefined);
  } catch {
    return createDefaultBrandingConfig();
  }
}

/** Fetch the configured share watermark, or null if unset/unreadable. */
export async function getBrandingWatermark(): Promise<BrandingWatermark | null> {
  return (await getBrandingConfig()).watermark;
}
