/**
 * Reports which AI providers the server has keys for — and their model lists —
 * so the frontend can drive its model selection without ever holding a key or
 * talking to a provider directly.
 */
import "./providerHttp";
import type { Express, Request, Response } from "express";
import { serverConfig } from "./config";
import { getTextProvider } from "../../books-frontend/src/core/providers";
import type { ProviderId } from "../../books-frontend/src/core/config/options";
import type { RawModel } from "../../books-frontend/src/core/providers/types";

const MODELS_TTL_MS = 10 * 60_000;
const modelsCache = new Map<ProviderId, { at: number; models: RawModel[] }>();

function keyFor(provider: ProviderId): string {
  const cfg = serverConfig();
  return (provider === "openai" ? cfg.openaiApiKey : cfg.googleApiKey) ?? "";
}

export function registerProviderRoutes(app: Express): void {
  app.get("/providers", (_req, res) => {
    res.json({
      openai: Boolean(keyFor("openai")),
      google: Boolean(keyFor("google")),
    });
  });

  // Model discovery, server-side: lists the provider's models with the
  // server-held key (cached ~10 min). This replaces the old transparent
  // `/proxy/*` relay — the client never talks to a provider anymore.
  app.get("/providers/models", async (req: Request, res: Response) => {
    const provider = String(req.query.provider ?? "") as ProviderId;
    if (provider !== "openai" && provider !== "google") {
      res.status(400).json({ error: { message: "Unknown provider." } });
      return;
    }
    const key = keyFor(provider);
    if (!key) {
      res.status(503).json({ error: { message: `${provider} is not configured on the server.` } });
      return;
    }
    const cached = modelsCache.get(provider);
    if (cached && Date.now() - cached.at < MODELS_TTL_MS) {
      res.json({ models: cached.models });
      return;
    }
    try {
      const models = await getTextProvider(provider).listModels({ apiKey: key });
      modelsCache.set(provider, { at: Date.now(), models });
      res.json({ models });
    } catch (err) {
      console.error(`[providers] model discovery failed (${provider})`, err);
      res.status(502).json({
        error: { message: `Couldn't list ${provider} models: ${(err as Error)?.message ?? "error"}` },
      });
    }
  });
}
