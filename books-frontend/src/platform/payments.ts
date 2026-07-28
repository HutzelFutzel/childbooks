/**
 * Client access to Stripe payments + the user's payment history.
 *
 * Checkout is server-authoritative: the browser sends the order draft (incl. the
 * rendered print files as base64) to `/checkout`; the backend prices it, uploads
 * the files, creates a Stripe Checkout Session, and returns its hosted URL. We
 * redirect there. Fulfillment happens only AFTER Stripe confirms payment (via a
 * webhook), so the client never places an unpaid order.
 *
 * Payment records live under `users/{uid}/payments/{paymentId}` — the NEUTRAL,
 * owner-readable record written by the backend (and updated from Stripe webhooks).
 */
import { collection, onSnapshot, type Unsubscribe } from "firebase/firestore";
import { getFirebaseAuth, getFirebaseDb } from "../lib/firebase";
import { backendFetch } from "./backend";
import type {
  AddressValidation,
  OrderDraft,
  PrintAsset,
  ShippingMethod,
} from "../core/fulfillment/types";
import type { VariantSelection } from "../core/config/variants";

export type PaymentStatus =
  | "pending"
  | "paid"
  | "failed"
  | "refunded"
  | "partially_refunded";

/**
 * How far a paid print order has got towards the press. Written by the backend
 * after payment, because placement happens in a webhook and can fail with the
 * money already taken — "paid" on its own can't tell that story.
 */
export type FulfillmentState = "pending" | "placed" | "retrying" | "failed";

export interface UserPaymentRecord {
  id: string;
  kind: "order" | "subscription" | "sparkPack" | "sparkGift" | "ebook";
  status: PaymentStatus;
  amount: number;
  currency: string;
  description: string;
  items: { label: string; amount: number; quantity: number }[];
  receiptUrl: string | null;
  refundedAmount: number;
  orderId: string | null;
  /** Print orders only; null for every other kind of purchase. */
  fulfillmentState: FulfillmentState | null;
  /** A customer-facing explanation, set only when there's something to say. */
  fulfillmentIssue: string | null;
  createdAt: number | null;
  updatedAt: number | null;
}

interface WireAsset {
  printArea: string;
  base64: string;
  contentType?: string;
  pageCount?: number;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function assetToWire(asset: PrintAsset): Promise<WireAsset> {
  const bytes = new Uint8Array(await asset.blob.arrayBuffer());
  return {
    printArea: asset.printArea,
    pageCount: asset.pageCount,
    contentType: asset.blob.type || "application/octet-stream",
    base64: bytesToBase64(bytes),
  };
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body?.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

export interface CheckoutInput {
  draft: OrderDraft;
  pageCount: number;
  /**
   * Content fingerprint of the render. The print files were assembled and
   * stored server-side, so the order is placed against them rather than
   * re-uploading tens of megabytes of PDF at checkout time.
   */
  fingerprint?: string;
}

/**
 * Start checkout for a print order. Returns the Stripe Checkout URL to redirect
 * to (the caller does `window.location.href = url`).
 */
export async function startOrderCheckout(
  input: CheckoutInput & { variant?: VariantSelection },
): Promise<{ url: string; paymentId: string }> {
  const { draft, pageCount, variant, fingerprint } = input;
  const assets = await Promise.all(draft.assets.map(assetToWire));
  const body = {
    // Format identity (base SKU). The server composes the print SKU from
    // `variant` so the client never invents a package id.
    productSku: draft.productSku,
    variant,
    copies: draft.copies,
    pageCount,
    currency: draft.currency,
    shippingMethod: draft.shippingMethod as ShippingMethod,
    destinationCountry: draft.destinationCountry,
    merchantReference: draft.merchantReference,
    recipient: draft.recipient,
    assets,
    fingerprint,
  };
  const res = await backendFetch("/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "We couldn't start checkout."));
  const json = (await res.json()) as { url?: string; paymentId?: string };
  if (!json.url) throw new Error("Checkout did not return a payment URL.");
  return { url: json.url, paymentId: json.paymentId ?? "" };
}

export interface RetailPricePreview {
  currency: string;
  copies: number;
  /** Per-unit price after any plan discount. */
  unitPrice: number;
  /** Per-unit sticker price before the discount. */
  listUnitPrice: number;
  discountPct: number;
  items: number;
  shipping: number;
  total: number;
  /**
   * What the print provider's address validation made of the destination. Null
   * when it had no comment. Pricing already sends the full address, so this
   * costs nothing extra and arrives while the customer can still fix it.
   */
  addressValidation: AddressValidation | null;
}

/**
 * Retail price preview for the order dialog. Runs the exact server pricing
 * path used at checkout (retail tiers + plan discount + charged shipping), so
 * the preview always matches what Stripe will charge (before tax).
 */
export async function fetchOrderPrice(input: {
  productSku: string;
  variant?: VariantSelection;
  copies: number;
  pageCount: number;
  currency: string;
  shippingMethod: ShippingMethod;
  destinationCountry: string;
  line1?: string;
  /**
   * Sent even though it can't change the price: it's part of what the carrier
   * validates, and a quote that skipped it would clear an address the order
   * isn't going to ship to.
   */
  line2?: string;
  city: string;
  state?: string;
  postalCode: string;
}): Promise<RetailPricePreview> {
  const res = await backendFetch("/checkout/price", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "We couldn't price this destination."));
  return (await res.json()) as RetailPricePreview;
}

/**
 * Reorder a previously paid print order. The backend reuses the hosted print
 * files from the original payment and reprices at today's catalog price, so no
 * re-render/re-upload is needed. Returns the Stripe Checkout URL.
 */
export async function startReorderCheckout(
  paymentId: string,
  copies?: number,
): Promise<{ url: string }> {
  const res = await backendFetch("/checkout/reorder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paymentId, copies }),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "We couldn't start checkout."));
  const json = (await res.json()) as { url?: string };
  if (!json.url) throw new Error("Checkout did not return a URL.");
  return { url: json.url };
}

export interface EbookQuote {
  enabled: boolean;
  currency: string;
  /** Final price after plan pricing + any print-owner bundle discount (0 ⇒ included). */
  price: number;
  listPrice: number;
  discountPct: number;
  /** Whether the user already owns this ebook. */
  owned: boolean;
  /**
   * The content fingerprint the owned copy was rendered from, if known (older
   * entitlements predate this field and read back `null`). Compared against
   * the book's current fingerprint to offer a free refresh instead of only
   * ever re-serving the original PDF.
   */
  ownedFingerprint: string | null;
  /** Download URL when owned (token-guarded; only revealed to the owner). */
  downloadUrl: string | null;
  /** The buyer's plan, ONLY when it changed the price (drives the wording). */
  planId: string | null;
  planName: string | null;
  /** True when the buyer's plan includes the ebook (granted without checkout). */
  included: boolean;
}

/** Server-authoritative ebook price + ownership for a project. */
export async function fetchEbookQuote(projectId: string, currency?: string): Promise<EbookQuote> {
  const params = new URLSearchParams({ projectId });
  if (currency) params.set("currency", currency);
  const res = await backendFetch(`/checkout/ebook/quote?${params.toString()}`);
  if (!res.ok) throw new Error(await errorMessage(res, "We couldn't price the ebook."));
  return (await res.json()) as EbookQuote;
}

/**
 * Buy the digital edition (PDF).
 *
 * The file itself isn't sent: it was assembled and stored server-side from the
 * rendered pages, and `fingerprint` is how the server finds it. Two outcomes:
 * `{ url }` — a Stripe Checkout URL to redirect to (the download unlocks after
 * payment), or `{ granted: true }` — no payment was needed, because either the
 * buyer's plan includes the ebook, or they already own it and this is a free
 * refresh onto their latest design (the server tells these apart from the
 * fingerprint; the caller doesn't need to).
 */
export async function startEbookCheckout(input: {
  projectId: string;
  title: string;
  currency: string;
  fingerprint: string;
}): Promise<{ url: string } | { granted: true }> {
  const res = await backendFetch("/checkout/ebook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: input.projectId,
      title: input.title,
      currency: input.currency,
      fingerprint: input.fingerprint,
    }),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "We couldn't start the ebook checkout."));
  const json = (await res.json()) as { url?: string; granted?: boolean };
  if (json.granted) return { granted: true };
  if (!json.url) throw new Error("Checkout did not return a URL.");
  return { url: json.url };
}

export interface SubscriptionCheckoutInput {
  /** The configured plan id (preferred — the server resolves the Stripe price). */
  planId?: string;
  /** A raw Stripe recurring price id (back-compat / tooling). */
  priceId?: string;
  interval?: "month" | "year";
  currency?: string;
}

/** Start a subscription checkout for a configured plan (or a raw Stripe price). */
export async function startSubscriptionCheckout(input: SubscriptionCheckoutInput): Promise<{ url: string }> {
  const res = await backendFetch("/checkout/subscription", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "We couldn't start checkout."));
  const json = (await res.json()) as { url?: string };
  if (!json.url) throw new Error("Checkout did not return a URL.");
  return { url: json.url };
}

/** Buy a one-time Spark top-up pack. Returns the Stripe Checkout URL. */
export async function buySparkPack(packId: string, currency: string): Promise<{ url: string }> {
  const res = await backendFetch("/checkout/sparks-pack", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ packId, currency }),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "We couldn't start checkout."));
  const json = (await res.json()) as { url?: string };
  if (!json.url) throw new Error("Checkout did not return a URL.");
  return { url: json.url };
}

/**
 * Buy a Spark pack as a GIFT: pays now, receives a claim code (shown on the
 * success page + receipt) that anyone can redeem. Returns the Checkout URL.
 */
export async function buySparkGift(input: {
  packId: string;
  currency: string;
  recipientEmail?: string;
  message?: string;
}): Promise<{ url: string }> {
  const res = await backendFetch("/checkout/sparks-gift", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "We couldn't start checkout."));
  const json = (await res.json()) as { url?: string };
  if (!json.url) throw new Error("Checkout did not return a URL.");
  return { url: json.url };
}

export interface SparkGiftSummary {
  code: string;
  sparks: number;
  status: "pending" | "claimed";
  recipientEmail: string | null;
  message: string | null;
  createdAt: number;
  claimedAt: number | null;
}

/** The gifts the signed-in user has bought (claim codes + redeemed status). */
export async function listMyGifts(): Promise<SparkGiftSummary[]> {
  const res = await backendFetch("/account/gifts");
  if (!res.ok) throw new Error(await errorMessage(res, "Could not load your gifts."));
  const json = (await res.json()) as { gifts?: SparkGiftSummary[] };
  return json.gifts ?? [];
}

/** Redeem a Spark gift code — the Sparks are granted to the signed-in user. */
export async function claimSparkGift(code: string): Promise<number> {
  const res = await backendFetch("/account/sparks/claim-gift", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "Could not claim this gift."));
  const json = (await res.json()) as { sparks?: number };
  return json.sparks ?? 0;
}

export interface ReferralInfo {
  code: string;
  enabled: boolean;
  referrerSparks: number;
  referredSparks: number;
}

/** The signed-in user's shareable referral code + current reward amounts. */
export async function getReferralInfo(): Promise<ReferralInfo> {
  const res = await backendFetch("/account/referral");
  if (!res.ok) throw new Error(await errorMessage(res, "Could not load your referral code."));
  return (await res.json()) as ReferralInfo;
}

/** Attach the referral code that brought this user here (best-effort). */
export async function claimReferralCode(code: string): Promise<boolean> {
  try {
    const res = await backendFetch("/account/referral/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (!res.ok) return false;
    const json = (await res.json()) as { ok?: boolean };
    return json.ok === true;
  } catch {
    return false;
  }
}

/**
 * Claim every starter-grant ladder rung the caller qualifies for (guest →
 * signup → verify). Each rung is granted once; safe to call repeatedly.
 */
export async function claimSparkGrants(): Promise<void> {
  try {
    await backendFetch("/sparks/claim", { method: "POST" });
  } catch {
    // Best-effort — non-fatal.
  }
}

/** Open the Stripe Customer Portal (manage subscription / payment methods). */
export async function openBillingPortal(): Promise<{ url: string }> {
  const res = await backendFetch("/account/portal", { method: "POST" });
  if (!res.ok) throw new Error(await errorMessage(res, "We couldn't open billing."));
  const json = (await res.json()) as { url?: string };
  if (!json.url) throw new Error("No billing URL returned.");
  return { url: json.url };
}

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

const FULFILLMENT_STATES: FulfillmentState[] = ["pending", "placed", "retrying", "failed"];

function mapPayment(id: string, d: Record<string, unknown>): UserPaymentRecord {
  const items = Array.isArray(d.items)
    ? (d.items as Record<string, unknown>[]).map((it) => ({
        label: typeof it.label === "string" ? it.label : "",
        amount: typeof it.amount === "number" ? it.amount : 0,
        quantity: typeof it.quantity === "number" ? it.quantity : 1,
      }))
    : [];
  const kind =
    d.kind === "subscription" || d.kind === "sparkPack" || d.kind === "sparkGift" || d.kind === "ebook"
      ? d.kind
      : ("order" as const);
  const status = (typeof d.status === "string" ? d.status : "pending") as PaymentStatus;
  return {
    id: typeof d.id === "string" ? d.id : id,
    kind,
    status,
    // Orders placed before this field existed have none. A paid order with an
    // order id is plainly at the press; one without is still on its way there —
    // which beats showing nothing at all for the whole back catalogue.
    fulfillmentState:
      kind !== "order"
        ? null
        : FULFILLMENT_STATES.includes(d.fulfillmentState as FulfillmentState)
          ? (d.fulfillmentState as FulfillmentState)
          : typeof d.orderId === "string" && d.orderId
            ? "placed"
            : status === "paid"
              ? "pending"
              : null,
    fulfillmentIssue: typeof d.fulfillmentIssue === "string" ? d.fulfillmentIssue : null,
    amount: typeof d.amount === "number" ? d.amount : 0,
    currency: typeof d.currency === "string" ? d.currency : "USD",
    description: typeof d.description === "string" ? d.description : "",
    items,
    receiptUrl: typeof d.receiptUrl === "string" ? d.receiptUrl : null,
    refundedAmount: typeof d.refundedAmount === "number" ? d.refundedAmount : 0,
    orderId: typeof d.orderId === "string" ? d.orderId : null,
    createdAt: toMs(d.createdAt),
    updatedAt: toMs(d.updatedAt),
  };
}

/** Subscribe to the signed-in user's payments, newest-first. */
export function subscribeUserPayments(cb: (payments: UserPaymentRecord[]) => void): Unsubscribe {
  const uid = getFirebaseAuth().currentUser?.uid;
  if (!uid) {
    cb([]);
    return () => {};
  }
  const col = collection(getFirebaseDb(), `users/${uid}/payments`);
  return onSnapshot(
    col,
    (snap) => {
      const list = snap.docs.map((doc) => mapPayment(doc.id, doc.data() as Record<string, unknown>));
      list.sort(
        (a, b) => (b.createdAt ?? Number.POSITIVE_INFINITY) - (a.createdAt ?? Number.POSITIVE_INFINITY),
      );
      cb(list);
    },
    () => cb([]),
  );
}
