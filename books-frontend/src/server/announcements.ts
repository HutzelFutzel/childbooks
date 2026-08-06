/**
 * Server-side reader for the marketing announcements config
 * (`appConfig/announcements`).
 *
 * Runs in the App Router (Node) against the public doc so the active banner is
 * available during SSR (no flash before the client store hydrates). Mirrors
 * `server/cookieConfig.ts`.
 */
import { doc, getDoc } from "firebase/firestore";
import { getFirebaseDb } from "../lib/firebase";
import {
  createDefaultAnnouncementsConfig,
  normalizeAnnouncementsConfig,
  type AnnouncementsConfig,
} from "../core/config/announcements";

export async function getAnnouncementsConfig(): Promise<AnnouncementsConfig> {
  try {
    const snap = await getDoc(doc(getFirebaseDb(), "appConfig", "announcements"));
    return normalizeAnnouncementsConfig(snap.exists() ? snap.data() : undefined);
  } catch {
    return createDefaultAnnouncementsConfig();
  }
}
