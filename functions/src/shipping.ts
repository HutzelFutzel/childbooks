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

/** Deep-strip `undefined` (Firestore rejects it). */
function stripUndefined<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * The current policy, seeded when the document doesn't exist.
 *
 * A missing document uses the first-run default. A read failure is allowed to
 * throw: silently offering every speed during a Firestore outage would be a
 * fail-open policy change on a payment path.
 */
export async function getShippingSettings(): Promise<ShippingSettings> {
  ensureAdmin();
  const snap = await getFirestore().doc(PRIVATE_DOC).get();
  return snap.exists ? normalizeShippingSettings(snap.data()) : createDefaultShippingSettings();
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
