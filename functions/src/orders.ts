/**
 * Order persistence — the source of truth for placed print orders.
 *
 * Two records are written per order:
 *   - `users/{uid}/orders/{orderId}` — the NEUTRAL, user-facing record. Readable
 *     by its owner (Firestore rules allow read under `users/{uid}/**`) and used
 *     to power the in-app order history. It deliberately contains NO provider
 *     identity and no raw provider payloads.
 *   - `orders/{orderId}` — the ADMIN/internal record. Denied to all clients (read
 *     only via a `requireAdmin` backend route or the console). Holds the real
 *     provider (e.g. "lulu"), environment, the create request/response and the
 *     full webhook history, for support + debugging.
 *
 * Both are written by the Admin SDK (which bypasses Storage/Firestore rules).
 */
import { randomUUID } from "node:crypto";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { ensureAdmin } from "./storage";
import type {
  FulfillmentOrder,
  OrderDraft,
} from "../../books-frontend/src/core/fulfillment/types";

function db() {
  ensureAdmin();
  return getFirestore();
}

/** Recursively drop `undefined` (Firestore rejects it; we don't enable ignore). */
function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripUndefined(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = stripUndefined(v);
    }
    return out as T;
  }
  return value;
}

/** Pull the provider's status name out of a raw payload, if present. */
function statusNameOf(raw: unknown): string | null {
  if (raw && typeof raw === "object") {
    const status = (raw as { status?: { name?: unknown } }).status;
    if (status && typeof status.name === "string") return status.name;
  }
  return null;
}

/** The neutral recipient view shared by both records. */
function neutralRecipient(draft: OrderDraft) {
  return stripUndefined({
    name: draft.recipient.name,
    email: draft.recipient.email ?? null,
    phone: draft.recipient.phoneNumber ?? null,
    address: draft.recipient.address,
  });
}

/** The create request, minus the (large, binary) print assets. */
function sanitizeDraft(draft: OrderDraft) {
  return stripUndefined({
    productSku: draft.productSku,
    copies: draft.copies,
    recipient: neutralRecipient(draft),
    shippingMethod: draft.shippingMethod,
    destinationCountry: draft.destinationCountry,
    currency: draft.currency,
    merchantReference: draft.merchantReference ?? null,
  });
}

export interface PersistCreatedOrderArgs {
  uid: string;
  /** The real provider backing the order (e.g. "lulu") — admin record only. */
  provider: string;
  /** Provider environment ("sandbox" | "live") — admin record only. */
  env: string;
  draft: OrderDraft;
  order: FulfillmentOrder;
}

/**
 * Write the neutral + admin records for a freshly-created order. Best-effort:
 * the order is already placed with the provider, so callers should not fail the
 * request if persistence throws — just log it.
 */
export async function persistCreatedOrder(args: PersistCreatedOrderArgs): Promise<void> {
  const { uid, provider, env, draft, order } = args;
  const orderId = order.id || `local-${randomUUID()}`;
  const now = FieldValue.serverTimestamp();

  const historyEntry = {
    at: Date.now(),
    stage: order.stage,
    message: order.issues[0] ?? null,
  };

  const userDoc = {
    id: orderId,
    projectId: draft.merchantReference ?? null,
    productSku: draft.productSku,
    copies: draft.copies,
    shippingMethod: draft.shippingMethod,
    recipient: neutralRecipient(draft),
    stage: order.stage,
    statusMessage: order.issues[0] ?? null,
    charges: stripUndefined(order.charges),
    shipments: stripUndefined(order.shipments),
    fileUrls: stripUndefined(order.printFiles ?? {}),
    statusHistory: [historyEntry],
    createdAt: now,
    updatedAt: now,
  };

  const adminDoc = {
    ...userDoc,
    ownerUid: uid,
    provider,
    env,
    providerOrderId: order.id || null,
    statusName: statusNameOf(order.raw),
    createRequest: sanitizeDraft(draft),
    createResponse: (order.raw as Record<string, unknown> | undefined) ?? null,
  };

  await Promise.all([
    db().doc(`orders/${orderId}`).set(adminDoc, { merge: true }),
    db().doc(`users/${uid}/orders/${orderId}`).set(userDoc, { merge: true }),
  ]);
}

/**
 * Apply a provider status update (from a webhook) to a persisted order. Looks up
 * the admin record by provider order id to resolve the owner, then updates both
 * the admin and neutral user records and appends a status-history entry.
 *
 * Returns false when the order isn't one we have on record (so the caller can
 * acknowledge but log it).
 */
export async function applyOrderStatusUpdate(order: FulfillmentOrder): Promise<boolean> {
  if (!order.id) return false;
  const adminRef = db().doc(`orders/${order.id}`);
  const snap = await adminRef.get();
  if (!snap.exists) return false;

  const ownerUid = snap.get("ownerUid") as string | undefined;
  const historyEntry = {
    at: Date.now(),
    stage: order.stage,
    message: order.issues[0] ?? null,
  };

  // Fields safe for the neutral, user-facing record.
  const userUpdate = {
    stage: order.stage,
    statusMessage: order.issues[0] ?? null,
    charges: stripUndefined(order.charges),
    shipments: stripUndefined(order.shipments),
    updatedAt: FieldValue.serverTimestamp(),
    statusHistory: FieldValue.arrayUnion(historyEntry),
  };

  // Admin record additionally keeps the provider status name + raw payload.
  const adminUpdate = {
    ...userUpdate,
    statusName: statusNameOf(order.raw),
    lastWebhookAt: FieldValue.serverTimestamp(),
    lastWebhookRaw: (order.raw as Record<string, unknown> | undefined) ?? null,
  };

  await Promise.all([
    adminRef.set(adminUpdate, { merge: true }),
    ownerUid
      ? db().doc(`users/${ownerUid}/orders/${order.id}`).set(userUpdate, { merge: true })
      : Promise.resolve(),
  ]);
  return true;
}
