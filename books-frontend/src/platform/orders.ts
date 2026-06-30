/**
 * Client access to a user's placed print orders.
 *
 * Orders live under `users/{uid}/orders/{orderId}` — the NEUTRAL, provider-
 * agnostic record written by the backend when an order is placed and updated by
 * the provider's status webhook. Firestore rules make these readable by their
 * owner only; the client never writes them. We sort newest-first on the client
 * (rather than `orderBy`) so freshly-placed orders whose `createdAt` server
 * timestamp hasn't resolved yet still appear immediately.
 */
import { collection, onSnapshot, type Unsubscribe } from "firebase/firestore";
import { getFirebaseAuth, getFirebaseDb } from "../lib/firebase";
import type {
  Address,
  Money,
  OrderRecord,
  OrderStage,
  OrderStatusEntry,
  ShipmentInfo,
  ShippingMethod,
} from "../core/fulfillment/types";

/** Normalize a Firestore Timestamp | number | null to epoch ms (or null). */
function toMs(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return value;
  if (typeof value === "object" && typeof (value as { toMillis?: unknown }).toMillis === "function") {
    try {
      return (value as { toMillis: () => number }).toMillis();
    } catch {
      return null;
    }
  }
  return null;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function mapAddress(value: unknown): Address {
  const a = (value ?? {}) as Record<string, unknown>;
  return {
    line1: asString(a.line1),
    line2: typeof a.line2 === "string" ? a.line2 : undefined,
    townOrCity: asString(a.townOrCity),
    stateOrCounty: typeof a.stateOrCounty === "string" ? a.stateOrCounty : undefined,
    postalOrZipCode: asString(a.postalOrZipCode),
    countryCode: asString(a.countryCode),
  };
}

function mapMoneyList(value: unknown): Money[] {
  if (!Array.isArray(value)) return [];
  return value.map((m) => {
    const r = (m ?? {}) as Record<string, unknown>;
    return { amount: asString(r.amount, "0"), currency: asString(r.currency, "USD") };
  });
}

function mapShipments(value: unknown): ShipmentInfo[] {
  if (!Array.isArray(value)) return [];
  return value.map((s) => {
    const r = (s ?? {}) as Record<string, unknown>;
    return {
      carrier: typeof r.carrier === "string" ? r.carrier : undefined,
      service: typeof r.service === "string" ? r.service : undefined,
      status: typeof r.status === "string" ? r.status : undefined,
      trackingUrl: typeof r.trackingUrl === "string" ? r.trackingUrl : undefined,
      trackingNumber: typeof r.trackingNumber === "string" ? r.trackingNumber : undefined,
    };
  });
}

function mapHistory(value: unknown): OrderStatusEntry[] {
  if (!Array.isArray(value)) return [];
  return value.map((h) => {
    const r = (h ?? {}) as Record<string, unknown>;
    return {
      at: typeof r.at === "number" ? r.at : (toMs(r.at) ?? 0),
      stage: asString(r.stage, "draft") as OrderStage,
      message: asStringOrNull(r.message),
    };
  });
}

function mapOrder(id: string, data: Record<string, unknown>): OrderRecord {
  const files = (data.fileUrls ?? {}) as Record<string, unknown>;
  const recipient = (data.recipient ?? {}) as Record<string, unknown>;
  return {
    id: asString(data.id, id),
    projectId: asStringOrNull(data.projectId),
    productSku: asString(data.productSku),
    copies: typeof data.copies === "number" ? data.copies : 1,
    shippingMethod: asString(data.shippingMethod, "Standard") as ShippingMethod,
    recipient: {
      name: asString(recipient.name),
      email: asStringOrNull(recipient.email),
      phone: asStringOrNull(recipient.phone),
      address: mapAddress(recipient.address),
    },
    stage: asString(data.stage, "draft") as OrderStage,
    statusMessage: asStringOrNull(data.statusMessage),
    charges: mapMoneyList(data.charges),
    shipments: mapShipments(data.shipments),
    fileUrls: {
      interior: typeof files.interior === "string" ? files.interior : undefined,
      cover: typeof files.cover === "string" ? files.cover : undefined,
    },
    statusHistory: mapHistory(data.statusHistory),
    createdAt: toMs(data.createdAt),
    updatedAt: toMs(data.updatedAt),
  };
}

/**
 * Subscribe to the signed-in user's orders, newest-first. The callback fires on
 * every change. Returns a no-op unsubscribe (and an empty list) when signed out.
 */
export function subscribeUserOrders(cb: (orders: OrderRecord[]) => void): Unsubscribe {
  const uid = getFirebaseAuth().currentUser?.uid;
  if (!uid) {
    cb([]);
    return () => {};
  }
  const col = collection(getFirebaseDb(), `users/${uid}/orders`);
  return onSnapshot(
    col,
    (snap) => {
      const list = snap.docs.map((d) => mapOrder(d.id, d.data() as Record<string, unknown>));
      list.sort((a, b) => (b.createdAt ?? Number.POSITIVE_INFINITY) - (a.createdAt ?? Number.POSITIVE_INFINITY));
      cb(list);
    },
    () => cb([]),
  );
}
