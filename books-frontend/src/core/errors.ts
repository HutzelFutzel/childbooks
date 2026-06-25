/**
 * Typed error model shared across the provider + pipeline layers.
 * Keeping this framework-agnostic so it can move to a backend package later.
 */

export type ProviderErrorKind =
  | "auth" // invalid / missing API key
  | "rate_limit" // 429 - should back off and retry
  | "transient" // network / 5xx - retryable
  | "invalid_request" // 4xx we caused - not retryable
  | "not_found" // model / endpoint missing
  | "parse" // response could not be parsed / validated
  | "aborted" // request cancelled
  | "unknown";

export interface ProviderErrorOptions {
  kind: ProviderErrorKind;
  provider?: string;
  status?: number;
  cause?: unknown;
  retryable?: boolean;
  details?: string;
}

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly provider?: string;
  readonly status?: number;
  readonly retryable: boolean;
  readonly details?: string;

  constructor(message: string, options: ProviderErrorOptions) {
    super(message);
    this.name = "ProviderError";
    this.kind = options.kind;
    this.provider = options.provider;
    this.status = options.status;
    this.details = options.details;
    this.retryable =
      options.retryable ??
      (options.kind === "rate_limit" || options.kind === "transient");
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

/** Whether an error represents a cancelled/aborted request (no toast needed). */
export function isAbortError(err: unknown): boolean {
  if (err instanceof ProviderError) return err.kind === "aborted";
  if (err instanceof DOMException) return err.name === "AbortError";
  if (err instanceof Error) return err.name === "AbortError" || /\babort(ed)?\b/i.test(err.message);
  return false;
}

/** Map an HTTP status code to a sensible error kind. */
export function kindFromStatus(status: number): ProviderErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "transient";
  if (status >= 400) return "invalid_request";
  return "unknown";
}

/** Produce a short, user-facing message for an error. */
export function describeError(err: unknown): string {
  if (err instanceof ProviderError) {
    switch (err.kind) {
      case "auth":
        return `Authentication failed${
          err.provider ? ` for ${err.provider}` : ""
        }. Check your API key in Settings.`;
      case "rate_limit":
        return "Rate limit reached. The app will retry automatically.";
      case "transient":
        return "A temporary network/server issue occurred. Retrying…";
      case "not_found":
        return err.message || "The requested model or resource was not found.";
      case "parse":
        return "The model returned an unexpected response. Try again.";
      case "aborted":
        return "The request was cancelled.";
      default:
        return err.message || "Something went wrong.";
    }
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
