/**
 * Server-side reader for the public subscription plans.
 *
 * Reads the world-readable `appConfig/plans` projection (no Stripe internals) so
 * the landing page can render pricing in the server HTML — good for SEO and for
 * emitting Product/Offer structured data — mirroring {@link getSeoConfig}.
 */
import { doc, getDoc } from "firebase/firestore";
import { getFirebaseDb } from "../lib/firebase";
import { normalizePublicPlansConfig, type PublicPlansConfig } from "../core/config/plans";

/** Fetch the public plans config, or an empty config when unset/unreadable. */
export async function getPublicPlans(): Promise<PublicPlansConfig> {
  try {
    const snap = await getDoc(doc(getFirebaseDb(), "appConfig", "plans"));
    return normalizePublicPlansConfig(snap.exists() ? snap.data() : undefined);
  } catch {
    return { version: 1, plans: [] };
  }
}
