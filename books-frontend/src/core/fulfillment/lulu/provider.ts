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
import { FulfillmentError, fulfillmentKindFromStatus, isRetryable, retryAfterMs } from "../errors";
import type {
  AssetHost,
  FulfillmentOrder,
  FulfillmentProvider,
  OrderDraft,
  PrintAsset,
  Quote,
  QuoteRequest,
  ShippingMethod,
  TierOutcome,
} from "../types";
import { LULU_BOOK_PRODUCTS } from "./products";
import { sameFormat } from "./skuAxes";
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

/**
 * Map our domain shipping tiers to Lulu shipping levels.
 *
 * Availability is per destination, not universal: MAIL / PRIORITY_MAIL / EXPRESS
 * quote everywhere we sell, GROUND is unavailable to the US and UK, and
 * EXPEDITED is US-only. Quoting an unavailable level is a hard 400, so which
 * tiers a product offers belongs in its admin shipping config.
 */
export const SHIPPING_LEVEL: Record<ShippingMethod, string> = {
  Budget: "MAIL",
  Standard: "GROUND",
  StandardPlus: "PRIORITY_MAIL",
  Express: "EXPEDITED",
  Overnight: "EXPRESS",
};

/** Candidate Lulu shipping levels to enumerate when quoting (cheapest → fastest). */
const QUOTE_LEVELS = ["MAIL", "PRIORITY_MAIL", "GROUND", "EXPEDITED", "EXPRESS"] as const;

/**
 * The domain tier a quote came back as. A {@link Quote} carries the provider's
 * own level string, so anything storing or comparing tiers has to translate it
 * back — otherwise a measured "PRIORITY_MAIL" row would never match the
 * "StandardPlus" a product offers.
 */
export function shippingMethodForLevel(level: string): ShippingMethod | undefined {
  const match = Object.entries(SHIPPING_LEVEL).find(([, code]) => code === level);
  return match?.[0] as ShippingMethod | undefined;
}

function base64(input: string): string {
  if (typeof btoa === "function") return btoa(input);
  // Node/backend fallback.
  return Buffer.from(input, "utf-8").toString("base64");
}

/** Attempts (including the first) for a request the provider said to retry. */
const MAX_ATTEMPTS = 4;
/** Base of the exponential backoff used when there's no `Retry-After`. */
const BACKOFF_MS = 500;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Errors whose retry budget is already spent, so an outer retry won't re-spend it. */
const exhausted = new WeakSet<FulfillmentError>();

export function createLuluProvider(deps: LuluProviderDeps): FulfillmentProvider {
  const base = BASE_URL[deps.env];

  let cachedToken: { value: string; expiresAt: number } | null = null;
  /**
   * The token request currently in flight, if any.
   *
   * Without this, concurrent callers all miss the cache at the same instant and
   * each starts its own token exchange — so a fan-out of N probes opens N
   * sessions and trips the provider's rate limiter on the auth endpoint, which
   * is precisely the failure this de-duplication exists to prevent. Sharing the
   * promise means the first caller authenticates and the rest await it.
   */
  let inFlightToken: Promise<string> | null = null;

  function getToken(): Promise<string> {
    const now = Date.now();
    if (cachedToken && cachedToken.expiresAt - 30_000 > now) {
      return Promise.resolve(cachedToken.value);
    }
    if (inFlightToken) return inFlightToken;
    // Cleared on settle either way: a failed exchange must not pin every later
    // caller to the same rejection.
    inFlightToken = withRetry(fetchToken).finally(() => {
      inFlightToken = null;
    });
    return inFlightToken;
  }

  async function fetchToken(): Promise<string> {
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
        retryAfterMs: retryAfterMs(res.headers.get("Retry-After")),
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
    // Timed from when the token was ISSUED, not from when the exchange started
    // — a retried exchange can start seconds earlier than it succeeds.
    cachedToken = {
      value: json.access_token,
      expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
    };
    return cachedToken.value;
  }

  /**
   * Retry a request the provider itself said to retry.
   *
   * Only `rate_limit` and `network` qualify: they say nothing about the request,
   * so the identical call can succeed later. A `validation` failure is a verdict
   * and repeating it just asks the same question twice.
   *
   * Waits as long as the provider asked (`Retry-After`) when it said, and backs
   * off exponentially with jitter when it didn't. The jitter matters under
   * fan-out — without it, a batch throttled together retries in lockstep and
   * trips the limiter again as one synchronized burst.
   */
  async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await fn();
      } catch (err) {
        const retryable =
          err instanceof FulfillmentError && isRetryable(err.kind) && !exhausted.has(err);
        if (!retryable || attempt >= MAX_ATTEMPTS) {
          // Retries are nested — a request awaits a token exchange that retries
          // on its own — and left unmarked the budgets MULTIPLY, turning four
          // attempts into sixteen. Marking the error spends the budget once.
          if (err instanceof FulfillmentError) exhausted.add(err);
          throw err;
        }
        const asked = (err as FulfillmentError).retryAfterMs;
        const backoff = BACKOFF_MS * 2 ** (attempt - 1);
        await sleep(asked ?? backoff + Math.random() * backoff);
      }
    }
  }

  /** One authenticated attempt; throws a typed error on a non-2xx response. */
  async function fetchOnce(path: string, init: RequestInit): Promise<Response> {
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
      // A token can expire mid-flight; drop the cached one so the retry
      // re-authenticates rather than replaying the same dead bearer.
      if (res.status === 401) cachedToken = null;
      throw new FulfillmentError(`Lulu request failed with status ${res.status}.`, {
        kind: fulfillmentKindFromStatus(res.status),
        provider: "lulu",
        status: res.status,
        details,
        retryAfterMs: retryAfterMs(res.headers.get("Retry-After")),
      });
    }
    return res;
  }

  /** Authenticated fetch that throws a typed error on a non-2xx response. */
  function fetchOk(path: string, init: RequestInit): Promise<Response> {
    return withRetry(() => fetchOnce(path, init));
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

  /**
   * Price each shipping tier, reporting what happened to every one of them.
   *
   * The provider has no "quote all speeds" endpoint, so this is one request per
   * level. Each is allowed to fail independently — a speed genuinely not run to
   * a destination answers 400 — but the reason is kept, because only a
   * `validation` refusal is evidence about coverage. Collapsing a throttled or
   * dropped request into the same "absent" as a refusal is how a momentary blip
   * gets written down as "this speed doesn't reach Australia".
   */
  async function quoteTiers(req: QuoteRequest): Promise<TierOutcome[]> {
    const product =
      LULU_BOOK_PRODUCTS.find((p) => p.sku === req.productSku) ??
      LULU_BOOK_PRODUCTS.find((p) => sameFormat(p.sku, req.productSku));
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
    const levels = req.shippingMethod ? [SHIPPING_LEVEL[req.shippingMethod]] : [...QUOTE_LEVELS];

    const outcomes: TierOutcome[] = [];
    let lastError: unknown;
    for (const level of levels) {
      const method = shippingMethodForLevel(level);
      if (!method) continue;
      const body: LuluCostRequest = {
        line_items: [{ page_count: pageCount, pod_package_id: req.productSku, quantity: req.copies }],
        shipping_address: shippingAddress,
        shipping_level: level,
      };
      try {
        const json = await request<Parameters<typeof mapCostToQuote>[0]>(
          "/print-job-cost-calculations/",
          { method: "POST", body: JSON.stringify(body) },
        );
        outcomes.push({ method, quote: mapCostToQuote(json, level) });
      } catch (err) {
        const refused = err instanceof FulfillmentError && err.kind === "validation";
        outcomes.push({
          method,
          refused,
          failed: !refused,
          throttled: err instanceof FulfillmentError && err.kind === "rate_limit",
          message: err instanceof Error ? err.message : undefined,
        });
        lastError = err;
      }
    }
    // Nothing priced at all: throw rather than return a list of failures that a
    // careless caller would read as "no speed reaches here".
    if (outcomes.every((o) => !o.quote) && lastError) throw lastError;
    return outcomes;
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
      const outcomes = await quoteTiers(req);
      return outcomes.flatMap((o) => (o.quote ? [o.quote] : []));
    },

    quoteTiers,

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
