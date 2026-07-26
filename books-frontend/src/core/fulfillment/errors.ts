/**
 * Typed errors for the fulfillment layer. Framework-agnostic so it can move to
 * a shared/backend package later.
 */

export type FulfillmentErrorKind =
  | "config" // missing/invalid configuration (api key, asset host)
  | "auth" // provider rejected credentials
  | "network" // transient network / 5xx
  | "rate_limit" // too many requests; the SAME request will work later
  | "validation" // provider rejected the request (4xx we caused)
  | "not_found" // order / resource missing
  | "upload" // asset upload failed
  | "parse" // unexpected response shape
  | "unknown";

/**
 * Whether re-sending the identical request could succeed.
 *
 * The distinction is not cosmetic. A `validation` failure is the provider
 * telling us something about the request — the SKU doesn't exist, the page
 * count is out of range — and we record that as a verdict. A `rate_limit` or
 * `network` failure tells us nothing about the request at all, and recording it
 * as a verdict writes a lie: a perfectly good SKU marked rejected because we
 * asked too fast.
 */
export function isRetryable(kind: FulfillmentErrorKind): boolean {
  return kind === "rate_limit" || kind === "network";
}

export interface FulfillmentErrorOptions {
  kind: FulfillmentErrorKind;
  provider?: string;
  status?: number;
  cause?: unknown;
  details?: string;
  /** How long the provider asked us to wait before retrying, if it said. */
  retryAfterMs?: number;
}

export class FulfillmentError extends Error {
  readonly kind: FulfillmentErrorKind;
  readonly provider?: string;
  readonly status?: number;
  readonly details?: string;
  readonly retryAfterMs?: number;

  constructor(message: string, options: FulfillmentErrorOptions) {
    super(message);
    this.name = "FulfillmentError";
    this.kind = options.kind;
    this.provider = options.provider;
    this.status = options.status;
    this.details = options.details;
    this.retryAfterMs = options.retryAfterMs;
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

/** Map an HTTP status code to a fulfillment error kind. */
export function fulfillmentKindFromStatus(status: number): FulfillmentErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not_found";
  // Ahead of the generic 4xx branch on purpose: 429 is the one 4xx that says
  // nothing about the request. Lumping it in with `validation` made a throttled
  // probe read as "the provider rejected this SKU".
  if (status === 429) return "rate_limit";
  if (status >= 500) return "network";
  if (status >= 400) return "validation";
  return "unknown";
}

/**
 * How long the provider asked us to wait, in milliseconds.
 *
 * `Retry-After` is either a delay in seconds or an HTTP date. Absent or
 * unparseable means the caller should fall back to its own backoff — never to
 * retrying immediately, which is what caused the problem in the first place.
 */
export function retryAfterMs(header: string | null | undefined): number | undefined {
  const raw = header?.trim();
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}
