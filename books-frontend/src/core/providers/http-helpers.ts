/**
 * Shared request helpers for provider adapters: perform a fetch via the
 * platform HTTP layer and normalize failures into ProviderError.
 */
import type { ProviderId } from "../config/options";
import { kindFromStatus, ProviderError } from "../errors";
import { providerHttp } from "./httpContext";

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

function extractMessage(body: string): string | undefined {
  if (!body) return undefined;
  try {
    const json = JSON.parse(body);
    return (
      json?.error?.message ??
      json?.error?.[0]?.message ??
      json?.message ??
      undefined
    );
  } catch {
    return body.slice(0, 300);
  }
}

export async function requestJson<T>(
  provider: ProviderId,
  url: string,
  init: RequestInit,
): Promise<T> {
  let res: Response;
  try {
    res = await providerHttp().fetch(url, init);
  } catch (err) {
    if (isAbort(err)) {
      throw new ProviderError("Request aborted", { kind: "aborted", provider, cause: err });
    }
    throw new ProviderError("Network request failed", {
      kind: "transient",
      provider,
      cause: err,
    });
  }

  if (!res.ok) {
    const body = await safeText(res);
    const message = extractMessage(body);
    throw new ProviderError(
      message || `${provider} request failed with status ${res.status}`,
      { kind: kindFromStatus(res.status), provider, status: res.status, details: body },
    );
  }

  try {
    return (await res.json()) as T;
  } catch (err) {
    throw new ProviderError("Failed to parse provider response", {
      kind: "parse",
      provider,
      cause: err,
    });
  }
}
