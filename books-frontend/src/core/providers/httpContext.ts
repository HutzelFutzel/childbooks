/**
 * Injectable HTTP binding for the provider adapters.
 *
 * Core providers must not depend on a specific platform: the frontend points
 * them at the backend proxy (which injects the server-held key), while the
 * backend worker points them straight at the upstream API with the real key.
 * Each environment calls {@link setProviderHttp} once at startup.
 */
import type { ProviderId } from "../config/options";

export type ProviderFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface ProviderHttp {
  /** Base URL for a provider's API (no trailing slash). */
  baseUrl: (provider: ProviderId) => string;
  /** Fetch implementation used for all provider requests. */
  fetch: ProviderFetch;
}

let current: ProviderHttp | null = null;

export function setProviderHttp(http: ProviderHttp): void {
  current = http;
}

export function providerHttp(): ProviderHttp {
  if (!current) {
    throw new Error(
      "Provider HTTP is not configured. Call setProviderHttp() during startup.",
    );
  }
  return current;
}
