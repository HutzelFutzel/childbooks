/**
 * Digital-edition (ebook) purchase flow. Fully admin-configurable via
 * `PricingSettings.ebook` (enabled, per-currency price, print-bundle discount).
 *
 * Flow: fetch the server-authoritative quote (price + any print-owner discount
 * + ownership) → have the server render the book to a screen-quality PDF →
 * `/checkout/ebook` → redirect to Stripe. The download unlocks only after the
 * payment webhook confirms funds. Already-owned books show a download button
 * instead — plus, when the fingerprint suggests the design has moved on since
 * that copy was made, a free "update to your latest design" action that
 * re-renders and swaps in a fresh PDF at no charge.
 */
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, BookOpen, Check, Download, Loader2, ShieldCheck } from "lucide-react";
import { pageTrimForConfig } from "../../core/book";
import { renderFingerprint } from "../../core/print/fingerprint";
import { fetchRenderAvailability, renderBook } from "../../platform/renders";
import { COVER_FRONT_ID, type BookDesign, type Project } from "../../core/types";
import { useAppConfigStore } from "../../state/appConfigStore";
import {
  fetchEbookQuote,
  startEbookCheckout,
  type EbookQuote,
} from "../../platform/payments";
import { fetchDownloadLink } from "../../platform/downloads";
import { CouponField } from "./CouponField";
import { useCheckoutUiStore } from "../../state/checkoutUiStore";
import { flushProjectSaves } from "../../state/projectsStore";
import { Button } from "../components/Button";
import { BookMockup } from "../components/BookMockup";
import { Card, CardBody, CardHeader, CardTitle } from "../components/Card";
import type { DesignPage } from "../design/designInit";
import { notify } from "../lib/notify";

type Phase = "quote" | "ready" | "rendering" | "redirecting";

export function EbookCheckout({
  onBack,
  project,
  design,
  cover,
  initialQuote = null,
}: {
  onBack: () => void;
  project: Project;
  /** Only for the fingerprint now — the server renders from the saved book. */
  design: BookDesign;
  cover?: DesignPage;
  /**
   * A quote the caller already fetched (e.g. the order screen, so its "Get the
   * ebook" card can read "Download your ebook" before this dialog ever opens).
   * Seeds state so an owner doesn't see a "Checking the price…" flash for a
   * fact already known. A fresh quote is still fetched in the background —
   * price and ownership are server-authoritative and this is about to either
   * charge money or grant a download, so the seed is a head start, not the
   * final word.
   */
  initialQuote?: EbookQuote | null;
}) {
  const baseCurrency = useAppConfigStore((s) => s.pricingSettings.baseCurrency);
  const openConfirmation = useCheckoutUiStore((s) => s.openConfirmation);
  // The PDF is rendered at the book's own trim (minus the print bleed), so the
  // digital edition is the same book in the same shape — worth saying, since the
  // size was chosen for a printed object.
  const trim = pageTrimForConfig(project.config);
  const [phase, setPhase] = useState<Phase>(initialQuote ? "ready" : "quote");
  const [status, setStatus] = useState("");
  const [quote, setQuote] = useState<EbookQuote | null>(initialQuote);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  // Re-validated inside the checkout transaction; this is only what the
  // customer entered and the server accepted a moment ago.
  const [couponCode, setCouponCode] = useState<string | null>(null);
  const fingerprint = useMemo(() => renderFingerprint(project, design), [project, design]);
  // Whether the owned copy might be behind the current design. Unknown for
  // entitlements delivered before we tracked this (`ownedFingerprint` null) —
  // treated as "maybe stale" rather than hidden, since offering a free,
  // no-op refresh is harmless and the alternative is an ebook that can never
  // be told apart from a design that moved on since it was made.
  const mayBeStale = Boolean(quote?.owned) && quote?.ownedFingerprint !== fingerprint;

  // Owned ebooks are fetched through the gated, logged download endpoint (the
  // raw file URL is never exposed), so each download is authorized + recorded.
  async function downloadOwned() {
    const win = window.open("", "_blank");
    setDownloading(true);
    try {
      const url = await fetchDownloadLink(project.id);
      if (win) win.location.href = url;
      else window.location.href = url;
    } catch (err) {
      win?.close();
      notify.error(err);
    } finally {
      setDownloading(false);
    }
  }

  useEffect(() => {
    // A seeded quote already answers the question this phase exists to
    // answer ("owned, included, or priced at X?") — skip straight to "ready"
    // instead of flashing a spinner over an answer the caller already has.
    setQuote(initialQuote ?? null);
    setPhase(initialQuote ? "ready" : "quote");
    setError(null);
    let cancelled = false;
    void fetchEbookQuote(project.id, baseCurrency)
      .then((q) => {
        if (cancelled) return;
        setQuote(q);
        setPhase("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        // Only surface the error if there was nothing to fall back on — a
        // seeded quote means the background refresh merely failed to
        // *improve* on an answer that's still good enough to act on.
        if (!initialQuote) {
          setError(err instanceof Error ? err.message : "We couldn't price the ebook.");
        }
        setPhase("ready");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, baseCurrency, initialQuote]);

  /**
   * A book that hasn't changed since it was last rendered doesn't need to be
   * rendered again — the backend still has the exact PDF. Worth the round trip:
   * it's the difference between a minute of rasterizing and an instant buy, and
   * the second copy is byte-identical to the first.
   */
  async function buy() {
    setError(null);
    setPhase("rendering");
    setStatus("Preparing your book…");
    try {
      // The server renders the SAVED book, so the last edit has to be on disk
      // before it looks — otherwise it renders the version before this one.
      await flushProjectSaves();
      const availability = await fetchRenderAvailability(fingerprint);
      if (!availability.ebook) {
        await renderBook({
          fingerprint,
          projectId: project.id,
          documents: [{ kind: "ebook" }],
          onProgress: setStatus,
        });
      }
      await checkout();
    } catch (err) {
      setPhase("ready");
      setError(err instanceof Error ? err.message : "We couldn't prepare your book.");
    }
  }

  async function checkout() {
    try {
      const included = quote?.included ?? false;
      const owned = quote?.owned ?? false;
      const free = included || owned;
      setPhase("redirecting");
      setStatus(owned ? "Updating your ebook…" : free ? "Adding it to your library…" : "Opening secure payment…");
      const result = await startEbookCheckout({
        projectId: project.id,
        title: project.title,
        currency: quote?.currency ?? baseCurrency,
        fingerprint,
        couponCode: couponCode ?? undefined,
      });
      if ("granted" in result) {
        // Included with the plan, or a free refresh of an ebook already
        // owned — either way there's no Stripe redirect to bring the
        // confirmation up. Open it directly: the download is the whole
        // product, and it belongs on a screen with a button, not in a toast.
        setQuote((q) => (q ? { ...q, owned: true, ownedFingerprint: fingerprint } : q));
        setPhase("ready");
        onBack();
        openConfirmation({ kind: "ebook", projectId: project.id });
        return;
      }
      window.location.href = result.url;
    } catch (err) {
      setPhase("ready");
      setError(err instanceof Error ? err.message : "We couldn't start checkout.");
    }
  }

  const busy = phase === "rendering" || phase === "redirecting";

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:py-8">
      <header className="flex items-start gap-4">
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<ArrowLeft className="size-4" />}
          onClick={onBack}
          disabled={phase === "redirecting"}
          className="mt-0.5 shrink-0"
        >
          Back
        </Button>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">
            Your digital edition
          </h1>
          <p className="mt-1 text-sm leading-relaxed text-ink-500">
            Keep the finished book as a high-quality PDF you can read anywhere.
          </p>
        </div>
      </header>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <CardBody className="grid gap-7 p-5 sm:p-7 md:grid-cols-[13rem_minmax(0,1fr)] md:items-center">
            <div className="flex min-h-64 items-center justify-center rounded-2xl bg-ink-50 p-5">
              <BookMockup
                blobId={cover?.blobId}
                pageDesign={design.pages[COVER_FRONT_ID]}
                aspect={cover?.aspect ?? trim.widthIn / trim.heightIn}
                width={150}
                variant="flat"
              />
            </div>

            <div>
              <span className="flex size-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                <BookOpen className="size-5" />
              </span>
              <h2 className="mt-4 font-display text-2xl font-bold tracking-tight text-ink-900">
                {quote?.owned ? "Ready whenever you are" : "The same story, made portable"}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-600">
                Your complete {trim.widthIn} × {trim.heightIn} in book, prepared as a crisp PDF
                for tablets, phones and computers.
              </p>
              <ul className="mt-5 space-y-3 text-sm text-ink-700">
                {[
                  "Every illustrated page in reading order",
                  "One file to keep and read on any device",
                  "Available again anytime from Downloads",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5">
                    <Check className="mt-0.5 size-4 shrink-0 text-brand-600" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>

              {quote?.owned && mayBeStale && (
                <div className="mt-6 rounded-2xl border border-ink-200 bg-ink-50 px-4 py-3">
                  <p className="text-sm font-semibold text-ink-800">Your design has changed</p>
                  <p className="mt-1 text-xs leading-relaxed text-ink-500">
                    Refresh the PDF with your latest edits at no extra cost.
                  </p>
                  <Button
                    className="mt-3"
                    variant="secondary"
                    loading={busy}
                    onClick={() => void buy()}
                  >
                    Update digital edition
                  </Button>
                </div>
              )}
            </div>
          </CardBody>
        </Card>

        <aside className="lg:sticky lg:top-4">
          <Card>
            <CardHeader>
              <CardTitle>Digital edition</CardTitle>
            </CardHeader>
            <CardBody className="space-y-5">
              <div>
                <p className="truncate text-sm font-semibold text-ink-900">{project.title}</p>
                <p className="mt-1 text-xs text-ink-500">High-quality PDF · Downloadable</p>
              </div>

              <div className="border-y border-ink-100 py-4">
                {phase === "quote" ? (
                  <div className="flex items-center gap-2 text-sm text-ink-500">
                    <Loader2 className="size-4 animate-spin" /> Checking availability…
                  </div>
                ) : quote ? (
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm text-ink-600">
                      {quote.owned ? "Your copy" : "Total"}
                    </span>
                    <span className="text-right">
                      {!quote.owned && quote.price < quote.listPrice && (
                        <span className="mr-2 text-xs text-ink-400 line-through">
                          {money(quote.listPrice, quote.currency)}
                        </span>
                      )}
                      <span className="text-xl font-bold text-ink-900">
                        {quote.owned
                          ? "Purchased"
                          : quote.included
                            ? "Included"
                            : money(quote.price, quote.currency)}
                      </span>
                    </span>
                  </div>
                ) : (
                  <p className="text-sm text-rose-600">{error ?? "Price unavailable."}</p>
                )}
              </div>

              {quote?.included && quote.planName && (
                <p className="text-xs leading-relaxed text-emerald-700">
                  Included with your {quote.planName} plan.
                </p>
              )}
              {quote && !quote.included && quote.planName && (
                <p className="text-xs leading-relaxed text-emerald-700">
                  Your {quote.planName} member price is applied.
                </p>
              )}
              {quote && quote.discountPct > 0 && (
                <p className="text-xs leading-relaxed text-emerald-700">
                  Includes your {quote.discountPct}% printed-book owner discount.
                </p>
              )}

              {/* Nothing to discount when it's already owned or included in the
                  plan — a code box next to a €0 total is an invitation to waste
                  a single-use code. */}
              {quote && quote.enabled && !quote.owned && !quote.included && quote.price > 0 && (
                <CouponField
                  itemType="ebook"
                  subtotal={quote.price}
                  currency={quote.currency}
                  productId="ebook"
                  onChange={setCouponCode}
                />
              )}

              {busy && (
                <div className="flex items-center gap-2 rounded-xl bg-brand-50 px-3 py-2.5 text-xs text-brand-700">
                  <Loader2 className="size-4 animate-spin" /> {status}
                </div>
              )}
              {error && quote && <p className="text-xs leading-relaxed text-rose-600">{error}</p>}

              {quote?.owned ? (
                <Button
                  className="w-full"
                  size="lg"
                  leftIcon={<Download className="size-4" />}
                  loading={downloading}
                  onClick={() => void downloadOwned()}
                >
                  Download your ebook
                </Button>
              ) : quote?.enabled ? (
                <Button className="w-full" size="lg" loading={busy} onClick={() => void buy()}>
                  {busy
                    ? "Preparing your ebook…"
                    : quote.included
                      ? "Add to Downloads"
                      : `Continue to payment · ${money(quote.price, quote.currency)}`}
                </Button>
              ) : (
                <Button className="w-full" size="lg" disabled>
                  Currently unavailable
                </Button>
              )}

              <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-400">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
                {quote?.owned
                  ? "This ebook is already in your account."
                  : quote?.included
                    ? "No payment is needed."
                    : "Stripe securely handles payment. Your download unlocks right after purchase."}
              </p>
            </CardBody>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}
