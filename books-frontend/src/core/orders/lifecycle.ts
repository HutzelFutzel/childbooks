/**
 * The print-order lifecycle — pure, no I/O.
 *
 * One record per CUSTOMER order (`printOrders/{paymentId}`) holds everything we
 * know about it: the payment, every print-provider job placed for it, the
 * provider's last status, milestone timestamps, emails sent, and whether it needs
 * a human. This module owns the two decisions that record exists to make:
 *
 *   - {@link deriveState}      — where is the order, in our own words?
 *   - {@link evaluateAttention} — does it need a person right now, and why?
 *
 * Both the backend (which writes the record and pings Slack) and the admin
 * dashboard (which shows the queue) import this file, so the Slack alert and the
 * "Needs attention" list can never disagree: they are the same function.
 */

/** Where an order stands, provider-neutral. */
export type PrintOrderState =
  | "paid" // payment settled, nothing sent to the printer yet
  | "preparing_files" // paid; the print-resolution files are being made
  | "placing" // a worker holds the placement claim right now
  | "retrying" // placement (or a replacement) failed and will be retried
  | "placed" // the printer has the job, not started
  | "in_production"
  | "on_hold" // the printer is holding it (payment, delay, address)
  | "shipped" // last stage the printer reports; there is no "delivered"
  | "failed" // placement retries exhausted — a person must act
  | "rejected" // the printer killed the job and no replacement is coming
  | "cancelled"
  | "refunded";

export const PRINT_ORDER_STATES: readonly PrintOrderState[] = [
  "paid",
  "preparing_files",
  "placing",
  "retrying",
  "placed",
  "in_production",
  "on_hold",
  "shipped",
  "failed",
  "rejected",
  "cancelled",
  "refunded",
];

export const PRINT_ORDER_STATE_LABEL: Record<PrintOrderState, string> = {
  paid: "Paid",
  preparing_files: "Preparing files",
  placing: "Placing",
  retrying: "Retrying",
  placed: "At printer",
  in_production: "In production",
  on_hold: "On hold",
  shipped: "Shipped",
  failed: "Failed",
  rejected: "Rejected",
  cancelled: "Canceled",
  refunded: "Refunded",
};

/** States that will never move again by themselves. */
export const TERMINAL_ORDER_STATES: ReadonlySet<PrintOrderState> = new Set<PrintOrderState>([
  "shipped",
  "cancelled",
  "refunded",
]);

/** Why an order needs a human. Ordered by how early in the lifecycle it bites. */
export type AttentionReason =
  | "files_not_ready"
  | "not_placed"
  | "placement_failed"
  | "rejected"
  | "refunded_active"
  | "provider_unpaid"
  | "on_hold"
  | "stuck_in_production"
  | "sync_stale";

export const ATTENTION_REASON_LABEL: Record<AttentionReason, string> = {
  files_not_ready: "Print files still not ready",
  not_placed: "Paid but not sent to the printer",
  placement_failed: "Printer placement failed",
  rejected: "Printer rejected the job",
  refunded_active: "Refunded but the print job is still active",
  provider_unpaid: "Printer is waiting for our payment",
  on_hold: "Printer is holding the job",
  stuck_in_production: "Not shipped after too long",
  sync_stale: "No status update from the printer",
};

/** What to do about each reason. Shown in the queue and in the Slack message. */
export const ATTENTION_REASON_ACTION: Record<AttentionReason, string> = {
  files_not_ready:
    "The print-file preparation is past its deadline and did not fall back by itself. Open the order and choose \"Place with standard files\" — the book is printable as it is.",
  not_placed: "Open the order and retry placement. If it keeps failing, check the printer connection and the error below.",
  placement_failed: "Retries are exhausted. Fix the cause (see the error), then retry placement — or refund the customer.",
  rejected: "The printer will not make this book. Check the rejection reason: re-place it, or refund the customer.",
  refunded_active: "Cancel the job at the printer before production starts, or you pay for a book nobody will receive.",
  provider_unpaid: "The printer is not producing until its invoice is paid. Check the payment method on the printer account.",
  on_hold: "Open the job at the printer — it is usually waiting for an address confirmation or a file fix.",
  stuck_in_production: "Ask the printer for a status. If it is lost, re-place the order or refund.",
  sync_stale: "We have not heard from the printer about this order. Run a sync; if it still fails, check the order at the printer.",
};

/** Thresholds, in ms. Exported so the dashboard can show the same numbers. */
export const ATTENTION_THRESHOLDS = {
  /** Paid, still not placed. Retries run every 30 minutes, so this is ~4 tries. */
  notPlacedMs: 2 * 60 * 60 * 1000,
  /** UNPAID / PAYMENT_IN_PROGRESS normally clears in minutes. */
  providerUnpaidMs: 2 * 60 * 60 * 1000,
  /** PRODUCTION_DELAYED and friends. */
  onHoldMs: 24 * 60 * 60 * 1000,
  /** Placed → shipped. ~10 business days. */
  stuckInProductionMs: 14 * 24 * 60 * 60 * 1000,
  /** No webhook and no poll touched an open placed order for this long. */
  syncStaleMs: 6 * 60 * 60 * 1000,
  /**
   * Preparation past its own deadline by this much. The sweep falls back to the
   * standard files AT the deadline, so reaching this means the fallback itself
   * did not run.
   */
  filesNotReadyGraceMs: 15 * 60 * 1000,
} as const;

/** Where the print-resolution preparation of a paid order stands. */
export type PrintPrepStatus =
  | "planning"
  | "upscaling"
  | "rendering"
  | "verifying"
  | "ready" // print-resolution files are in place
  | "fallback" // placed (or placing) with the standard files
  | "skipped"; // nothing to prepare (disabled, no cached render, already sharp)

export const ACTIVE_PRINT_PREP_STATUSES: ReadonlySet<PrintPrepStatus> = new Set<PrintPrepStatus>([
  "planning",
  "upscaling",
  "rendering",
  "verifying",
]);

export const PRINT_PREP_STATUS_LABEL: Record<PrintPrepStatus, string> = {
  planning: "Measuring pictures",
  upscaling: "Upscaling pictures",
  rendering: "Rendering at print resolution",
  verifying: "Checking the files",
  ready: "Print resolution",
  fallback: "Standard files (fell back)",
  skipped: "Standard files (not needed)",
};

/** The order record's view of its print-file preparation (`printPrep/{paymentId}` holds the rest). */
export interface PrintOrderPrintPrep {
  status: PrintPrepStatus;
  startedAt: number;
  deadlineAt: number;
  finishedAt: number | null;
  /** Why it fell back or was skipped, in plain words. */
  reason: string | null;
  images: { total: number; done: number; failed: number };
  /** What the images were upscaled with: provider id → count. */
  tiers: Record<string, number>;
  costUsd: number;
}

/** Raw provider statuses (Lulu's names) the lifecycle understands. */
export const PROVIDER_STATUS = {
  created: "CREATED",
  unpaid: "UNPAID",
  paymentInProgress: "PAYMENT_IN_PROGRESS",
  productionDelayed: "PRODUCTION_DELAYED",
  productionReady: "PRODUCTION_READY",
  inProduction: "IN_PRODUCTION",
  shipped: "SHIPPED",
  canceled: "CANCELED",
  rejected: "REJECTED",
  error: "ERROR",
} as const;

export interface PrintOrderEmails {
  confirmationAt: number | null;
  shippedAt: number | null;
  failedAt: number | null;
  lastError: string | null;
}

export interface PrintOrderShipment {
  carrier: string | null;
  trackingUrl: string | null;
  trackingNumber: string | null;
}

export interface PrintOrderMoney {
  amount: number;
  currency: string;
}

export interface PrintOrderAttention {
  reason: AttentionReason;
  detail: string;
  /** When this reason first applied (stable across evaluations). */
  since: number;
}

export interface PrintOrderAck {
  reason: AttentionReason;
  at: number;
  by: string;
  note: string;
}

/**
 * The canonical record. Timestamps are epoch ms, absent values are `null`, so the
 * document round-trips through Firestore and JSON unchanged.
 */
export interface PrintOrderRecord {
  key: string;
  paymentId: string | null;
  uid: string | null;
  projectId: string | null;
  /** "sandbox" | "live" — which printer environment holds the job. */
  env: string | null;

  // ---- What was bought
  sku: string | null;
  copies: number | null;
  pages: number | null;
  shippingMethod: string | null;
  destinationCountry: string | null;
  recipientName: string | null;
  recipientEmail: string | null;

  // ---- Printer jobs
  jobIds: string[];
  currentJobId: string | null;
  luluStatus: string | null;
  /** Normalized stage of the current job (OrderStage). */
  stage: string | null;
  /** When the current job entered its current status. */
  stageSince: number | null;
  /** The printer rejected the job and a replacement is queued. */
  autoReplacing: boolean;
  addressCorrected: boolean;
  shipments: PrintOrderShipment[];
  files: { interior: string | null; cover: string | null };
  /** Absent on records written before print-file preparation existed. */
  printPrep?: PrintOrderPrintPrep | null;

  // ---- Payment
  paymentStatus: string | null;
  amountPaid: number | null;
  currency: string | null;
  refundedAmount: number;
  /** The payment doc's own fulfillment state (pending/placing/retrying/placed/failed). */
  fulfillmentState: string | null;
  attempts: number;
  lastError: string | null;

  // ---- Money
  estimatedCost: PrintOrderMoney | null;
  actualCost: PrintOrderMoney | null;

  // ---- Lifecycle
  state: PrintOrderState;
  /** Not yet terminal — the sweeps and the queue only look at these. */
  open: boolean;

  // ---- Milestones
  paidAt: number | null;
  placedAt: number | null;
  inProductionAt: number | null;
  shippedAt: number | null;
  rejectedAt: number | null;
  cancelledAt: number | null;
  refundedAt: number | null;
  failedAt: number | null;

  // ---- Provenance of the freshest information
  lastWebhookAt: number | null;
  lastSyncAt: number | null;
  lastUpdateSource: string | null;
  /** Our state and the printer's disagreed at the last reconcile. */
  driftAt: number | null;
  /** How many status changes each channel was the first to deliver. */
  changeSources: { webhook: number; poll: number; system: number };

  emails: PrintOrderEmails;

  // ---- Attention
  needsAttention: boolean;
  attention: PrintOrderAttention | null;
  ack: PrintOrderAck | null;

  createdAt: number;
  updatedAt: number;
}

/** A blank record for a key, so writers can merge into something total. */
export function emptyPrintOrder(key: string, now: number): PrintOrderRecord {
  return {
    key,
    paymentId: null,
    uid: null,
    projectId: null,
    env: null,
    sku: null,
    copies: null,
    pages: null,
    shippingMethod: null,
    destinationCountry: null,
    recipientName: null,
    recipientEmail: null,
    jobIds: [],
    currentJobId: null,
    luluStatus: null,
    stage: null,
    stageSince: null,
    autoReplacing: false,
    addressCorrected: false,
    shipments: [],
    files: { interior: null, cover: null },
    printPrep: null,
    paymentStatus: null,
    amountPaid: null,
    currency: null,
    refundedAmount: 0,
    fulfillmentState: null,
    attempts: 0,
    lastError: null,
    estimatedCost: null,
    actualCost: null,
    state: "paid",
    open: true,
    paidAt: null,
    placedAt: null,
    inProductionAt: null,
    shippedAt: null,
    rejectedAt: null,
    cancelledAt: null,
    refundedAt: null,
    failedAt: null,
    lastWebhookAt: null,
    lastSyncAt: null,
    lastUpdateSource: null,
    driftAt: null,
    changeSources: { webhook: 0, poll: 0, system: 0 },
    emails: { confirmationAt: null, shippedAt: null, failedAt: null, lastError: null },
    needsAttention: false,
    attention: null,
    ack: null,
    createdAt: now,
    updatedAt: now,
  };
}

type StateInputs = Pick<
  PrintOrderRecord,
  "luluStatus" | "currentJobId" | "fulfillmentState" | "paymentStatus" | "autoReplacing" | "printPrep"
>;

/** Whether a provider status means the job is alive (could still be printed). */
export function providerJobIsLive(status: string | null | undefined): boolean {
  if (!status) return false;
  const s = status.toUpperCase();
  return s !== PROVIDER_STATUS.canceled && s !== PROVIDER_STATUS.rejected && s !== PROVIDER_STATUS.error;
}

/** Where the order stands, from the printer's status and our own payment state. */
export function deriveState(r: StateInputs): PrintOrderState {
  const refunded = r.paymentStatus === "refunded";

  if (r.luluStatus && r.currentJobId) {
    const s = r.luluStatus.toUpperCase();
    switch (s) {
      case PROVIDER_STATUS.shipped:
        return "shipped";
      case PROVIDER_STATUS.canceled:
        return refunded ? "refunded" : "cancelled";
      case PROVIDER_STATUS.rejected:
      case PROVIDER_STATUS.error:
        return r.autoReplacing ? "retrying" : refunded ? "refunded" : "rejected";
      case PROVIDER_STATUS.productionReady:
      case PROVIDER_STATUS.inProduction:
        return "in_production";
      case PROVIDER_STATUS.unpaid:
      case PROVIDER_STATUS.paymentInProgress:
      case PROVIDER_STATUS.productionDelayed:
        return "on_hold";
      default:
        return "placed";
    }
  }

  if (refunded) return "refunded";
  switch (r.fulfillmentState) {
    case "failed":
      return "failed";
    case "retrying":
      return "retrying";
    case "placing":
      return "placing";
    case "placed":
      return "placed";
    default:
      return r.printPrep && ACTIVE_PRINT_PREP_STATUSES.has(r.printPrep.status) ? "preparing_files" : "paid";
  }
}

/** Whether the order can still change by itself (the sweeps only look at these). */
export function isOpenState(state: PrintOrderState): boolean {
  return !TERMINAL_ORDER_STATES.has(state);
}

const hours = (ms: number) => Math.max(1, Math.round(ms / 3_600_000));
const ago = (ms: number) => {
  const h = hours(ms);
  return h >= 48 ? `${Math.round(h / 24)} days` : `${h} h`;
};

type AttentionInputs = Pick<
  PrintOrderRecord,
  | "state"
  | "luluStatus"
  | "paymentStatus"
  | "paidAt"
  | "createdAt"
  | "placedAt"
  | "stageSince"
  | "lastWebhookAt"
  | "lastSyncAt"
  | "lastError"
  | "refundedAmount"
  | "ack"
  | "attention"
  | "printPrep"
>;

/**
 * Does this order need a person right now? Returns the FIRST reason that applies
 * (most urgent first), or null.
 *
 * `since` is carried over from the previous evaluation while the same reason keeps
 * applying, so "waiting 3 h" is measured from when it first went wrong rather than
 * from the latest sweep.
 */
export function evaluateAttention(r: AttentionInputs, now: number): PrintOrderAttention | null {
  const found = firstReason(r, now);
  if (!found) return null;
  // A human already looked at exactly this and said "handled" — stay quiet until
  // the state changes (the writer clears the acknowledgement then).
  if (r.ack && r.ack.reason === found.reason) return null;
  const since = r.attention && r.attention.reason === found.reason ? r.attention.since : now;
  return { reason: found.reason, detail: found.detail, since };
}

function firstReason(
  r: AttentionInputs,
  now: number,
): { reason: AttentionReason; detail: string } | null {
  const t = ATTENTION_THRESHOLDS;
  const liveJob = r.state === "placed" || r.state === "in_production" || r.state === "on_hold";
  const error = r.lastError ? ` Last error: ${r.lastError.slice(0, 300)}` : "";

  // Money went back to the customer but the job can still be printed and billed.
  if (liveJob && (r.paymentStatus === "refunded" || r.paymentStatus === "partially_refunded") && r.refundedAmount > 0) {
    return {
      reason: "refunded_active",
      detail: `The payment was ${r.paymentStatus === "refunded" ? "fully" : "partially"} refunded but the print job is still ${r.luluStatus ?? "active"}.`,
    };
  }

  if (r.state === "failed") {
    return { reason: "placement_failed", detail: `Retries are exhausted.${error}` };
  }
  if (r.state === "rejected") {
    return { reason: "rejected", detail: `The printer rejected the job and it is not being re-placed.${error}` };
  }

  if (r.state === "preparing_files" && r.printPrep) {
    const over = now - r.printPrep.deadlineAt;
    if (over > t.filesNotReadyGraceMs) {
      const { done, total, failed } = r.printPrep.images;
      return {
        reason: "files_not_ready",
        detail: `Preparing the print files for ${ago(now - r.printPrep.startedAt)} (${r.printPrep.status}, ${done}/${total} pictures, ${failed} failed) — past the deadline and the fallback did not run.`,
      };
    }
    // Waiting on its own (admin-set) deadline, which may be longer than `notPlacedMs`.
    return null;
  }

  if (r.state === "paid" || r.state === "preparing_files" || r.state === "placing" || r.state === "retrying") {
    // A retry is measured from when it BEGAN: a job rejected on day three is a
    // fresh problem, not one already three days old.
    const basis = r.state === "retrying" ? (r.stageSince ?? r.paidAt ?? r.createdAt) : (r.paidAt ?? r.createdAt);
    const waited = now - basis;
    if (waited > t.notPlacedMs) {
      return { reason: "not_placed", detail: `Paid ${ago(waited)} ago and still not at the printer.${error}` };
    }
    return null;
  }

  if (r.state === "on_hold") {
    const status = (r.luluStatus ?? "").toUpperCase();
    const waited = now - (r.stageSince ?? r.placedAt ?? r.createdAt);
    if (
      (status === PROVIDER_STATUS.unpaid || status === PROVIDER_STATUS.paymentInProgress) &&
      waited > t.providerUnpaidMs
    ) {
      return { reason: "provider_unpaid", detail: `The printer has shown ${status} for ${ago(waited)}.` };
    }
    if (waited > t.onHoldMs && status !== PROVIDER_STATUS.unpaid && status !== PROVIDER_STATUS.paymentInProgress) {
      return { reason: "on_hold", detail: `On hold (${status || "unknown"}) for ${ago(waited)}.` };
    }
  }

  if (liveJob) {
    if (r.placedAt && now - r.placedAt > t.stuckInProductionMs) {
      return {
        reason: "stuck_in_production",
        detail: `Placed ${ago(now - r.placedAt)} ago, status ${r.luluStatus ?? "unknown"}, not shipped.`,
      };
    }
    const lastContact = Math.max(r.lastWebhookAt ?? 0, r.lastSyncAt ?? 0, r.placedAt ?? 0);
    if (lastContact > 0 && now - lastContact > t.syncStaleMs) {
      return { reason: "sync_stale", detail: `No update from the printer for ${ago(now - lastContact)}.` };
    }
  }
  return null;
}

/** Merge helper used by the writer: the fields a patch may set, minus derived ones. */
export type PrintOrderPatch = Partial<
  Omit<PrintOrderRecord, "key" | "state" | "open" | "needsAttention" | "attention" | "createdAt" | "updatedAt">
>;

/**
 * Apply a patch and re-derive everything that follows from it (state, open,
 * attention). The ONE place those derivations happen, so no caller can set a
 * state that disagrees with the facts under it.
 */
export function applyPatch(
  current: PrintOrderRecord,
  patch: PrintOrderPatch,
  now: number,
): PrintOrderRecord {
  const jobIds = patch.jobIds
    ? Array.from(new Set([...current.jobIds, ...patch.jobIds]))
    : current.jobIds;
  const merged: PrintOrderRecord = {
    ...current,
    ...patch,
    jobIds,
    emails: { ...current.emails, ...(patch.emails ?? {}) },
    files: { ...current.files, ...(patch.files ?? {}) },
    changeSources: { ...current.changeSources, ...(patch.changeSources ?? {}) },
    updatedAt: now,
  };

  const state = deriveState(merged);
  const stateChanged = state !== current.state;
  const statusChanged = merged.luluStatus !== current.luluStatus || merged.currentJobId !== current.currentJobId;
  merged.state = state;
  merged.open = isOpenState(state);

  // Milestones: stamped once, the first time the order reaches them.
  if (merged.paymentStatus && merged.paymentStatus !== "pending" && merged.paidAt == null) {
    merged.paidAt = now;
  }
  if (merged.currentJobId && merged.placedAt == null) merged.placedAt = now;
  if (state === "in_production" && merged.inProductionAt == null) merged.inProductionAt = now;
  if (state === "shipped" && merged.shippedAt == null) merged.shippedAt = now;
  if (state === "rejected" && merged.rejectedAt == null) merged.rejectedAt = now;
  if (state === "cancelled" && merged.cancelledAt == null) merged.cancelledAt = now;
  if (state === "refunded" && merged.refundedAt == null) merged.refundedAt = now;
  if (state === "failed" && merged.failedAt == null) merged.failedAt = now;
  // An explicit `stageSince` (the backfill, which knows the real history) wins.
  if (patch.stageSince == null && (statusChanged || stateChanged || merged.stageSince == null)) {
    merged.stageSince = now;
  }

  // A new state invalidates "someone already handled this".
  if (stateChanged) merged.ack = null;

  const attention = evaluateAttention(merged, now);
  merged.attention = attention;
  merged.needsAttention = attention !== null;
  return merged;
}

/** A job that produces every provider-status string we may see, for tests/UI filters. */
export const OPEN_PROVIDER_STATUSES: readonly string[] = [
  PROVIDER_STATUS.created,
  PROVIDER_STATUS.unpaid,
  PROVIDER_STATUS.paymentInProgress,
  PROVIDER_STATUS.productionDelayed,
  PROVIDER_STATUS.productionReady,
  PROVIDER_STATUS.inProduction,
];

// ---- Placement keys ------------------------------------------------------------

/**
 * The key that identifies one placement attempt at the provider (its `external_id`).
 *
 * The first job for a payment uses the payment id. Once a job has been rejected,
 * its replacement MUST use a different key: the provider search is by external id,
 * so reusing it would find the dead job again — and the "recovery" would re-link
 * the payment to a job that makes nothing, while looking like success.
 */
export function placementKeyFor(paymentId: string, rejectedJobs: number): string {
  return rejectedJobs > 0 ? `${paymentId}:r${rejectedJobs}` : paymentId;
}

/** The payment id inside an `external_id` (`<paymentId>` or `<paymentId>:r2`). */
export function paymentIdFromExternalId(externalId: string | null | undefined): string | null {
  if (!externalId) return null;
  return externalId.replace(/:r\d+$/, "") || null;
}
