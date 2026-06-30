/**
 * HTTP layer shared by the provider adapters.
 *
 * Provider requests are routed through the backend proxy (`/proxy/openai`,
 * `/proxy/google`), which injects the server-held API key. The client therefore
 * never sends a real key — whatever `Authorization` / `x-goog-api-key` the
 * adapters set is replaced server-side.
 */
import type { ProviderId } from "../core/config/options";
import { backendUrl, withAuthHeaders } from "./backend";

/** Base URL for a provider — always the backend proxy. */
export function providerBaseUrl(provider: ProviderId): string {
  return backendUrl(`/proxy/${provider}`);
}

export async function httpFetch(url: string, init?: RequestInit): Promise<Response> {
  // Provider requests always hit the backend proxy, so attach the auth token.
  const headers = await withAuthHeaders(init?.headers);
  return fetch(url, { ...init, headers });
}
