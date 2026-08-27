/**
 * Server-side access to the catalog-wide **shipping policy**.
 *
 * ONE document, `adminSettings/shipping`, private. Unlike markets and the
 * product catalog there is no public mirror: everything a storefront needs from
 * this policy — which speeds reach a country, their labels, what they cost —
 * is resolved into `appConfig/products` by `projectShippingRates` when the
 * catalog is projected. Publishing it twice would give the same question two
 * answers that drift apart the moment one write succeeds and the other doesn't.
 *
 * Every write therefore has to re-project the catalog. That happens in the
 * route (see `admin.ts`) rather than here, so this module doesn't have to
 * import the products module and create a cycle — the same arrangement the
 * plans module already uses.
 */
import { getFirestore } from "firebase-admin/firestore";
import {
  createDefaultShippingSettings,
  normalizeShippingSettings,
  shippingSettingsSchema,
  type ShippingSettings,
} from "../../books-frontend/src/core/config/shipping";
import { ensureAdmin } from "./storage";

const PRIVATE_DOC = "adminSettings/shipping";

const CACHE_TTL_MS = 30_000;
let cache: { value: ShippingSettings; at: number } | null = null;

/** Deep-strip `undefined` (Firestore rejects it). */
function stripUndefined<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * The current policy, seeded when the document doesn't exist.
 *
 * A read failure falls through to the seeded default rather than throwing.
 * That default offers every speed at cost, which is the same thing the catalog
 * did before this document existed — so a transient Firestore error degrades to
 * "sell as before" instead of taking checkout down.
 */
export async function getShippingSettings(): Promise<ShippingSettings> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  ensureAdmin();
  let raw: unknown = undefined;
  try {
    const snap = await getFirestore().doc(PRIVATE_DOC).get();
    raw = snap.exists ? snap.data() : undefined;
  } catch {
    // fall through to the seeded default
  }
  const value = normalizeShippingSettings(raw);
  cache = { value, at: Date.now() };
  return value;
}

export async function saveShippingSettings(
  input: unknown,
  uid?: string,
): Promise<ShippingSettings> {
  ensureAdmin();
  const parsed = shippingSettingsSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`Invalid shipping settings: ${parsed.error.issues[0]?.message ?? "unknown"}`);
  }
  const config = normalizeShippingSettings({
    ...parsed.data,
    updatedAt: Date.now(),
    updatedBy: uid ?? "",
  });
  await getFirestore()
    .doc(PRIVATE_DOC)
    .set(stripUndefined(config) as unknown as Record<string, unknown>, { merge: false });
  cache = { value: config, at: Date.now() };
  return config;
}

/**
 * Write the seeded default when no document exists yet, so the first admin page
 * load shows the policy the catalog is already operating under rather than an
 * empty form implying nothing ships.
 */
export async function ensureShippingSeeded(): Promise<ShippingSettings> {
  ensureAdmin();
  const snap = await getFirestore().doc(PRIVATE_DOC).get();
  if (snap.exists) return getShippingSettings();
  return saveShippingSettings(createDefaultShippingSettings());
}
