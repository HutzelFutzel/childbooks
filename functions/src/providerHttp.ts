/**
 * Backend binding for the core provider HTTP context.
 *
 * Unlike the frontend (which routes through the proxy), the worker calls the
 * upstream provider APIs directly with the real server-held key passed as
 * credentials. Importing this module for its side effect configures the binding.
 */
import { setProviderHttp } from "../../books-frontend/src/core/providers/httpContext";
import type { ProviderId } from "../../books-frontend/src/core/config/options";
import { meteredFetch } from "./usage";

const UPSTREAM: Record<ProviderId, string> = {
  openai: "https://api.openai.com",
  google: "https://generativelanguage.googleapis.com",
};

setProviderHttp({
  baseUrl: (provider) => UPSTREAM[provider],
  // Metered fetch records token usage from each provider response (best-effort)
  // while leaving the response untouched for the caller.
  fetch: (url, init) => meteredFetch(url, init),
});
