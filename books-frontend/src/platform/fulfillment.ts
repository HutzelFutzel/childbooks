/**
 * Fulfillment wiring — backend adapter.
 *
 * Print credentials and asset hosting live on the server, so the frontend talks
 * to the backend's `/print/*` endpoints through a thin adapter that implements
 * the {@link FulfillmentProvider} port. The browser has no knowledge of which
 * print provider backs the platform — it only depends on that port.
 *
 * Print files are sent to the backend as base64 (it decodes them, uploads them,
 * and hands the print provider the download URLs).
 */
import { FulfillmentError, fulfillmentKindFromStatus } from "../core/fulfillment/errors";
import { BOOK_PRODUCTS } from "../core/fulfillment";
import type {
  BookProduct,
  FulfillmentOrder,
  FulfillmentProvider,
  OrderDraft,
  PrintAsset,
  Quote,
  QuoteRequest,
} from "../core/fulfillment/types";
import { backendFetch } from "./backend";

const JSON_HEADERS = { "Content-Type": "application/json" };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await backendFetch(path, init);
  } catch (err) {
    throw new FulfillmentError("Could not reach the fulfillment backend.", {
      kind: "network",
      provider: "print",
      cause: err,
    });
  }
  if (!res.ok) {
    let message = `Backend request failed with status ${res.status}.`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body?.error?.message) message = body.error.message;
    } catch {
      /* ignore */
    }
    throw new FulfillmentError(message, {
      kind: fulfillmentKindFromStatus(res.status),
      provider: "print",
      status: res.status,
    });
  }
  return (await res.json()) as T;
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

/**
 * The active fulfillment provider — a backend-backed print adapter. The concrete
 * print provider is an internal server detail; this adapter only speaks the
 * provider-neutral `/print/*` API.
 */
export function createFulfillment(): FulfillmentProvider {
  return {
    id: "print",

    listProducts(): BookProduct[] {
      return BOOK_PRODUCTS;
    },

    getCoverDimensionsMm(sku: string, pages: number) {
      return call<{ widthMm: number; heightMm: number }>("/print/cover-dimensions", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ sku, pages }),
      });
    },

    quote(req: QuoteRequest): Promise<Quote[]> {
      return call<Quote[]>("/print/quote", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(req),
      });
    },

    async createOrder(draft: OrderDraft): Promise<FulfillmentOrder> {
      const assets = await Promise.all(draft.assets.map(assetToWire));
      const { assets: _omit, ...rest } = draft;
      return call<FulfillmentOrder>("/print/order", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ ...rest, assets }),
      });
    },

    getOrder(id: string): Promise<FulfillmentOrder> {
      return call<FulfillmentOrder>(`/print/order/${encodeURIComponent(id)}`);
    },

    cancelOrder(id: string): Promise<FulfillmentOrder> {
      return call<FulfillmentOrder>(`/print/order/${encodeURIComponent(id)}/cancel`, {
        method: "POST",
      });
    },
  };
}
