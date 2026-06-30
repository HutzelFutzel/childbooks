/**
 * Reports which AI providers the server has keys for, so the frontend can drive
 * its model selection without ever holding a key itself.
 */
import type { Express } from "express";
import { serverConfig } from "./config";

export function registerProviderRoutes(app: Express): void {
  app.get("/providers", (_req, res) => {
    const cfg = serverConfig();
    res.json({
      openai: Boolean(cfg.openaiApiKey),
      google: Boolean(cfg.googleApiKey),
    });
  });
}
