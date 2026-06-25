/**
 * HTTP abstraction shared by all provider adapters.
 *
 * - In Tauri we use the HTTP plugin's fetch, which performs the request from
 *   the Rust side and therefore bypasses browser CORS entirely.
 * - In the browser we use the native fetch. To avoid CORS / key-leak issues
 *   during development the requests are routed through the Vite dev proxy
 *   (see vite.config.ts) using provider-specific base paths.
 *
 * Both backends are fetch-compatible, so callers receive a standard Response.
 */
import type { ProviderId } from "../core/config/options";
import { isTauri } from "./runtime";

type FetchFn = typeof fetch;

let cachedFetch: FetchFn | null = null;

async function resolveFetch(): Promise<FetchFn> {
  if (cachedFetch) return cachedFetch;
  if (isTauri()) {
    const mod = await import("@tauri-apps/plugin-http");
    cachedFetch = mod.fetch as unknown as FetchFn;
  } else {
    cachedFetch = window.fetch.bind(window);
  }
  return cachedFetch;
}

/**
 * Base URL for a provider, accounting for platform.
 * Tauri: hit the provider directly. Browser: go through the dev proxy path.
 */
export function providerBaseUrl(provider: ProviderId): string {
  if (isTauri()) {
    return provider === "openai"
      ? "https://api.openai.com"
      : "https://generativelanguage.googleapis.com";
  }
  return provider === "openai" ? "/proxy/openai" : "/proxy/google";
}

export interface HttpResult {
  status: number;
  ok: boolean;
  response: Response;
}

export async function httpFetch(url: string, init?: RequestInit): Promise<Response> {
  const f = await resolveFetch();
  return f(url, init);
}
