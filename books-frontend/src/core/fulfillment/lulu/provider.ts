/**
 * Lulu Print API adapter.
 *
 * Implements the provider-agnostic {@link FulfillmentProvider} port by talking
 * to Lulu directly. It depends only on injected collaborators — an HTTP fetch
 * (Tauri's plugin fetch bypasses CORS), an {@link AssetHost} for uploading
 * print-ready files, and getters for the OAuth2 client credentials/environment —
 * so the exact same adapter runs unchanged behind a backend later (only the
 * wiring in `platform/fulfillment.ts` changes).
 *
 * Auth: Lulu uses OAuth2 client-credentials. We exchange the client key/secret
 * (Basic auth) for a short-lived bearer token at the token endpoint and cache it
 * until it is about to expire.
 *
 * Reference: https://api.lulu.com/docs/
 */
import { FulfillmentError, fulfillmentKindFromStatus } from "../errors";
import type {
  AssetHost,
  FulfillmentOrder,
  FulfillmentProvider,
  OrderDraft,
  PrintAsset,
  Quote,
  QuoteRequest,
  ShippingMethod,
} from "../types";
import { LULU_BOOK_PRODUCTS } from "./products";
import {
  mapCostToQuote,
  mapCoverDimensionsMm,
  mapOrder,
  mapWebhook,
  type LuluCostRequest,
  type LuluPrintJobRequest,
  type LuluShippingAddress,
  type LuluSourceFile,
  type LuluWebhook,
} from "./wire";

export type LuluEnv = "sandbox" | "live";

/** Minimal fetch signature shared with `platform/http.ts`'s `httpFetch`. */
export type HttpFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface LuluProviderDeps {
  /** Fetch implementation (Tauri plugin fetch in the desktop app). */
  httpFetch: HttpFetch;
  /** Where print-ready files are uploaded so Lulu can download them. */
  assetHost: AssetHost;
  /** OAuth2 client key (kept out of this module so it can be swapped/env-sourced). */
  clientKey: () => string;
  /** OAuth2 client secret. */
  clientSecret: () => string;
  env: LuluEnv;
}

const BASE_URL: Record<LuluEnv, string> = {
  sandbox: "https://api.sandbox.lulu.com",
  live: "https://api.lulu.com",
};

const TOKEN_PATH = "/auth/realms/glasstree/protocol/openid-connect/token";

/** Map our domain shipping tiers to Lulu shipping levels. */
const SHIPPING_LEVEL: Record<ShippingMethod, string> = {
  Budget: "MAIL",
  Standard: "GROUND",
  StandardPlus: "PRIORITY_MAIL",
  Express: "EXPEDITED",
  Overnight: "EXPRESS",
};

/** Candidate Lulu shipping levels to enumerate when quoting (cheapest → fastest). */
const QUOTE_LEVELS = ["MAIL", "PRIORITY_MAIL", "GROUND", "EXPEDITED", "EXPRESS"] as const;

function base64(input: string): string {
  if (typeof btoa === "function") return btoa(input);
  // Node/backend fallback.
  return Buffer.from(input, "utf-8").toString("base64");
}

export function createLuluProvider(deps: LuluProviderDeps): FulfillmentProvider {
  const base = BASE_URL[deps.env];

  let cachedToken: { value: string; expiresAt: number } | null = null;

  async function getToken(): Promise<string> {
    const now = Date.now();
    if (cachedToken && cachedToken.expiresAt - 30_000 > now) {
      return cachedToken.value;
    }
    const key = deps.clientKey().trim();
    const secret = deps.clientSecret().trim();
    if (!key || !secret) {
      throw new FulfillmentError("No Lulu API credentials configured.", {
        kind: "config",
        provider: "lulu",
      });
    }

    let res: Response;
    try {
      res = await deps.httpFetch(`${base}${TOKEN_PATH}`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${base64(`${key}:${secret}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
      });
    } catch (err) {
      throw new FulfillmentError("Network request to Lulu (auth) failed.", {
        kind: "network",
        provider: "lulu",
        cause: err,
      });
    }
    if (!res.ok) {
      let details = "";
      try {
        details = await res.text();
      } catch {
        /* ignore */
      }
      throw new FulfillmentError(`Lulu auth failed with status ${res.status}.`, {
        kind: fulfillmentKindFromStatus(res.status),
        provider: "lulu",
        status: res.status,
        details,
      });
    }
    let json: { access_token?: string; expires_in?: number };
    try {
      json = (await res.json()) as typeof json;
    } catch (err) {
      throw new FulfillmentError("Could not parse Lulu auth response.", {
        kind: "parse",
        provider: "lulu",
        cause: err,
      });
    }
    if (!json.access_token) {
      throw new FulfillmentError("Lulu auth response had no access token.", {
        kind: "auth",
        provider: "lulu",
      });
    }
    cachedToken = {
      value: json.access_token,
      expiresAt: now + (json.expires_in ?? 3600) * 1000,
    };
    return cachedToken.value;
  }

  /** Authenticated fetch that throws a typed error on a non-2xx response. */
  async function fetchOk(path: string, init: RequestInit): Promise<Response> {
    const token = await getToken();
    let res: Response;
    try {
      res = await deps.httpFetch(`${base}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(init.headers ?? {}),
        },
      });
    } catch (err) {
      throw new FulfillmentError("Network request to Lulu failed.", {
        kind: "network",
        provider: "lulu",
        cause: err,
      });
    }
    if (!res.ok) {
      let details = "";
      try {
        details = await res.text();
      } catch {
        /* ignore */
      }
      throw new FulfillmentError(`Lulu request failed with status ${res.status}.`, {
        kind: fulfillmentKindFromStatus(res.status),
        provider: "lulu",
        status: res.status,
        details,
      });
    }
    return res;
  }

  async function request<T>(path: string, init: RequestInit): Promise<T> {
    const res = await fetchOk(path, init);
    try {
      return (await res.json()) as T;
    } catch (err) {
      throw new FulfillmentError("Could not parse Lulu response.", {
        kind: "parse",
        provider: "lulu",
        cause: err,
      });
    }
  }

  /** Like {@link request} but for endpoints that return no/empty body (e.g. DELETE). */
  async function requestVoid(path: string, init: RequestInit): Promise<void> {
    await fetchOk(path, init);
  }

  /** Upload the draft's print assets and return them keyed by print area. */
  async function uploadAssets(
    assets: PrintAsset[],
  ): Promise<{ interior?: LuluSourceFile; cover?: LuluSourceFile }> {
    const out: { interior?: LuluSourceFile; cover?: LuluSourceFile } = {};
    for (const a of assets) {
      const ext = a.blob.type === "application/pdf" ? "pdf" : "png";
      const { url } = await deps.assetHost.upload(a.blob, `${a.printArea}.${ext}`);
      if (a.printArea === "cover") out.cover = { source_url: url };
      else out.interior = { source_url: url };
    }
    return out;
  }

  return {
    id: "lulu",

    listProducts() {
      return LULU_BOOK_PRODUCTS;
    },

    async getCoverDimensionsMm(sku, pages) {
      // Cover dimensions live at the API root (NOT under /print-jobs/, which only
      // serves list/create + GET /{id}/ — POSTing there returns 405). The body
      // uses `interior_page_count`; the response is decimal strings in points.
      const json = await request<Parameters<typeof mapCoverDimensionsMm>[0]>(
        "/cover-dimensions/",
        {
          method: "POST",
          body: JSON.stringify({ pod_package_id: sku, interior_page_count: pages }),
        },
      );
      return mapCoverDimensionsMm(json);
    },

    async quote(req: QuoteRequest): Promise<Quote[]> {
      const product = LULU_BOOK_PRODUCTS.find((p) => p.sku === req.productSku);
      // Price the real (normalized) page count when the caller provides it;
      // otherwise fall back to the product minimum as a coarse estimate.
      const pageCount = Math.max(
        product?.minPages ?? 4,
        Math.round(req.pageCount ?? product?.minPages ?? 32),
      );

      // Lulu's cost endpoint validates the FULL shipping address (street, city,
      // state, postcode, phone) even for a price check. Fields that don't affect
      // the quote (name, street, phone) are filled with placeholders; the ones
      // that do (country/state/postcode/city) use the caller's values.
      const shippingAddress: LuluShippingAddress = {
        name: "Shipping Estimate",
        street1: req.destinationLine1?.trim() || "1 Main St",
        city: req.destinationCity?.trim() || "City",
        state_code: req.destinationState?.trim() || undefined,
        postcode: req.destinationPostalCode?.trim() || undefined,
        country_code: req.destinationCountry,
        phone_number: "0000000000",
      };

      // If the caller pinned a method, quote just that; otherwise enumerate.
      const levels = req.shippingMethod
        ? [SHIPPING_LEVEL[req.shippingMethod]]
        : [...QUOTE_LEVELS];

      const quotes: Quote[] = [];
      let lastError: unknown;
      for (const level of levels) {
        const body: LuluCostRequest = {
          line_items: [
            { page_count: pageCount, pod_package_id: req.productSku, quantity: req.copies },
          ],
          shipping_address: shippingAddress,
          shipping_level: level,
        };
        try {
          const json = await request<Parameters<typeof mapCostToQuote>[0]>(
            "/print-job-cost-calculations/",
            { method: "POST", body: JSON.stringify(body) },
          );
          quotes.push(mapCostToQuote(json, level));
        } catch (err) {
          // A level may legitimately be unavailable for a destination; remember
          // the error so a total failure is reported rather than silently empty.
          lastError = err;
        }
      }
      if (quotes.length === 0 && lastError) throw lastError;
      return quotes;
    },

    async createOrder(draft: OrderDraft): Promise<FulfillmentOrder> {
      // Prefer already-hosted files (payment-gated checkout uploaded them up
      // front); otherwise upload the in-memory assets now.
      const files =
        draft.sourceFileUrls?.interior || draft.sourceFileUrls?.cover
          ? {
              interior: draft.sourceFileUrls.interior
                ? { source_url: draft.sourceFileUrls.interior }
                : undefined,
              cover: draft.sourceFileUrls.cover ? { source_url: draft.sourceFileUrls.cover } : undefined,
            }
          : await uploadAssets(draft.assets);
      if (!files.interior || !files.cover) {
        throw new FulfillmentError(
          "Lulu orders require both an interior and a cover print file.",
          { kind: "validation", provider: "lulu" },
        );
      }

      const body: LuluPrintJobRequest = {
        contact_email: draft.recipient.email,
        external_id: draft.merchantReference,
        line_items: [
          {
            external_id: draft.merchantReference,
            title: draft.merchantReference ?? "Childbook",
            quantity: draft.copies,
            printable_normalization: {
              pod_package_id: draft.productSku,
              interior: files.interior,
              cover: files.cover,
            },
          },
        ],
        shipping_address: {
          name: draft.recipient.name,
          street1: draft.recipient.address.line1,
          street2: draft.recipient.address.line2,
          city: draft.recipient.address.townOrCity,
          state_code: draft.recipient.address.stateOrCounty,
          country_code: draft.recipient.address.countryCode,
          postcode: draft.recipient.address.postalOrZipCode,
          phone_number: draft.recipient.phoneNumber,
          email: draft.recipient.email,
        },
        shipping_level: SHIPPING_LEVEL[draft.shippingMethod],
      };

      const json = await request<Parameters<typeof mapOrder>[0]>("/print-jobs/", {
        method: "POST",
        body: JSON.stringify(body),
      });
      return {
        ...mapOrder(json),
        printFiles: {
          interior: files.interior.source_url,
          cover: files.cover.source_url,
        },
      };
    },

    async getOrder(id: string): Promise<FulfillmentOrder> {
      const json = await request<Parameters<typeof mapOrder>[0]>(
        `/print-jobs/${encodeURIComponent(id)}/`,
        { method: "GET" },
      );
      return mapOrder(json);
    },

    async cancelOrder(id: string): Promise<FulfillmentOrder> {
      // Lulu cancels by transitioning the job status to CANCELED.
      const json = await request<Parameters<typeof mapOrder>[0]>(
        `/print-jobs/${encodeURIComponent(id)}/status/`,
        { method: "PUT", body: JSON.stringify({ name: "CANCELED" }) },
      );
      return mapOrder(json);
    },

    // ---- Status webhooks (backend only) -----------------------------------
    // Lulu pushes order-status updates to a registered URL for the
    // PRINT_JOB_STATUS_CHANGED topic. The URL must be publicly reachable.

    async registerStatusWebhook(url: string) {
      const json = await request<LuluWebhook>("/webhooks/", {
        method: "POST",
        body: JSON.stringify({ topics: ["PRINT_JOB_STATUS_CHANGED"], url }),
      });
      return mapWebhook(json);
    },

    async listStatusWebhooks() {
      const json = await request<{ results?: LuluWebhook[] }>("/webhooks/", { method: "GET" });
      return (json.results ?? []).map(mapWebhook);
    },

    async deleteStatusWebhook(id: string) {
      await requestVoid(`/webhooks/${encodeURIComponent(id)}/`, { method: "DELETE" });
    },

    async testStatusWebhook(id: string) {
      // Sends a dummy PRINT_JOB_STATUS_CHANGED submission to the registered URL.
      await requestVoid(`/webhooks/${encodeURIComponent(id)}/test-submission/`, {
        method: "POST",
        body: JSON.stringify({ topic: "PRINT_JOB_STATUS_CHANGED" }),
      });
    },
  };
}
