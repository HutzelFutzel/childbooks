/**
 * The post-purchase confirmation — a real screen, not a toast.
 *
 * A toast was the wrong instrument for two reasons. It's gone on refresh, and
 * the customer comes back from Stripe *before* our webhook has necessarily run,
 * so "success" isn't yet a fact worth asserting: the payment could still be
 * settling, and for print orders the leg that reaches the press happens after
 * the redirect and can fail with the money already taken.
 *
 * So this opens in a following state and resolves from the live payment (and
 * order) record — the same pattern a Shopify order-status page uses: one stable
 * place that shows where the purchase stands for as long as it takes, reachable
 * again later from the orders list rather than being a moment you can miss.
 *
 * It's an overlay rather than a route because the studio is a full-screen editor
 * with a project open; navigating away to confirm a purchase would cost the
 * customer their place in the book they just bought. The URL still carries the
 * payment id, so a refresh lands right back here.
 */
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Copy,
  Download,
  Gift,
  Loader2,
  Package,
  Receipt,
  Sparkles,
  TriangleAlert,
  Truck,
  Users,
  X,
} from "lucide-react";
import type { OrderRecord } from "../../core/fulfillment/types";
import { bindingNoun } from "../../core/fulfillment";
import { fetchDownloadLink } from "../../platform/downloads";
import { listMyGifts, type UserPaymentRecord } from "../../platform/payments";
import { useCheckoutUiStore, type PurchaseKind } from "../../state/checkoutUiStore";
import { useOrdersStore } from "../../state/ordersStore";
import { usePaymentsStore } from "../../state/paymentsStore";
import { useSparksStore } from "../../state/sparksStore";
import { useDownloadsStore } from "../../state/downloadsStore";
import { useAccountUiStore } from "../../state/accountUiStore";
import { useAppConfigStore } from "../../state/appConfigStore";
import { createFulfillment } from "../../platform/fulfillment";
import { inviteTeaser, freezeTerms } from "../../core/config/referral";
import { PlanUpsell, type UpsellContext } from "../billing/PlanUpsell";
import { Button } from "../components/Button";
import { Celebrate } from "../components/Celebrate";
import { cn } from "../lib/cn";
import { notify } from "../lib/notify";
import { FULFILLMENT_STATUS, STAGE_STATUS, orderHealth } from "./orderStatus";
import { SurveyCard } from "./SurveyCard";

function money(amount: number | string, currency: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return `${amount} ${currency}`;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

function formatDate(ms: number | null): string {
  if (!ms) return "Just now";
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(ms),
    );
  } catch {
    return new Date(ms).toLocaleString();
  }
}

const UPSELL_CONTEXT: Partial<Record<PurchaseKind, UpsellContext>> = {
  order: "print",
  ebook: "ebook",
  sparks: "sparks",
};

export function PurchaseConfirmation() {
  const router = useRouter();
  const pathname = usePathname();
  const confirmation = useCheckoutUiStore((s) => s.confirmation);
  const close = useCheckoutUiStore((s) => s.closeConfirmation);

  // The payment id lives in the URL so a refresh returns here. Clear it on
  // dismiss — the screen is re-openable from the orders list, so nothing is
  // lost, and a stale param must not reopen it on the next visit.
  const dismiss = () => {
    close();
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      for (const key of ["checkout", "ebook", "sparks", "gift", "subscription", "payment", "project", "session_id"]) {
        params.delete(key);
      }
      const qs = params.toString();
      router.replace(pathname + (qs ? `?${qs}` : ""), { scroll: false });
    }
  };

  useEffect(() => {
    if (!confirmation) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmation]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {confirmation && (
        <motion.div
          className="fixed inset-0 z-50 overflow-y-auto bg-canvas"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <button
            onClick={dismiss}
            aria-label="Close"
            className="absolute right-4 top-4 z-10 rounded-xl p-2 text-ink-400 transition hover:bg-ink-100 hover:text-ink-700"
          >
            <X className="size-5" />
          </button>
          <motion.div
            className="mx-auto w-full max-w-2xl px-5 py-10 sm:py-14"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
          >
            <Body kind={confirmation.kind} paymentId={confirmation.paymentId} projectId={confirmation.projectId} />

            <ConfirmationUpsell kind={confirmation.kind} paymentId={confirmation.paymentId} />

            <ConfirmationSurvey
              kind={confirmation.kind}
              paymentId={confirmation.paymentId}
              projectId={confirmation.projectId}
            />

            <InviteAfterPurchase onInvite={dismiss} />

            <div className="mt-8 flex justify-center">
              <Button variant="ghost" onClick={dismiss} rightIcon={<ArrowRight className="size-4" />}>
                Back to your book
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** Pride-moment invite CTA — the highest-converting placement for the program. */
function InviteAfterPurchase({ onInvite }: { onInvite: () => void }) {
  const router = useRouter();
  const referral = useAppConfigStore((s) => s.referral);
  if (!referral.enabled) return null;
  const teaser = inviteTeaser(freezeTerms(referral));
  return (
    <button
      type="button"
      onClick={() => {
        onInvite();
        router.push("/account/invites");
      }}
      className="mt-6 flex w-full items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/80 px-4 py-3 text-left transition hover:bg-emerald-50"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
        <Users className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-emerald-900">Know another parent who&apos;d love this?</span>
        <span className="block text-xs text-emerald-800/80">{teaser}</span>
      </span>
      <ArrowRight className="size-4 shrink-0 text-emerald-700" />
    </button>
  );
}

/**
 * The post-purchase membership offer, withheld when the purchase is in trouble.
 * A confirmation screen is a good place to offer a plan; one that's currently
 * explaining why someone's book didn't make it onto the press is not.
 */
function ConfirmationUpsell({ kind, paymentId }: { kind: PurchaseKind; paymentId: string | null }) {
  const context = UPSELL_CONTEXT[kind];
  const { payment } = usePayment(paymentId);
  const orders = useOrdersStore((s) => s.orders);
  const order = payment?.orderId ? orders.find((o) => o.id === payment.orderId) ?? null : null;
  if (!context) return null;
  if (kind === "order" && orderHealth(payment, order) !== "ok") return null;
  return <PlanUpsell context={context} className="mt-8" />;
}

function Body({
  kind,
  paymentId,
  projectId,
}: {
  kind: PurchaseKind;
  paymentId: string | null;
  projectId: string | null;
}) {
  switch (kind) {
    case "order":
      return <OrderBody paymentId={paymentId} />;
    case "ebook":
      return <EbookBody projectId={projectId} />;
    case "sparks":
      return <SparksBody paymentId={paymentId} />;
    case "gift":
      return <GiftBody paymentId={paymentId} />;
    case "subscription":
      return <SubscriptionBody />;
  }
}

// ---- Shared chrome ---------------------------------------------------------

function Hero({
  icon,
  eyebrow,
  title,
  subtitle,
  celebrate,
  tone = "brand",
}: {
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  subtitle: string;
  celebrate?: boolean;
  tone?: "brand" | "neutral";
}) {
  return (
    <div className="relative flex flex-col items-center text-center">
      <Celebrate play={celebrate ?? false} />
      <span
        className={cn(
          "flex size-14 items-center justify-center rounded-2xl shadow-soft",
          tone === "brand"
            ? "bg-brand-600 text-(--color-brand-foreground)"
            : "bg-ink-100 text-ink-600",
        )}
      >
        {icon}
      </span>
      <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-brand-500">{eyebrow}</p>
      <h1 className="mt-1 font-display text-2xl font-bold text-ink-900 sm:text-3xl">{title}</h1>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-ink-500">{subtitle}</p>
    </div>
  );
}

function Panel({
  title,
  children,
  className,
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-2xl border border-ink-100 bg-white p-4 shadow-soft", className)}>
      {title && (
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">{title}</h2>
      )}
      {children}
    </section>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className={bold ? "font-semibold text-ink-800" : "text-ink-500"}>{label}</span>
      <span className={bold ? "font-semibold text-ink-900" : "text-ink-700"}>{value}</span>
    </div>
  );
}

/**
 * Waiting for the webhook. Shown until the payment record settles, because the
 * browser gets back from Stripe before we've necessarily heard from it.
 */
function Settling({ what }: { what: string }) {
  return (
    <div className="mt-8 flex flex-col items-center gap-3 rounded-2xl border border-ink-100 bg-white px-4 py-10 text-center shadow-soft">
      <Loader2 className="size-6 animate-spin text-brand-500" />
      <p className="text-sm font-medium text-ink-700">Confirming your payment…</p>
      <p className="max-w-sm text-xs leading-relaxed text-ink-500">
        {what} This takes a few seconds. You can leave this page — we&apos;ll email you either way.
      </p>
    </div>
  );
}

/** Find a payment by id, tolerating the moment before the store has caught up. */
/**
 * The profiling questions, withheld until the purchase is a fact.
 *
 * Same gate as the upsell, for a sharper version of the same reason: asking a
 * customer to help with market research while their money is still in the air —
 * or worse, while we're explaining that their book didn't reach the press — reads
 * as not having noticed. The questions cost nothing to defer; showing them at the
 * wrong moment costs the answer and some of the goodwill.
 */
function ConfirmationSurvey({
  kind,
  paymentId,
  projectId,
}: {
  kind: PurchaseKind;
  paymentId: string | null;
  projectId: string | null;
}) {
  const { payment } = usePayment(paymentId);
  const orders = useOrdersStore((s) => s.orders);
  const order = payment?.orderId ? orders.find((o) => o.id === payment.orderId) ?? null : null;

  // A subscription confirmation has no payment record to wait on; everything else
  // has to have cleared. `partially_refunded` still counts as a purchase that
  // happened — the customer bought something and their reasons are still worth
  // knowing.
  const settled =
    kind === "subscription" ||
    !paymentId ||
    payment?.status === "paid" ||
    payment?.status === "partially_refunded";
  const healthy = kind !== "order" || orderHealth(payment, order) === "ok";

  return (
    <SurveyCard kind={kind} paymentId={paymentId} projectId={projectId} ready={settled && healthy} />
  );
}

function usePayment(paymentId: string | null): { payment: UserPaymentRecord | null; loading: boolean } {
  const payments = usePaymentsStore((s) => s.payments);
  const loading = usePaymentsStore((s) => s.loading);
  const payment = useMemo(
    () => (paymentId ? payments.find((p) => p.id === paymentId) ?? null : null),
    [payments, paymentId],
  );
  return { payment, loading };
}

// ---- Print order -----------------------------------------------------------

function OrderBody({ paymentId }: { paymentId: string | null }) {
  const { payment } = usePayment(paymentId);
  const orders = useOrdersStore((s) => s.orders);
  const openOrders = useAccountUiStore((s) => s.openOrders);
  const order = useMemo<OrderRecord | null>(
    () => (payment?.orderId ? orders.find((o) => o.id === payment.orderId) ?? null : null),
    [orders, payment?.orderId],
  );

  const productLabel = useMemo(() => {
    const map = new Map<string, string>();
    try {
      for (const p of createFulfillment().listProducts()) map.set(p.sku, p.label);
    } catch {
      /* catalog optional */
    }
    return (sku: string) => map.get(sku) ?? "Printed book";
  }, []);

  const settled = payment?.status === "paid" || payment?.status === "partially_refunded";
  // ONE reading of how this order is doing, so the headline and the status panel
  // below can't contradict each other. They did: the headline asked only whether
  // Stripe took the money, so a job the printer had already rejected still got
  // "Your book is on its way" — with confetti — above the word "Issue".
  const health = orderHealth(payment, order);

  return (
    <>
      <Hero
        icon={<Package className="size-6" />}
        eyebrow={health === "ok" ? "Order confirmed" : "Order received"}
        title={
          !settled
            ? "Thank you for your order"
            : health === "ok"
              ? "Your book is on its way"
              : health === "working"
                ? "We're sorting something out"
                : "Your order needs our attention"
        }
        subtitle={
          !settled
            ? "We're confirming your payment with our provider."
            : health === "ok"
              ? "We've got your payment and your book is heading to the press. Everything below is also in your email."
              : health === "working"
                ? "Your payment went through, but the press didn't accept the book first time. We're on it — the details are below."
                : "Your payment went through, but we couldn't get this book onto the press. Our team has been alerted and will be in touch."
        }
        tone={health === "ok" ? "brand" : "neutral"}
        // Never celebrate an order that isn't actually going to arrive.
        celebrate={settled && health === "ok"}
      />

      {!payment || !settled ? (
        <Settling what="Your order is reserved and nothing will be lost." />
      ) : (
        <div className="mt-8 space-y-4">
          {/* Where it stands. The one thing someone opens this screen to learn. */}
          <FulfillmentPanel payment={payment} order={order} />

          <Panel title="Order summary">
            <p className="text-sm font-semibold text-ink-800">{payment.description || "Printed book"}</p>
            <p className="mt-0.5 text-xs text-ink-500">
              {formatDate(payment.createdAt)}
              {order && (
                <>
                  {" · "}
                  {order.copies} {order.copies === 1 ? "copy" : "copies"}
                  {" · "}
                  {productLabel(order.productSku)}
                </>
              )}
            </p>
            <div className="mt-3 space-y-1 border-t border-ink-100 pt-3">
              {payment.items.map((item, i) => (
                <Row
                  key={i}
                  label={item.quantity > 1 ? `${item.label} × ${item.quantity}` : item.label}
                  value={money(item.amount, payment.currency)}
                />
              ))}
              <div className="my-1 h-px bg-ink-100" />
              <Row label="Total paid" value={money(payment.amount, payment.currency)} bold />
            </div>
            {payment.receiptUrl && (
              <a
                href={payment.receiptUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:underline"
              >
                <Receipt className="size-3.5" /> View your receipt
              </a>
            )}
          </Panel>

          {order && <ShipToPanel order={order} />}

          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="secondary" size="sm" onClick={openOrders}>
              Track this order
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

function FulfillmentPanel({
  payment,
  order,
}: {
  payment: UserPaymentRecord;
  order: OrderRecord | null;
}) {
  // The order record is the better source once it exists (it carries the
  // printer's own stage); before then, the payment's fulfillment state is all
  // we have — and saying nothing there is what left people in the dark.
  const state = payment.fulfillmentState ?? "pending";
  const fulfillment = FULFILLMENT_STATUS[state];
  const stage = order ? STAGE_STATUS[order.stage] : null;
  const shipment = order?.shipments.find((s) => s.trackingUrl) ?? order?.shipments[0] ?? null;
  // Derived from the SAME reading as the headline. Keying the colour off the
  // payment alone painted a rejected order green, because placement had in fact
  // succeeded — the printer only refused the job afterwards.
  const health = orderHealth(payment, order);
  const tone =
    health === "stuck"
      ? "danger"
      : health === "working"
        ? "warning"
        : state === "pending"
          ? "info"
          : "success";

  const TONES = {
    info: "border-sky-200 bg-sky-50",
    success: "border-emerald-200 bg-emerald-50",
    warning: "border-amber-200 bg-amber-50",
    danger: "border-rose-200 bg-rose-50",
  } as const;

  return (
    <section className={cn("rounded-2xl border p-4", TONES[tone])}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0">
          {tone === "danger" ? (
            <TriangleAlert className="size-5 text-rose-600" />
          ) : tone === "warning" ? (
            <Truck className="size-5 text-amber-600" />
          ) : tone === "info" ? (
            <Loader2 className="size-5 animate-spin text-sky-600" />
          ) : (
            <CheckCircle2 className="size-5 text-emerald-600" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          {/* When things are fine the printer's own stage is the informative one
              ("In production", "Shipped"). When they aren't, its vocabulary is
              too terse to be useful — "Issue" tells a customer nothing — so the
              fulfillment wording, which says what we're doing, leads instead. */}
          <p className="text-sm font-semibold text-ink-800">
            {health === "ok" ? (stage?.label ?? fulfillment.label) : fulfillment.label}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-600">
            {payment.fulfillmentIssue ?? order?.statusMessage ?? fulfillment.detail}
          </p>
          {order && (
            <p className="mt-1.5 text-[11px] text-ink-400">
              Order <span className="font-mono">{order.id}</span>
            </p>
          )}
        </div>
      </div>

      {shipment?.trackingUrl && (
        <a
          href={shipment.trackingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 flex items-center gap-2 rounded-xl border border-ink-200 bg-white px-3 py-2 text-xs font-medium text-brand-700 transition hover:bg-brand-50"
        >
          <Truck className="size-3.5 shrink-0" />
          Track your parcel
          {shipment.carrier ? ` · ${shipment.carrier}` : ""}
        </a>
      )}
    </section>
  );
}

function ShipToPanel({ order }: { order: OrderRecord }) {
  const { address } = order.recipient;
  const correction = order.addressValidation?.suggested ?? null;
  return (
    <Panel title="Shipping to">
      <p className="text-sm leading-relaxed text-ink-700">
        {order.recipient.name}
        <br />
        {[address.line1, address.line2].filter(Boolean).join(", ")}
        <br />
        {[address.townOrCity, address.stateOrCounty, address.postalOrZipCode]
          .filter(Boolean)
          .join(", ")}
        <br />
        {address.countryCode}
      </p>
      <p className="mt-2 text-xs text-ink-500">
        {order.shippingMethod === "Budget"
          ? "Budget delivery"
          : order.shippingMethod === "StandardPlus"
            ? "Standard Plus delivery"
            : `${order.shippingMethod} delivery`}{" "}
        · {bindingNoun(bindingOf(order.productSku))}
      </p>
      {correction && (
        <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
          The carrier adjusted this to{" "}
          <span className="font-medium">
            {[
              correction.line1,
              correction.line2,
              correction.townOrCity,
              correction.stateOrCounty,
              correction.postalOrZipCode,
            ]
              .filter(Boolean)
              .join(", ")}
          </span>
          . If that&apos;s wrong, contact us now — the order can still be stopped.
        </p>
      )}
    </Panel>
  );
}

/** The binding of a print SKU, from the local catalog (falls back gracefully). */
function bindingOf(sku: string) {
  try {
    const product = createFulfillment()
      .listProducts()
      .find((p) => p.sku === sku);
    return product?.binding ?? "perfect-bound";
  } catch {
    return "perfect-bound";
  }
}

// ---- Ebook -----------------------------------------------------------------

function EbookBody({ projectId }: { projectId: string | null }) {
  const [downloading, setDownloading] = useState(false);
  // The entitlement is written by the same webhook that confirms the payment, so
  // on arrival from Stripe it may not exist yet. Waiting for it turns what would
  // be a rejected download into an honest "nearly there".
  const downloads = useDownloadsStore((s) => s.downloads);
  const entitled = !projectId || downloads.some((d) => d.id === projectId);

  async function download() {
    if (!projectId) return;
    // Opened up front so the click that started this still counts as a user
    // gesture by the time the (async) signed link comes back.
    const win = window.open("", "_blank");
    setDownloading(true);
    try {
      const url = await fetchDownloadLink(projectId);
      if (win) win.location.href = url;
      else window.location.href = url;
    } catch (err) {
      win?.close();
      notify.error(err);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <>
      <Hero
        icon={<BookOpen className="size-6" />}
        eyebrow="Purchase complete"
        title="Your ebook is ready"
        subtitle="The digital edition is yours to keep. Download it as many times as you like, on any device."
        celebrate
      />
      {entitled ? (
        <Panel className="mt-8">
          <div className="flex flex-col items-center gap-3 py-2 text-center">
            <Button
              size="lg"
              leftIcon={<Download className="size-4" />}
              loading={downloading}
              disabled={!projectId}
              onClick={() => void download()}
            >
              Download your ebook
            </Button>
            <p className="text-xs text-ink-400">
              It&apos;s saved to your account — find it any time under Downloads.
            </p>
          </div>
        </Panel>
      ) : (
        <Settling what="Your ebook unlocks as soon as the payment clears." />
      )}
    </>
  );
}

// ---- Sparks ----------------------------------------------------------------

function SparksBody({ paymentId }: { paymentId: string | null }) {
  const { payment } = usePayment(paymentId);
  const balance = useSparksStore((s) => s.balance);
  const settled = !paymentId || payment?.status === "paid";

  return (
    <>
      <Hero
        icon={<Sparkles className="size-6" />}
        eyebrow="Top-up complete"
        title="Your Sparks are in"
        subtitle="Sparks never expire — spend them on stories, illustrations and revisions whenever you like."
        celebrate={settled}
      />
      {!settled ? (
        <Settling what="Your Sparks land the moment it clears." />
      ) : (
        <Panel className="mt-8">
          <div className="flex items-center justify-between">
            <span className="text-sm text-ink-500">Your balance</span>
            <span className="flex items-center gap-1.5 text-xl font-bold text-ink-900">
              <Sparkles className="size-4 text-brand-500" />
              {balance.toLocaleString()}
            </span>
          </div>
        </Panel>
      )}
    </>
  );
}

// ---- Spark gift ------------------------------------------------------------

function GiftBody({ paymentId }: { paymentId: string | null }) {
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  // The claim code is the whole product here, so it's fetched and shown large
  // rather than left for the customer to hunt for in their wallet.
  useEffect(() => {
    let cancelled = false;
    void listMyGifts()
      .then((gifts) => {
        if (cancelled) return;
        const newest = [...gifts].sort((a, b) => b.createdAt - a.createdAt)[0];
        setCode(newest?.code ?? null);
      })
      .catch(() => setCode(null))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [paymentId]);

  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      notify.error("Couldn't copy the code — select and copy it manually.");
    }
  };

  return (
    <>
      <Hero
        icon={<Gift className="size-6" />}
        eyebrow="Gift purchased"
        title="Your gift is ready to give"
        subtitle="Share the code below with whoever you're spoiling. They redeem it in their own account."
        celebrate
      />
      <Panel className="mt-8" title="Claim code">
        {loading ? (
          <div className="flex items-center gap-2 py-3 text-sm text-ink-500">
            <Loader2 className="size-4 animate-spin" /> Fetching your code…
          </div>
        ) : code ? (
          <div className="flex flex-wrap items-center gap-3">
            <code className="flex-1 rounded-xl bg-ink-50 px-3 py-2.5 text-center font-mono text-lg font-semibold tracking-widest text-ink-900">
              {code}
            </code>
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<Copy className="size-3.5" />}
              onClick={() => void copy()}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        ) : (
          <p className="py-2 text-sm text-ink-500">
            Your code is being generated — you&apos;ll find it in your Sparks wallet under “Gifts
            you bought”, and in your email receipt.
          </p>
        )}
      </Panel>
    </>
  );
}

// ---- Subscription ----------------------------------------------------------

function SubscriptionBody() {
  return (
    <>
      <Hero
        icon={<Sparkles className="size-6" />}
        eyebrow="Welcome aboard"
        title="Your plan is active"
        subtitle="Your member benefits are live right now — monthly Sparks, member pricing and every premium extra your plan includes."
        celebrate
      />
      <Panel className="mt-8">
        <p className="text-sm leading-relaxed text-ink-600">
          You can review or change your plan any time from the account menu. Your first Spark grant
          has already been added to your balance.
        </p>
      </Panel>
    </>
  );
}
