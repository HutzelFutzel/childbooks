/**
 * Server-side reader for the landing-page illustrations (`appConfig/siteImages`).
 *
 * Runs in the App Router (Node) using the isomorphic Firebase client SDK against
 * the public doc (public read rules), mirroring {@link getBrandingConfig}. Used
 * so the landing page can render admin-uploaded art during SSR (good LCP + SEO).
 */
import { doc, getDoc } from "firebase/firestore";
import { getFirebaseDb } from "../lib/firebase";
import {
  createDefaultSiteImagesConfig,
  normalizeSiteImagesConfig,
  type SiteImagesConfig,
} from "../core/config/siteImages";
import { cachedServerRead } from "./cachedRead";

export const getSiteImagesConfig = cachedServerRead(
  "appConfig/siteImages",
  async (): Promise<SiteImagesConfig> => {
    try {
      const snap = await getDoc(doc(getFirebaseDb(), "appConfig", "siteImages"));
      return normalizeSiteImagesConfig(snap.exists() ? snap.data() : undefined);
    } catch {
      return createDefaultSiteImagesConfig();
    }
  },
);
