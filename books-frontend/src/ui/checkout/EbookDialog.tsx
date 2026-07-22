/**
 * Digital-edition (ebook) purchase flow. Fully admin-configurable via
 * `PricingSettings.ebook` (enabled, per-currency price, print-bundle discount).
 *
 * Flow: fetch the server-authoritative quote (price + any print-owner discount
 * + ownership) → render the book to a screen-quality PDF → upload it as part
 * of `/checkout/ebook` → redirect to Stripe. The download unlocks only after
 * the payment webhook confirms funds. Already-owned books show a download
 * button instead.
 */
import { useEffect, useState } from "react";
import { BookOpen, Download, Loader2 } from "lucide-react";
import type { BookDesign, Project } from "../../core/types";
import { useAppConfigStore } from "../../state/appConfigStore";
import {
  fetchEbookQuote,
  startEbookCheckout,
  type EbookQuote,
} from "../../platform/payments";
import { fetchDownloadLink } from "../../platform/downloads";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";
import type { DesignPage } from "../design/designInit";
import { notify } from "../lib/notify";
import { EbookAssetRunner } from "./orderAssets";

type Phase = "quote" | "ready" | "rendering" | "redirecting";

export function EbookDialog({
  open,
  onClose,
  project,
  pages,
  design,
}: {
  open: boolean;
  onClose: () => void;
  project: Project;
  pages: DesignPage[];
  design: BookDesign;
}) {
  const baseCurrency = useAppConfigStore((s) => s.pricingSettings.baseCurrency);
  const [phase, setPhase] = useState<Phase>("quote");
  const [status, setStatus] = useState("");
  const [quote, setQuote] = useState<EbookQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

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

  function buy() {
    setError(null);
    setPhase("rendering");
    setStatus("Preparing your book…");
  }

  async function onRendered(pdf: Blob) {
    try {
      const included = quote?.included ?? false;
      setPhase("redirecting");
      setStatus(included ? "Adding it to your library…" : "Opening secure payment…");
      const result = await startEbookCheckout({
        projectId: project.id,
        title: project.title,
        currency: quote?.currency ?? baseCurrency,
        pdf,
      });
      if ("granted" in result) {
        // Included with the plan — no payment step; the download is live now.
        setQuote((q) => (q ? { ...q, owned: true } : q));
        setPhase("ready");
        notify.success("Your ebook is ready", "It's in your library — download it anytime.");
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
    // Closing during "rendering" is allowed — it unmounts the asset runner and
    // safely abandons the render (nothing has been uploaded or charged yet), so
    // a hung render can never trap the user. Only the brief "redirecting" step
    // (checkout request in flight) is locked.
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
                computer, forever.
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

          {busy && (
            <div className="flex items-center gap-2 rounded-xl bg-ink-50 px-4 py-3 text-xs text-ink-500">
              <Loader2 className="size-4 animate-spin text-brand-500" /> {status}
            </div>
          )}
          {error && <p className="text-xs text-rose-600">{error}</p>}

          <Button className="w-full" size="lg" loading={busy} onClick={buy}>
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

      {phase === "rendering" && (
        <EbookAssetRunner
          project={project}
          pages={pages}
          design={design}
          onProgress={setStatus}
          onDone={(pdf) => void onRendered(pdf)}
          onError={(err) => {
            setPhase("ready");
            notify.error(err);
          }}
        />
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
