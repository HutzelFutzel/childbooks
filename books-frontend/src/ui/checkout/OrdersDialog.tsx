"use client";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  FileText,
  Loader2,
  Package,
  Truck,
  XCircle,
} from "lucide-react";
import { Receipt } from "lucide-react";
import type { OrderRecord, OrderStage } from "../../core/fulfillment/types";
import type { PaymentStatus, UserPaymentRecord } from "../../platform/payments";
import { createFulfillment } from "../../platform/fulfillment";
import { useOrdersStore } from "../../state/ordersStore";
import { usePaymentsStore } from "../../state/paymentsStore";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";
import { Tabs } from "../components/Tabs";
import { cn } from "../lib/cn";

const STAGE: Record<OrderStage, { label: string; badge: string }> = {
  draft: { label: "Draft", badge: "bg-ink-100 text-ink-600" },
  onHold: { label: "Needs attention", badge: "bg-amber-100 text-amber-700" },
  inProgress: { label: "In production", badge: "bg-sky-100 text-sky-700" },
  complete: { label: "Complete", badge: "bg-emerald-100 text-emerald-700" },
  cancelled: { label: "Cancelled", badge: "bg-ink-100 text-ink-500" },
  error: { label: "Issue", badge: "bg-rose-100 text-rose-700" },
};

function money(amount: string, currency: string): string {
  const n = Number(amount);
  if (Number.isNaN(n)) return `${amount} ${currency}`;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

function formatDate(ms: number | null): string {
  if (!ms) return "Just now";
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleString();
  }
}

export function OrdersDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const orders = useOrdersStore((s) => s.orders);
  const loading = useOrdersStore((s) => s.loading);
  const payments = usePaymentsStore((s) => s.payments);
  const paymentsLoading = usePaymentsStore((s) => s.loading);
  const [view, setView] = useState<"orders" | "payments">("orders");

  // Friendly product labels from the local catalog (sku → label).
  const productLabel = useMemo(() => {
    const map = new Map<string, string>();
    try {
      for (const p of createFulfillment().listProducts()) map.set(p.sku, p.label);
    } catch {
      /* catalog optional */
    }
    return (sku: string) => map.get(sku) ?? "Printed book";
  }, []);

  return (
    <Modal open={open} onClose={onClose} title="Orders & payments" size="max-w-2xl">
      <div className="mb-4">
        <Tabs
          items={[
            { id: "orders", label: "Orders" },
            { id: "payments", label: "Payments & receipts" },
          ]}
          value={view}
          onChange={(id) => setView(id as "orders" | "payments")}
        />
      </div>

      {view === "orders" ? (
        loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-ink-500">
            <Loader2 className="size-5 animate-spin" /> Loading your orders…
          </div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-500">
              <Package className="size-6" />
            </span>
            <p className="text-sm font-medium text-ink-700">No orders yet</p>
            <p className="max-w-sm text-sm text-ink-500">
              When you order a printed book it'll show up here with live status, tracking and the
              print files we sent to the press.
            </p>
          </div>
        ) : (
          <div className="-mx-1 max-h-[68vh] space-y-3 overflow-y-auto px-1 py-1">
            {orders.map((order) => (
              <OrderCard key={order.id} order={order} productLabel={productLabel} />
            ))}
          </div>
        )
      ) : paymentsLoading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-ink-500">
          <Loader2 className="size-5 animate-spin" /> Loading your payments…
        </div>
      ) : payments.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-500">
            <Receipt className="size-6" />
          </span>
          <p className="text-sm font-medium text-ink-700">No payments yet</p>
          <p className="max-w-sm text-sm text-ink-500">
            Receipts for your orders and subscriptions will appear here once you've paid.
          </p>
        </div>
      ) : (
        <div className="-mx-1 max-h-[68vh] space-y-3 overflow-y-auto px-1 py-1">
          {payments.map((p) => (
            <PaymentCard key={p.id} payment={p} />
          ))}
        </div>
      )}
    </Modal>
  );
}

const PAYMENT_STATUS: Record<PaymentStatus, { label: string; badge: string }> = {
  pending: { label: "Pending", badge: "bg-amber-100 text-amber-700" },
  paid: { label: "Paid", badge: "bg-emerald-100 text-emerald-700" },
  failed: { label: "Failed", badge: "bg-rose-100 text-rose-700" },
  refunded: { label: "Refunded", badge: "bg-ink-100 text-ink-600" },
  partially_refunded: { label: "Partly refunded", badge: "bg-sky-100 text-sky-700" },
};

function PaymentCard({ payment }: { payment: UserPaymentRecord }) {
  const status = PAYMENT_STATUS[payment.status] ?? PAYMENT_STATUS.pending;
  return (
    <div className="rounded-2xl border border-ink-100 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink-800">
            {payment.description || (payment.kind === "subscription" ? "Subscription" : "Order")}
          </p>
          <p className="mt-0.5 text-xs text-ink-500">{formatDate(payment.createdAt)}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-sm font-semibold text-ink-900">
            {money(String(payment.amount), payment.currency)}
          </span>
          <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", status.badge)}>
            {status.label}
          </span>
        </div>
      </div>

      {payment.refundedAmount > 0 && (
        <p className="mt-2 text-xs text-ink-500">
          Refunded {money(String(payment.refundedAmount), payment.currency)}
        </p>
      )}

      {payment.receiptUrl && (
        <div className="mt-3">
          <FileLink href={payment.receiptUrl} label="View receipt" />
        </div>
      )}
    </div>
  );
}

function OrderCard({
  order,
  productLabel,
}: {
  order: OrderRecord;
  productLabel: (sku: string) => string;
}) {
  const [openDetails, setOpenDetails] = useState(false);
  const stage = STAGE[order.stage] ?? STAGE.draft;
  const needsAttention = order.stage === "onHold" || order.stage === "error";
  const total = order.charges.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
  const currency = order.charges[0]?.currency ?? "USD";
  const { address } = order.recipient;

  return (
    <div
      className={cn(
        "rounded-2xl border bg-white p-4",
        needsAttention ? "border-amber-200" : "border-ink-100",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink-800">
            {productLabel(order.productSku)}
          </p>
          <p className="mt-0.5 text-xs text-ink-500">
            {formatDate(order.createdAt)} · {order.copies} {order.copies === 1 ? "copy" : "copies"} ·{" "}
            <span className="font-mono">{order.id}</span>
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2.5 py-1 text-xs font-medium",
            stage.badge,
          )}
        >
          {stage.label}
        </span>
      </div>

      {/* Attention banner — the actionable bit (bad address, page count, etc.) */}
      {needsAttention && order.statusMessage && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>{order.statusMessage}</span>
        </div>
      )}

      {/* Ship-to + cost */}
      <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-ink-600">
        <div>
          <p className="font-medium text-ink-700">Ship to</p>
          <p className="mt-0.5 leading-relaxed">
            {order.recipient.name}
            <br />
            {[address.townOrCity, address.stateOrCounty, address.postalOrZipCode]
              .filter(Boolean)
              .join(", ")}
            <br />
            {address.countryCode} · {order.shippingMethod}
          </p>
        </div>
        {total > 0 && (
          <div className="text-right">
            <p className="font-medium text-ink-700">Charged</p>
            <p className="mt-0.5 text-sm font-semibold text-ink-900">
              {money(String(total), currency)}
            </p>
          </div>
        )}
      </div>

      {/* Tracking */}
      {order.shipments.some((s) => s.trackingUrl || s.trackingNumber) && (
        <div className="mt-3 space-y-1.5">
          {order.shipments.map((s, i) =>
            s.trackingUrl || s.trackingNumber ? (
              <a
                key={i}
                href={s.trackingUrl ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "flex items-center gap-2 rounded-lg border border-ink-100 px-3 py-2 text-xs",
                  s.trackingUrl
                    ? "text-brand-700 hover:bg-brand-50"
                    : "pointer-events-none text-ink-600",
                )}
              >
                <Truck className="size-3.5 shrink-0" />
                <span className="truncate">
                  {[s.carrier, s.service].filter(Boolean).join(" ") || "Shipment"}
                  {s.trackingNumber ? ` · ${s.trackingNumber}` : ""}
                </span>
              </a>
            ) : null,
          )}
        </div>
      )}

      {/* Print files */}
      {(order.fileUrls.interior || order.fileUrls.cover) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {order.fileUrls.interior && (
            <FileLink href={order.fileUrls.interior} label="Interior PDF" />
          )}
          {order.fileUrls.cover && <FileLink href={order.fileUrls.cover} label="Cover PDF" />}
        </div>
      )}

      {/* History toggle */}
      {order.statusHistory.length > 0 && (
        <div className="mt-3 border-t border-ink-100 pt-2">
          <button
            onClick={() => setOpenDetails((v) => !v)}
            className="flex w-full items-center justify-between text-xs font-medium text-ink-500 hover:text-ink-700"
          >
            <span>Status history ({order.statusHistory.length})</span>
            <ChevronDown
              className={cn("size-4 transition-transform", openDetails && "rotate-180")}
            />
          </button>
          {openDetails && (
            <ol className="mt-2 space-y-2">
              {[...order.statusHistory]
                .sort((a, b) => b.at - a.at)
                .map((entry, i) => {
                  const s = STAGE[entry.stage] ?? STAGE.draft;
                  return (
                    <li key={i} className="flex items-start gap-2 text-xs">
                      <StageDot stage={entry.stage} />
                      <div className="min-w-0">
                        <p className="font-medium text-ink-700">{s.label}</p>
                        {entry.message && <p className="text-ink-500">{entry.message}</p>}
                        <p className="text-ink-400">{formatDate(entry.at)}</p>
                      </div>
                    </li>
                  );
                })}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

function FileLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 rounded-lg bg-ink-50 px-2.5 py-1.5 text-xs font-medium text-ink-700 transition hover:bg-ink-100"
    >
      <FileText className="size-3.5" />
      {label}
    </a>
  );
}

function StageDot({ stage }: { stage: OrderStage }) {
  if (stage === "complete")
    return <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />;
  if (stage === "error" || stage === "cancelled")
    return <XCircle className="mt-0.5 size-3.5 shrink-0 text-rose-500" />;
  if (stage === "onHold")
    return <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" />;
  return <span className="mt-1 size-2 shrink-0 rounded-full bg-sky-400" />;
}

/** Toolbar trigger: opens the orders dialog. Shows a dot when any need attention. */
export function OrdersButton() {
  const [open, setOpen] = useState(false);
  const needsAttention = useOrdersStore((s) =>
    s.orders.some((o) => o.stage === "onHold" || o.stage === "error"),
  );

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        leftIcon={
          <span className="relative">
            <Package className="size-4" />
            {needsAttention && (
              <span className="absolute -right-1 -top-1 size-2 rounded-full bg-amber-500 ring-2 ring-white" />
            )}
          </span>
        }
        onClick={() => setOpen(true)}
      >
        Orders
      </Button>
      <OrdersDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
