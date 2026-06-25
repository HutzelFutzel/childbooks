/**
 * Typed errors for the fulfillment layer. Framework-agnostic so it can move to
 * a shared/backend package later.
 */

export type FulfillmentErrorKind =
  | "config" // missing/invalid configuration (api key, asset host)
  | "auth" // provider rejected credentials
  | "network" // transient network / 5xx
  | "validation" // provider rejected the request (4xx we caused)
  | "not_found" // order / resource missing
  | "upload" // asset upload failed
  | "parse" // unexpected response shape
  | "unknown";

export interface FulfillmentErrorOptions {
  kind: FulfillmentErrorKind;
  provider?: string;
  status?: number;
  cause?: unknown;
  details?: string;
}

export class FulfillmentError extends Error {
  readonly kind: FulfillmentErrorKind;
  readonly provider?: string;
  readonly status?: number;
  readonly details?: string;

  constructor(message: string, options: FulfillmentErrorOptions) {
    super(message);
    this.name = "FulfillmentError";
    this.kind = options.kind;
    this.provider = options.provider;
    this.status = options.status;
    this.details = options.details;
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

/** Map an HTTP status code to a fulfillment error kind. */
export function fulfillmentKindFromStatus(status: number): FulfillmentErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not_found";
  if (status >= 500) return "network";
  if (status >= 400) return "validation";
  return "unknown";
}
