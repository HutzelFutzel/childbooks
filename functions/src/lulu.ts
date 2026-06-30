/**
 * Lulu fulfillment — domain endpoints.
 *
 * The exact same `createLuluProvider` adapter the desktop build used now runs
 * here, fed with the server-held OAuth credentials and an Admin-SDK asset host.
 * The frontend talks to these endpoints through a thin `FulfillmentProvider`
 * adapter (books-frontend platform/fulfillment), so no UI/domain code changes.
 *
 * Print files are sent as base64 in the order body (Phase 1). They are decoded
 * to Blobs, uploaded to Storage by the asset host, and handed to Lulu as URLs.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import express, { type Express, type Request, type Response } from "express";
import { createLuluProvider } from "../../books-frontend/src/core/fulfillment/lulu/provider";
import { mapOrder } from "../../books-frontend/src/core/fulfillment/lulu/wire";
import type { LuluWebhookEnvelope } from "../../books-frontend/src/core/fulfillment/lulu/wire";
import type {
  FulfillmentOrder,
  FulfillmentProvider,
  OrderDraft,
  PrintAsset,
  QuoteRequest,
} from "../../books-frontend/src/core/fulfillment/types";
import { FulfillmentError } from "../../books-frontend/src/core/fulfillment/errors";
import { serverConfig } from "./config";
import { createAdminAssetHost } from "./assets";
import type { AuthedRequest } from "./auth";
import { applyOrderStatusUpdate, persistCreatedOrder } from "./orders";

function provider(): FulfillmentProvider {
  const cfg = serverConfig();
  return createLuluProvider({
    httpFetch: (url, init) => fetch(url, init as RequestInit),
    assetHost: createAdminAssetHost(),
    clientKey: () => cfg.fulfillment.lulu.clientKey,
    clientSecret: () => cfg.fulfillment.lulu.clientSecret,
    env: cfg.fulfillment.lulu.env,
  });
}

/** The configured fulfillment provider, for trusted server-side callers (admin). */
export function fulfillmentProvider(): FulfillmentProvider {
  return provider();
}

/** Print asset as it arrives over the wire (Blob serialized as base64). */
interface WireAsset {
  printArea: string;
  base64: string;
  contentType?: string;
  pageCount?: number;
}

function decodeAssets(assets: WireAsset[] | undefined): PrintAsset[] {
  return (assets ?? []).map((a) => ({
    printArea: a.printArea,
    pageCount: a.pageCount,
    blob: new Blob([Buffer.from(a.base64, "base64")], {
      type: a.contentType || "application/octet-stream",
    }),
  }));
}

/**
 * Provider-neutral, client-facing messages keyed by error kind. The detailed,
 * provider-specific error (which may name "Lulu") is logged server-side only —
 * the browser must never learn which print provider backs the platform.
 */
const CLIENT_MESSAGE: Record<string, string> = {
  config: "Printing is temporarily unavailable. Please try again later.",
  auth: "Printing is temporarily unavailable. Please try again later.",
  network: "We couldn't reach the print service. Please try again.",
  validation: "We couldn't process this order. Please review the details and try again.",
  not_found: "That order could not be found.",
  upload: "We couldn't prepare your print files. Please try again.",
  parse: "We received an unexpected response from the print service. Please try again.",
  unknown: "Something went wrong while placing your order. Please try again.",
};

function sendError(res: Response, err: unknown): void {
  if (err instanceof FulfillmentError) {
    const status = err.status ?? (err.kind === "config" ? 503 : 502);
    console.error("[fulfillment]", err.kind, status, err.message, err.details ?? "");
    res
      .status(status)
      .json({ error: { message: CLIENT_MESSAGE[err.kind] ?? CLIENT_MESSAGE.unknown, kind: err.kind } });
    return;
  }
  console.error("[fulfillment] unexpected", err);
  res.status(500).json({ error: { message: CLIENT_MESSAGE.unknown } });
}

/**
 * Admin callers ARE allowed to see the real provider error (they're trusted and
 * need it to operate webhooks), unlike the neutralized client-facing `sendError`.
 */
function sendAdminError(res: Response, err: unknown): void {
  if (err instanceof FulfillmentError) {
    const status = err.status ?? (err.kind === "config" ? 503 : 502);
    console.error("[fulfillment-admin]", err.kind, status, err.message, err.details ?? "");
    res.status(status).json({ error: { message: err.message, kind: err.kind, details: err.details } });
    return;
  }
  console.error("[fulfillment-admin] unexpected", err);
  res.status(500).json({ error: { message: (err as Error)?.message ?? "Request failed." } });
}

/**
 * Strip the raw provider payload (and anything else provider-revealing) before
 * sending an order to the client. The browser must never learn the print
 * provider; the full payload is persisted server-side for admins instead.
 */
function neutralizeOrder(order: FulfillmentOrder): Omit<FulfillmentOrder, "raw"> {
  const { raw: _raw, ...rest } = order;
  return rest;
}

export function registerLuluRoutes(app: Express): void {
  const json = express.json({ limit: "60mb" });

  app.get("/print/products", (_req, res) => {
    res.json(provider().listProducts());
  });

  app.post("/print/cover-dimensions", json, async (req: Request, res: Response) => {
    try {
      const { sku, pages } = req.body as { sku: string; pages: number };
      res.json(await provider().getCoverDimensionsMm(sku, pages));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/print/quote", json, async (req: Request, res: Response) => {
    try {
      res.json(await provider().quote(req.body as QuoteRequest));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/print/order", json, async (req: AuthedRequest, res: Response) => {
    try {
      const body = req.body as Omit<OrderDraft, "assets"> & { assets?: WireAsset[] };
      const draft: OrderDraft = { ...body, assets: decodeAssets(body.assets) };
      const order = await provider().createOrder(draft);

      // Persist a neutral (user) + admin record. Best-effort: the order is
      // already placed, so a persistence failure must not fail the response.
      if (req.uid) {
        const cfg = serverConfig();
        try {
          await persistCreatedOrder({
            uid: req.uid,
            provider: "lulu",
            env: cfg.fulfillment.lulu.env,
            draft,
            order,
          });
        } catch (persistErr) {
          console.error("[fulfillment] failed to persist order", order.id, persistErr);
        }
      }

      res.json(neutralizeOrder(order));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/print/order/:id", async (req: Request, res: Response) => {
    try {
      res.json(neutralizeOrder(await provider().getOrder(req.params.id)));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/print/order/:id/cancel", async (req: Request, res: Response) => {
    try {
      res.json(neutralizeOrder(await provider().cancelOrder(req.params.id)));
    } catch (err) {
      sendError(res, err);
    }
  });

  // ---- Admin: status-webhook management (guarded by /admin in app.ts) -------
  // Lets an admin register/list/test/delete the provider status webhook without
  // touching the provider's own dashboard.

  app.post("/admin/print/webhooks", json, async (req: Request, res: Response) => {
    try {
      const { url } = (req.body ?? {}) as { url?: string };
      if (!url?.trim()) {
        res.status(400).json({ error: { message: "url is required." } });
        return;
      }
      const p = provider();
      if (!p.registerStatusWebhook) {
        res.status(501).json({ error: { message: "Provider does not support webhooks." } });
        return;
      }
      res.json(await p.registerStatusWebhook(url.trim()));
    } catch (err) {
      sendAdminError(res, err);
    }
  });

  app.get("/admin/print/webhooks", async (_req: Request, res: Response) => {
    try {
      const p = provider();
      res.json(p.listStatusWebhooks ? await p.listStatusWebhooks() : []);
    } catch (err) {
      sendAdminError(res, err);
    }
  });

  app.delete("/admin/print/webhooks/:id", async (req: Request, res: Response) => {
    try {
      const p = provider();
      if (p.deleteStatusWebhook) await p.deleteStatusWebhook(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      sendAdminError(res, err);
    }
  });

  app.post("/admin/print/webhooks/:id/test", async (req: Request, res: Response) => {
    try {
      const p = provider();
      if (p.testStatusWebhook) await p.testStatusWebhook(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      sendAdminError(res, err);
    }
  });
}

/** Timing-safe string comparison (returns false on length mismatch). */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Verify a Lulu webhook signature. Lulu sends HMAC-SHA256 of the RAW body keyed
 * by the account's API secret in the `Lulu-HMAC-SHA256` header. We accept either
 * hex or base64 encodings to be robust.
 */
function verifyWebhookSignature(raw: Buffer, signature: string, secret: string): boolean {
  if (!signature || !secret) return false;
  const sig = signature.trim();
  const hex = createHmac("sha256", secret).update(raw).digest("hex");
  const b64 = createHmac("sha256", secret).update(raw).digest("base64");
  return safeEqual(sig, hex) || safeEqual(sig, b64);
}

/**
 * Public webhook receiver for provider status callbacks. Mounted OUTSIDE the
 * `/print` (and `requireVerified`) guard because the provider sends no Firebase
 * token — authenticity is established via the HMAC signature instead. Uses a raw
 * body parser so the signature can be verified over the exact bytes received.
 */
export function registerPrintWebhookRoute(app: Express): void {
  app.post(
    "/print-webhook",
    express.raw({ type: "*/*", limit: "10mb" }),
    async (req: Request, res: Response) => {
      try {
        // Firebase Cloud Functions pre-reads the body and exposes the exact bytes
        // as `req.rawBody`; prefer it (the express.raw parser may find the stream
        // already consumed). Fall back to the parsed raw Buffer locally.
        const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
        const raw: Buffer = Buffer.isBuffer(rawBody)
          ? rawBody
          : Buffer.isBuffer(req.body)
            ? req.body
            : Buffer.from(typeof req.body === "string" ? req.body : "");
        const signature = req.get("Lulu-HMAC-SHA256") ?? "";
        const secret = serverConfig().fulfillment.lulu.clientSecret;

        if (!verifyWebhookSignature(raw, signature, secret)) {
          console.warn("[fulfillment] webhook signature verification failed");
          res.status(401).json({ error: { message: "Invalid signature." } });
          return;
        }

        let envelope: LuluWebhookEnvelope;
        try {
          envelope = JSON.parse(raw.toString("utf8")) as LuluWebhookEnvelope;
        } catch {
          res.status(400).json({ error: { message: "Invalid payload." } });
          return;
        }

        if (envelope.topic === "PRINT_JOB_STATUS_CHANGED" && envelope.data) {
          const order = mapOrder(envelope.data);
          const updated = await applyOrderStatusUpdate(order);
          if (!updated) {
            console.warn("[fulfillment] webhook for unknown order", order.id);
          }
        }

        res.json({ ok: true });
      } catch (err) {
        // 5xx so the provider retries; persistent failures auto-deactivate the
        // webhook (per Lulu), which is preferable to silently losing updates.
        console.error("[fulfillment] webhook handler error", err);
        res.status(500).json({ error: { message: "Webhook processing failed." } });
      }
    },
  );
}
