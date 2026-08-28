/**
 * Server-side access to the per-format coverage document.
 *
 * Mirrors the split in `markets.ts`: this module owns the document, and
 * `productDiscovery.ts` owns the sweep that fills it. Keeping the two apart is
 * what lets the projection read coverage without pulling in the provider
 * adapter and everything it drags with it.
 *
 * PUBLIC `appConfig/productCapability` — world-readable like its country-level
 * sibling, and written only by the sweep. It carries no cost of ours: the
 * indicative numbers on each cell are the provider's SHIPPING rates for a
 * reference book, which is the same class of data the storefront already gets
 * in the published rate table.
 */
import { getFirestore } from "firebase-admin/firestore";
import {
  createEmptyProductCapability,
  normalizeProductCapability,
  type ProductCapabilityConfig,
} from "../../books-frontend/src/core/config/productCapability";
import { ensureAdmin } from "./storage";

const CAPABILITY_DOC = "appConfig/productCapability";

/** Deep-strip `undefined` (Firestore rejects it). */
function stripUndefined<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export async function getProductCapability(): Promise<ProductCapabilityConfig> {
  ensureAdmin();
  const snap = await getFirestore().doc(CAPABILITY_DOC).get();
  return snap.exists ? normalizeProductCapability(snap.data()) : createEmptyProductCapability();
}

export async function saveProductCapability(
  config: ProductCapabilityConfig,
): Promise<ProductCapabilityConfig> {
  ensureAdmin();
  const value = normalizeProductCapability(config);
  await getFirestore()
    .doc(CAPABILITY_DOC)
    .set(stripUndefined(value) as unknown as Record<string, unknown>, { merge: false });
  return value;
}
