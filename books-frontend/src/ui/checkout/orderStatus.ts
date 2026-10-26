/**
 * How order + fulfillment state is described to customers.
 *
 * One place, because the same states are shown in three: the orders list, the
 * order-confirmation screen, and the receipts list. Wording that drifts between
 * them is worse than wording that's merely imperfect — someone comparing two
 * screens concludes something has gone wrong.
 */
import type { OrderRecord, OrderStage } from "../../core/fulfillment/types";
import type { FulfillmentState, UserPaymentRecord } from "../../platform/payments";

export interface StatusDescriptor {
  label: string;
  /** Tailwind classes for a pill badge. */
  badge: string;
}

export const STAGE_STATUS: Record<OrderStage, StatusDescriptor> = {
  draft: { label: "Received", badge: "bg-ink-100 text-ink-600" },
  // Not "needs attention": nothing a customer can do clears a hold at the printer.
  onHold: { label: "Delayed", badge: "bg-amber-100 text-amber-700" },
  inProgress: { label: "In production", badge: "bg-sky-100 text-sky-700" },
  complete: { label: "Shipped", badge: "bg-emerald-100 text-emerald-700" },
  cancelled: { label: "Canceled", badge: "bg-ink-100 text-ink-500" },
  error: { label: "Issue", badge: "bg-rose-100 text-rose-700" },
};

/**
 * What a paid order's fulfillment state means to the person who paid.
 *
 * `retrying` deliberately reads as reassurance rather than an error: the sweep
 * is still working on it and there is nothing for the customer to do. Only
 * `failed` — the retry budget spent — asks them to expect contact from us.
 */
export const FULFILLMENT_STATUS: Record<
  FulfillmentState,
  { label: string; detail: string; tone: "info" | "success" | "warning" | "danger" }
> = {
  pending: {
    label: "Preparing for print",
    detail: "We're sending your book to the press. This usually takes a minute or two.",
    tone: "info",
  },
  placed: {
    label: "At the press",
    detail: "Your book is with our print partner. You'll get tracking as soon as it ships.",
    tone: "success",
  },
  // Wording covers both ways this goes wrong — never reaching the press, and
  // being turned away by it — because the customer can't tell those apart and
  // doesn't benefit from being asked to.
  retrying: {
    label: "Still working on it",
    detail:
      "Getting your book onto the press didn't work first time, so we're trying again " +
      "automatically. Nothing for you to do — and you won't be charged again.",
    tone: "warning",
  },
  failed: {
    label: "Needs our attention",
    detail:
      "We couldn't get this book onto the press. Our team has been alerted and will be in " +
      "touch about a reprint or a refund. You won't be charged twice.",
    tone: "danger",
  },
};

/**
 * What each printer stage means, in our words. The printer's own notes are
 * written for its operators — file names, field codes — and stay with support.
 */
export const STAGE_DETAIL: Record<OrderStage, string> = {
  draft: "We've sent your book to our print partner.",
  onHold:
    "Your book is waiting at our print partner. We're already on it — there's nothing you need to do.",
  inProgress: "Your book is being printed. You'll get tracking as soon as it ships.",
  complete: "Your book has shipped.",
  cancelled: "This print job was canceled. Our team will email you about a reprint or a refund.",
  error: FULFILLMENT_STATUS.failed.detail,
};

/** True when an order's state is one worth flagging to the customer. */
export function orderNeedsAttention(stage: OrderStage): boolean {
  return stage === "error";
}

/** How a paid print order is really doing. See {@link orderHealth}. */
export type OrderHealth =
  /** On its way, as far as anyone knows. */
  | "ok"
  /** Something went wrong and we're still trying, unprompted. */
  | "working"
  /** Nothing more will happen without a person. */
  | "stuck"
  /** Canceled, or refunded: no book is coming. */
  | "cancelled";

/**
 * The one sentence describing where a paid order stands, for every surface
 * that shows one. Our own note on the payment (set when we've told the customer
 * something specific) wins; then the refund; then the printer's stage.
 */
export function orderStatusDetail(payment: UserPaymentRecord | null, order: OrderRecord | null): string {
  if (payment?.fulfillmentIssue) return payment.fulfillmentIssue;
  if (payment?.status === "refunded") {
    return "This order was canceled and refunded in full. Refunds usually show on your statement within 5–10 days.";
  }
  // A dead job being replaced reads as "trying again", not as the dead job.
  if (payment?.fulfillmentState === "retrying") return FULFILLMENT_STATUS.retrying.detail;
  if (order && order.stage !== "draft") return STAGE_DETAIL[order.stage];
  return FULFILLMENT_STATUS[payment?.fulfillmentState ?? "pending"].detail;
}

/**
 * The single reading of a paid order's health, shared by every surface that
 * describes one.
 *
 * Both records have to be consulted, because they fail in different places. The
 * payment knows whether we ever reached the printer; the order knows what the
 * printer did with the job once we had. A job that was accepted and *then*
 * rejected leaves the payment looking perfectly healthy — its `fulfillmentState`
 * stays `"placed"` until the rejection webhook lands — so reading either one
 * alone gets this wrong. It did: the confirmation screen read only the payment
 * and congratulated customers on orders the printer had already refused.
 *
 * The one combination worth spelling out: an errored order whose payment says
 * `"retrying"` is `working`, not `stuck` — the sweep has been re-armed with a
 * replacement job, so there is genuinely nothing for anyone to do yet.
 */
export function orderHealth(
  payment: UserPaymentRecord | null,
  order: OrderRecord | null,
): OrderHealth {
  if (payment?.status === "refunded") return "cancelled";
  // A canceled job being replaced is still on its way.
  if (order?.stage === "cancelled") return payment?.fulfillmentState === "retrying" ? "working" : "cancelled";
  if (payment?.fulfillmentState === "failed") return "stuck";
  if (order?.stage === "error") {
    return payment?.fulfillmentState === "retrying" ? "working" : "stuck";
  }
  if (payment?.fulfillmentState === "retrying" || order?.stage === "onHold") return "working";
  return "ok";
}
