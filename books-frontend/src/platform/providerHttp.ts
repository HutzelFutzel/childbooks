/**
 * Frontend binding for the core provider HTTP context.
 *
 * Points the provider adapters at the backend proxy (`/proxy/openai`,
 * `/proxy/google`), which injects the server-held API key. Importing this module
 * for its side effect configures the binding; do so before any provider call.
 */
import { setProviderHttp } from "../core/providers/httpContext";
import { httpFetch, providerBaseUrl } from "./http";

setProviderHttp({ baseUrl: providerBaseUrl, fetch: httpFetch });
