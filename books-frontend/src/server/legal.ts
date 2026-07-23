/**
 * Server-side reader for the legal documents config (`appConfig/legal`).
 *
 * Runs in the App Router (Node) using the isomorphic Firebase client SDK against
 * the public doc, mirroring `server/siteContent.ts`. Returns the normalized
 * config so the landing page (footer) renders the final links during SSR.
 */
import { doc, getDoc } from "firebase/firestore";
import { getFirebaseDb } from "../lib/firebase";
import {
  createDefaultLegalConfig,
  normalizeLegalConfig,
  type LegalConfig,
} from "../core/config/legal";

export async function getLegalConfig(): Promise<LegalConfig> {
  try {
    const snap = await getDoc(doc(getFirebaseDb(), "appConfig", "legal"));
    return normalizeLegalConfig(snap.exists() ? snap.data() : undefined);
  } catch {
    return createDefaultLegalConfig();
  }
}
