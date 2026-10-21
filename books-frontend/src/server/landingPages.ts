/**
 * Server-side readers for the public landing pages.
 *
 * Runs in the App Router (Node) using the isomorphic Firebase client SDK,
 * mirroring `server/blog.ts`. The routing decision, sitemap, footer links and
 * `hreflang` all read the tiny world-readable projection
 * (`appConfig/landingPagesIndex`); a page itself reads its full
 * `landingPages/{locale}__{slug}` doc, which Firestore rules expose only while
 * it is published. Every reader degrades to empty/null on error so rendering
 * never throws — an unreadable page is a 404, not a 500.
 */
import { cache } from "react";
import { doc, getDoc } from "firebase/firestore";
import { getFirebaseDb } from "../lib/firebase";
import { DEFAULT_LOCALE } from "../core/i18n/locales";
import { publishedLocales } from "../core/i18n/publish";
import {
  createDefaultLandingIndex,
  landingDocId,
  landingFooterLinks,
  normalizeLandingIndex,
  normalizeLandingPage,
  type LandingLink,
  type LandingPage,
  type LandingPagesIndex,
} from "../core/config/landingPages";
import { cachedServerRead } from "./cachedRead";

/** Published + retired pages (the routing projection). */
export const getLandingIndex = cachedServerRead(
  "appConfig/landingPagesIndex",
  async (): Promise<LandingPagesIndex> => {
    try {
      const snap = await getDoc(doc(getFirebaseDb(), "appConfig", "landingPagesIndex"));
      return normalizeLandingIndex(snap.exists() ? snap.data() : undefined);
    } catch {
      return createDefaultLandingIndex();
    }
  },
);

/** A published page, or null when missing, draft, retired or unreadable. */
export const getLandingPage = cache(
  async (locale: string, slug: string): Promise<LandingPage | null> => {
    try {
      const snap = await getDoc(doc(getFirebaseDb(), "landingPages", landingDocId(locale, slug)));
      if (!snap.exists()) return null;
      const page = normalizeLandingPage(snap.data());
      return page.status === "published" ? page : null;
    } catch {
      return null;
    }
  },
);

/** Footer links to the live pages, so a new page is never an orphan. */
export const getLandingFooterLinks = cache(async (): Promise<LandingLink[]> => {
  const index = await getLandingIndex();
  return landingFooterLinks(index, DEFAULT_LOCALE, publishedLocales());
});
