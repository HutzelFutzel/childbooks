/**
 * Transparent reverse proxy for the AI providers.
 *
 * The frontend's provider adapters are unchanged — they just point their base
 * URL at `/proxy/openai` and `/proxy/google` (see books-frontend platform/http).
 * This proxy forwards the request verbatim to the real provider, injecting the
 * server-held API key and stripping any key the client may have sent. That's
 * how the OpenAI / Gemini secrets stay entirely on the backend.
 */
import express, { type Express, type Request, type Response } from "express";
import { serverConfig } from "./config";

type Provider = "openai" | "google";

const UPSTREAM: Record<Provider, string> = {
  openai: "https://api.openai.com",
  google: "https://generativelanguage.googleapis.com",
};

async function forward(provider: Provider, req: Request, res: Response): Promise<void> {
  const cfg = serverConfig();
  const key = provider === "openai" ? cfg.openaiApiKey : cfg.googleApiKey;
  if (!key) {
    res.status(503).json({
      error: { message: `${provider} API key is not configured on the server.` },
    });
    return;
  }

  const subPath = req.originalUrl.replace(new RegExp(`^/proxy/${provider}`), "");
  const url = new URL(UPSTREAM[provider] + (subPath.startsWith("/") ? subPath : `/${subPath}`));
  // Never trust a client-supplied key in the query string.
  url.searchParams.delete("key");

  const headers = new Headers();
  const contentType = req.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  const accept = req.get("accept");
  if (accept) headers.set("accept", accept);
  if (provider === "openai") headers.set("authorization", `Bearer ${key}`);
  else headers.set("x-goog-api-key", key);

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const body = hasBody && Buffer.isBuffer(req.body) && req.body.length > 0 ? req.body : undefined;

  let upstream: globalThis.Response;
  try {
    upstream = await fetch(url, { method: req.method, headers, body });
  } catch (err) {
    res.status(502).json({
      error: { message: `Upstream ${provider} request failed: ${(err as Error).message}` },
    });
    return;
  }

  res.status(upstream.status);
  const respType = upstream.headers.get("content-type");
  if (respType) res.set("content-type", respType);
  const buf = Buffer.from(await upstream.arrayBuffer());
  res.send(buf);
}

export function registerProxyRoutes(app: Express): void {
  const raw = express.raw({ type: () => true, limit: "50mb" });
  app.use("/proxy/openai", raw, (req, res) => void forward("openai", req, res));
  app.use("/proxy/google", raw, (req, res) => void forward("google", req, res));
}
