/**
 * Client access to the user's purchased downloads (digital goods).
 *
 * Entitlements live under `users/{uid}/downloads/{id}` — owner-readable, written
 * only by the backend (at delivery time and on each download). The list mirrors
 * that collection live (like orders/payments). The actual file URL is NEVER on
 * these docs: fetching a file goes through the gated `/account/downloads/:id/link`
 * endpoint, which authorizes the owner, logs an audit event (time + IP + device)
 * and bumps the counter before handing back a URL to open.
 *
 * Today the only `type` is `"ebook"`, but the shape is intentionally generic so
 * future digital products appear here with no schema change.
 */
import {
  collection,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  type Unsubscribe,
} from "firebase/firestore";
import { getFirebaseAuth, getFirebaseDb } from "../lib/firebase";
import { backendFetch } from "./backend";

export type DownloadType = "ebook" | (string & {});

export interface DownloadEntitlement {
  id: string;
  type: DownloadType;
  title: string;
  projectId: string;
  paymentId: string;
  purchasedAt: number | null;
  downloadCount: number;
  lastDownloadedAt: number | null;
  /** When the user last saw this in the Downloads list (null ⇒ new/unseen). */
  seenAt: number | null;
}

export interface DownloadEvent {
  at: number | null;
  ip: string | null;
  userAgent: string | null;
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

function mapEntitlement(id: string, d: Record<string, unknown>): DownloadEntitlement {
  return {
    id: typeof d.id === "string" ? d.id : id,
    type: typeof d.type === "string" ? d.type : "ebook",
    title: typeof d.title === "string" ? d.title : "",
    projectId: typeof d.projectId === "string" ? d.projectId : id,
    paymentId: typeof d.paymentId === "string" ? d.paymentId : "",
    purchasedAt: toMs(d.purchasedAt),
    downloadCount: typeof d.downloadCount === "number" ? d.downloadCount : 0,
    lastDownloadedAt: toMs(d.lastDownloadedAt),
    seenAt: toMs(d.seenAt),
  };
}

/** Subscribe to the signed-in user's downloads, newest purchase first. */
export function subscribeUserDownloads(
  cb: (downloads: DownloadEntitlement[]) => void,
): Unsubscribe {
  const uid = getFirebaseAuth().currentUser?.uid;
  if (!uid) {
    cb([]);
    return () => {};
  }
  const col = collection(getFirebaseDb(), `users/${uid}/downloads`);
  return onSnapshot(
    col,
    (snap) => {
      const list = snap.docs.map((doc) => mapEntitlement(doc.id, doc.data() as Record<string, unknown>));
      list.sort(
        (a, b) => (b.purchasedAt ?? Number.POSITIVE_INFINITY) - (a.purchasedAt ?? Number.POSITIVE_INFINITY),
      );
      cb(list);
    },
    () => cb([]),
  );
}

async function jsonError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body?.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Authorize + log a download and get back a URL to open. The backend records the
 * access (time, IP, device) and increments the counter before returning.
 */
export async function fetchDownloadLink(id: string): Promise<string> {
  const res = await backendFetch(`/account/downloads/${encodeURIComponent(id)}/link`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(await jsonError(res, "We couldn't prepare your download."));
  const json = (await res.json()) as { url?: string };
  if (!json.url) throw new Error("No download URL was returned.");
  return json.url;
}

/** Read the audit history for a single download (owner-readable). */
export async function fetchDownloadEvents(id: string): Promise<DownloadEvent[]> {
  const uid = getFirebaseAuth().currentUser?.uid;
  if (!uid) return [];
  try {
    const q = query(
      collection(getFirebaseDb(), `users/${uid}/downloads/${id}/events`),
      orderBy("at", "desc"),
    );
    const snap = await getDocs(q);
    return snap.docs.map((doc) => {
      const d = doc.data() as Record<string, unknown>;
      return {
        at: toMs(d.at),
        ip: typeof d.ip === "string" ? d.ip : null,
        userAgent: typeof d.userAgent === "string" ? d.userAgent : null,
      };
    });
  } catch {
    return [];
  }
}

/** Mark all downloads seen (clears the unseen badge). Best-effort. */
export async function markDownloadsSeen(): Promise<void> {
  try {
    await backendFetch("/account/downloads/seen", { method: "POST" });
  } catch {
    // Non-fatal — the badge just lingers until the next successful call.
  }
}
