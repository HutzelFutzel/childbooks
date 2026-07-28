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
import { BookOpen, Download, Loader2 } from "lucide-react";
import { pageTrimForConfig } from "../../core/book";
import { renderFingerprint } from "../../core/print/fingerprint";
import { fetchRenderAvailability, renderBook } from "../../platform/renders";
import type { BookDesign, Project } from "../../core/types";
import { useAppConfigStore } from "../../state/appConfigStore";
import {
  fetchEbookQuote,
  startEbookCheckout,
  type EbookQuote,
} from "../../platform/payments";
import { fetchDownloadLink } from "../../platform/downloads";
import { useCheckoutUiStore } from "../../state/checkoutUiStore";
import { flushProjectSaves } from "../../state/projectsStore";
import { PlanUpsell } from "../billing/PlanUpsell";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";
import { notify } from "../lib/notify";

type Phase = "quote" | "ready" | "rendering" | "redirecting";

export function EbookDialog({
  open,
  onClose,
  project,
  design,
}: {
  open: boolean;
  onClose: () => void;
  project: Project;
  /** Only for the fingerprint now — the server renders from the saved book. */
  design: BookDesign;
}) {
  const baseCurrency = useAppConfigStore((s) => s.pricingSettings.baseCurrency);
  const openConfirmation = useCheckoutUiStore((s) => s.openConfirmation);
  // The PDF is rendered at the book's own trim (minus the print bleed), so the
  // digital edition is the same book in the same shape — worth saying, since the
  // size was chosen for a printed object.
  const trim = pageTrimForConfig(project.config);
  const [phase, setPhase] = useState<Phase>("quote");
  const [status, setStatus] = useState("");
  const [quote, setQuote] = useState<EbookQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
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
    if (!open) return;
    setPhase("quote");
    setQuote(null);
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
        setError(err instanceof Error ? err.message : "We couldn't price the ebook.");
        setPhase("ready");
      });
    return () => {
      cancelled = true;
    };
  }, [open, project.id, baseCurrency]);

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
      });
      if ("granted" in result) {
        // Included with the plan, or a free refresh of an ebook already
        // owned — either way there's no Stripe redirect to bring the
        // confirmation up. Open it directly: the download is the whole
        // product, and it belongs on a screen with a button, not in a toast.
        setQuote((q) => (q ? { ...q, owned: true, ownedFingerprint: fingerprint } : q));
        setPhase("ready");
        onClose();
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
    // Closing during "rendering" is allowed — the render is the server's job
    // now and finishes (or fails) on its own, cached either way, so walking
    // away costs nothing and a slow render can never trap the user. Only the
    // brief "redirecting" step (checkout request in flight) is locked.
    <Modal
      open={open}
      onClose={phase === "redirecting" ? () => {} : onClose}
      title="Your book as an ebook"
      size="max-w-md"
    >
      {phase === "quote" && (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-ink-500">
          <Loader2 className="size-4 animate-spin" /> Checking the price…
        </div>
      )}

      {phase !== "quote" && quote?.owned && (
        <div className="space-y-4 py-2 text-center">
          <p className="text-sm text-ink-600">
            You already own the digital edition of <span className="font-semibold">{project.title}</span>.
          </p>
          <Button
            leftIcon={<Download className="size-4" />}
            loading={downloading}
            onClick={() => void downloadOwned()}
          >
            Download your ebook
          </Button>
          <p className="text-xs text-ink-400">Find it anytime under Downloads in your account menu.</p>

          {/* Owning the ebook used to mean being stuck with whatever PDF was
              made at purchase time, forever — no amount of editing the design
              afterward ever produced a new one. This re-renders and swaps in
              the current design at no extra cost: it's the same ebook, just
              caught up. */}
          {mayBeStale && (
            <div className="border-t border-ink-100 pt-4">
              <p className="text-xs text-ink-500">
                Changed the design since buying this? Get a fresh PDF with your latest edits — free,
                since you already own it.
              </p>
              {busy && (
                <div className="mt-3 flex items-center justify-center gap-2 rounded-xl bg-ink-50 px-4 py-3 text-xs text-ink-500">
                  <Loader2 className="size-4 animate-spin text-brand-500" /> {status}
                </div>
              )}
              {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
              <Button
                className="mt-3 w-full"
                variant="secondary"
                loading={busy}
                onClick={() => void buy()}
              >
                {busy ? "One moment…" : "Update to your latest design"}
              </Button>
            </div>
          )}
        </div>
      )}

      {phase !== "quote" && quote && !quote.owned && !quote.enabled && (
        <p className="py-6 text-center text-sm text-ink-500">
          Ebooks aren't available right now. Please check back later.
        </p>
      )}

      {phase !== "quote" && quote && !quote.owned && quote.enabled && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-2xl bg-brand-50/60 p-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-(--color-brand-foreground)">
              <BookOpen className="size-5" />
            </span>
            <div>
              <p className="text-sm font-semibold text-ink-800">{project.title} — digital edition</p>
              <p className="mt-0.5 text-xs text-ink-500">
                A beautiful, high-quality PDF of your finished book — read it on any tablet, phone or
                computer, forever. Pages are the {trim.widthIn} × {trim.heightIn} in shape you
                designed, so it reads exactly like the printed copy.
              </p>
            </div>
          </div>

          <div className="flex items-baseline justify-between rounded-xl border border-ink-100 px-4 py-3">
            <span className="text-sm text-ink-600">Price</span>
            <span className="text-right">
              {quote.price < quote.listPrice && (
                <span className="mr-2 text-xs text-ink-400 line-through">
                  {money(quote.listPrice, quote.currency)}
                </span>
              )}
              <span className="text-lg font-bold text-ink-900">
                {quote.included ? "Included" : money(quote.price, quote.currency)}
              </span>
            </span>
          </div>
          {quote.included && quote.planName && (
            <p className="text-xs text-emerald-700">
              Digital editions are included with your {quote.planName} plan.
            </p>
          )}
          {!quote.included && quote.planName && (
            <p className="text-xs text-emerald-700">Your {quote.planName} member price.</p>
          )}
          {quote.discountPct > 0 && (
            <p className="text-xs text-emerald-700">
              Includes your {quote.discountPct}% discount for owning the printed book.
            </p>
          )}
          {/* One quiet line, never a step: a non-member can see what a plan would
              cost them here without being pulled out of the purchase they came
              for. Renders nothing for members, or if no plan is cheaper. */}
          <PlanUpsell context="ebook" variant="inline" />

          {busy && (
            <div className="flex items-center gap-2 rounded-xl bg-ink-50 px-4 py-3 text-xs text-ink-500">
              <Loader2 className="size-4 animate-spin text-brand-500" /> {status}
            </div>
          )}
          {error && <p className="text-xs text-rose-600">{error}</p>}

          <Button className="w-full" size="lg" loading={busy} onClick={() => void buy()}>
            {busy
              ? "One moment…"
              : quote.included
                ? "Get your ebook — included in your plan"
                : `Buy the ebook · ${money(quote.price, quote.currency)}`}
          </Button>
          <p className="text-center text-[11px] text-ink-400">
            {quote.included
              ? "No payment needed — this is part of your plan."
              : "Secure payment by Stripe. Your download unlocks right after payment."}
          </p>
        </div>
      )}

      {phase !== "quote" && !quote && error && (
        <p className="py-6 text-center text-sm text-rose-600">{error}</p>
      )}

    </Modal>
  );
}

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}
