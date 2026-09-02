import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Download,
  Eye,
  Loader2,
  ShoppingBag,
  Tablet,
  TriangleAlert,
} from "lucide-react";
import { bookProductForConfig } from "../../core/book";
import { ebookPlanPrice, findPublicProductForSku, formatSlug } from "../../core/config/products";
import { findPublicPlanByPriceId } from "../../core/config/plans";
import { renderFingerprint } from "../../core/print/fingerprint";
import { fetchEbookQuote, type EbookQuote } from "../../platform/payments";
import { activeSubscription } from "../../platform/subscriptions";
import { currentIllustration } from "../../state/ai";
import { useAppConfigStore } from "../../state/appConfigStore";
import { useAuthStore } from "../../state/authStore";
import { useSubscriptionStore } from "../../state/subscriptionStore";
import { notify } from "../lib/notify";
import { illustrationUnits } from "../../state/bookUnits";
import { Button } from "../components/Button";
import { BookMockup } from "../components/BookMockup";
import { Celebrate } from "../components/Celebrate";
import { StageHeader } from "../components/StageHeader";
import { fmtMoney } from "../admin/tabs/products/parts";
import { OrderDialog } from "../checkout/OrderDialog";
import { EbookDialog } from "../checkout/EbookDialog";
import { useFormatsForConfigSize } from "../hooks/useOfferableFormats";
import { useStudio } from "./StudioContext";
import { buildDisplaySpreads, type Entry } from "./SpreadEditor";
import { getCursor } from "../../core/versioning";
import { physicalPageCount } from "../../core/print/pagePlan";
import { COVER_BACK_ID, COVER_FRONT_ID } from "../../core/types";
import { BookPreview } from "./BookPreview";

/**
 * The finish line: flip through the book, order a professionally
 * printed & bound copy, or buy the digital edition (ebook PDF).
 */
export function OrderStage() {
  const { project, pages, design, setStep } = useStudio();
  const [ordering, setOrdering] = useState(false);
  const [buyingEbook, setBuyingEbook] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  // Digital edition: only offered when the admin has enabled ebook sales.
  const ebookEnabled = useAppConfigStore((s) => s.pricingSettings.ebook.enabled);
  const accessLevel = useAuthStore((s) => s.accessLevel);
  const openAuthDialog = useAuthStore((s) => s.openAuthDialog);

  // Show the price before asking for anything: the storefront "from" price for
  // this book's format (admin catalog), plus the flat ebook price. Shipping is
  // quoted live in checkout once we know the destination.
  const publicProducts = useAppConfigStore((s) => s.products.products);
  const baseCurrency = useAppConfigStore((s) => s.pricingSettings.baseCurrency);
  const ebookSettings = useAppConfigStore((s) => s.pricingSettings.ebook);
  const publicPlans = useAppConfigStore((s) => s.plans.plans);
  const subscriptions = useSubscriptionStore((s) => s.subscriptions);

  // Server-authoritative ebook ownership + price, fetched up front so the "Get
  // the ebook" card can already read as "Download your ebook" for an owner —
  // instead of only revealing that once they've clicked a button that looked
  // like a purchase. `/checkout/*` requires a verified account, so this is
  // skipped (and simply falls back to the catalog price below) for guests and
  // unverified users, who can't own anything yet anyway.
  const [ebookQuote, setEbookQuote] = useState<EbookQuote | null>(null);
  const [ebookQuoteLoading, setEbookQuoteLoading] = useState(false);
  useEffect(() => {
    if (!ebookEnabled || accessLevel !== "full") {
      setEbookQuote(null);
      setEbookQuoteLoading(false);
      return;
    }
    let cancelled = false;
    setEbookQuoteLoading(true);
    void fetchEbookQuote(project.id, baseCurrency)
      .then((q) => {
        if (!cancelled) setEbookQuote(q);
      })
      .catch(() => {
        // Best-effort — the card falls back to the plain catalog price, which
        // is still correct for anyone who doesn't already own the ebook.
        if (!cancelled) setEbookQuote(null);
      })
      .finally(() => {
        if (!cancelled) setEbookQuoteLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ebookEnabled, accessLevel, project.id, baseCurrency]);
  const ebookOwned = ebookQuote?.owned ?? false;

  // Purchases require a verified account (the backend enforces this too). The
  // studio itself is open to guests, so the gate lives on the buy buttons:
  // guests get the sign-up dialog, unverified users a verify reminder.
  const requireFullAccount = (proceed: () => void) => {
    if (accessLevel === "guest") {
      notify.info("Create a free account to order", "Your book comes with you — nothing is lost.");
      openAuthDialog();
      return;
    }
    if (accessLevel === "unverified") {
      notify.info("Verify your email to order", "Click the link we sent you, then try again.");
      return;
    }
    proceed();
  };

  const units = illustrationUnits(project);
  const missingArt = useMemo(
    () => units.filter((u) => !currentIllustration(project, u.id)).length,
    [project, units],
  );
  // Physical leaves, not editor pages: a spread prints as two, and pagination
  // fillers print as one each. This is the number that gets priced and bound,
  // so it's the number to show and to gate on.
  const contentPages = useMemo(
    () => physicalPageCount(project.screenplay ? getCursor(project.screenplay).content : null),
    [project.screenplay],
  );
  const pageCount = contentPages;
  const bookProduct = bookProductForConfig(project.config);
  // The size only. The format's own label names a binding too, and that isn't
  // settled until checkout — announcing one here would be guessing.
  const sizeLabel = `${bookProduct.trim.widthIn} × ${bookProduct.trim.heightIn} in`;

  const catalogProduct = useMemo(
    () => findPublicProductForSku(publicProducts, bookProduct.sku),
    [publicProducts, bookProduct.sku],
  );

  // Whether this book can be printed AT ALL, across every binding sold at its
  // size — not whether the one binding it happens to be pointing at fits.
  //
  // The binding is chosen in checkout, so a 60-page book isn't "too long" just
  // because saddle stitch stops at 48; it's too long only if nothing sold at this
  // size will take it. Blocking on one binding here used to send people back to
  // the design flow to change format, which meant re-opening the size question.
  const { formats, offerable } = useFormatsForConfigSize(project.config);
  const printable = useMemo(
    () =>
      formats.filter((f) => {
        const entry = offerable.get(f.sku);
        const min = entry?.conditions.pages.min ?? f.minPages;
        const max = entry?.conditions.pages.max ?? f.maxPages;
        return contentPages >= min && contentPages <= max;
      }),
    [formats, offerable, contentPages],
  );

  // Only the lengths NO binding accepts are a real dead end. Bounds come from the
  // widest window on offer, so the advice names a number that actually helps.
  //
  // With no sellable formats (an empty or still-loading catalog) this falls back
  // to the config's own format, which keeps the guard honest instead of letting
  // an unprintable book through to a checkout that would refuse it.
  const widest = useMemo(() => {
    const candidates = formats.length > 0 ? formats : [bookProduct];
    return candidates.reduce<{ min: number; max: number }>(
      (acc, f) => {
        const entry = offerable.get(f.sku) ?? (f === bookProduct ? catalogProduct : undefined);
        const min = entry?.conditions.pages.min ?? f.minPages;
        const max = entry?.conditions.pages.max ?? f.maxPages;
        return { min: Math.min(acc.min, min), max: Math.max(acc.max, max) };
      },
      { min: Number.POSITIVE_INFINITY, max: 0 },
    );
  }, [formats, offerable, bookProduct, catalogProduct]);

  const printBlocked = contentPages < widest.min || contentPages > widest.max;
  const printBlockedReason = !printBlocked
    ? null
    : contentPages < widest.min
      ? `The shortest book we can bind at this size is ${widest.min} pages — yours has ${contentPages}. Add ${widest.min - contentPages} more before ordering a print copy.`
      : `The longest book we can bind at this size is ${widest.max} pages — yours has ${contentPages}. Remove some pages, or split it into two books.`;

  // Entry price across the bindings that can actually take this book, since
  // that's the cheapest copy the customer could really leave with.
  const printFromPrice = useMemo(() => {
    const prices = printable
      .map((f) => offerable.get(f.sku)?.prices[baseCurrency])
      .filter((v): v is number => typeof v === "number" && v > 0);
    if (prices.length > 0) return Math.min(...prices);
    const price = catalogProduct?.prices[baseCurrency];
    return typeof price === "number" && price > 0 ? price : null;
  }, [printable, offerable, catalogProduct, baseCurrency]);

  // The signed-in buyer's own paid plan, if they have one. Resolved once and
  // shared by the ebook price display and the price-calculator deep link below,
  // so both agree on who "you" are rather than each re-deriving it and risking
  // the two disagreeing after an edit to one.
  const currentPlan = useMemo(() => {
    const sub = activeSubscription(subscriptions);
    const plan = sub ? findPublicPlanByPriceId(publicPlans, sub.priceId) : null;
    return plan && !plan.isFree ? plan : null;
  }, [subscriptions, publicPlans]);

  // Plan-aware ebook price (mirrors the server quote): the subscriber's plan
  // price replaces the sticker price when one is configured; 0 ⇒ included with
  // the plan. Wording is derived from the data so it stays correct no matter
  // how plans/prices are configured in the admin.
  const ebookDisplay = useMemo(() => {
    const listPrice = ebookSettings.prices[baseCurrency] ?? 0;
    if (listPrice <= 0) return null;
    const planPrice = currentPlan ? ebookPlanPrice(ebookSettings, currentPlan.id, baseCurrency) : null;
    const planApplied = planPrice != null && planPrice < listPrice;
    const price = planApplied ? planPrice : listPrice;
    return {
      price,
      planName: planApplied && currentPlan ? currentPlan.name : null,
      included: planApplied && price <= 0,
    };
  }, [ebookSettings, baseCurrency, currentPlan]);

  // Whether the owned ebook might be behind the current design (same check
  // `EbookDialog` makes) — shown as a note on the card so an owner already
  // knows a free refresh is waiting, instead of finding out only after
  // opening the dialog.
  const fingerprint = useMemo(() => renderFingerprint(project, design), [project, design]);
  const ebookStale = ebookOwned && ebookQuote?.ownedFingerprint !== fingerprint;

  // The format to send someone to on the public price calculator: the one this
  // project is actually configured for, when the admin still sells it, else
  // whichever printable binding is — always an OFFERABLE entry (never the raw
  // catalog lookup), so the link can't land on a page that 404s because the
  // format it names has been withdrawn since. `offerable` already only holds
  // offerable, active entries (see `useOfferableFormats`).
  const priceLinkProduct = useMemo(
    () =>
      offerable.get(bookProduct.sku) ??
      printable.map((f) => offerable.get(f.sku)).find((p) => p != null) ??
      null,
    [offerable, bookProduct.sku, printable],
  );

  // Carries the buyer's own plan along only when it actually discounts THIS
  // format — a plan id the calculator can't apply would just fail to highlight
  // any "Price as" row, which is silent enough to be worth avoiding rather than
  // silent enough to ignore.
  const priceLinkHref = useMemo(() => {
    if (!priceLinkProduct) return null;
    const path = `/print-pricing/${formatSlug(priceLinkProduct.spec)}`;
    if (!currentPlan) return path;
    const discounted = (priceLinkProduct.planPrintDiscountPct[currentPlan.id] ?? 0) > 0;
    return discounted ? `${path}?plan=${encodeURIComponent(currentPlan.id)}` : path;
  }, [priceLinkProduct, currentPlan]);

  const cover = pages.find((p) => p.id === COVER_FRONT_ID) ?? pages[0];

  // The finish-line moment: arriving here with a fully illustrated book earns
  // a small sparkle burst over the cover. Once per visit to the stage.
  const [celebrate, setCelebrate] = useState(false);
  useEffect(() => {
    if (pageCount > 0 && missingArt === 0) setCelebrate(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const displays = useMemo(() => {
    const doc = project.screenplay ? getCursor(project.screenplay).content : null;
    if (!doc) return [];
    const spreadById = new Map(doc.spreads.map((s) => [s.id, s]));
    const entries: Entry[] = [];
    for (const page of pages) {
      if (page.id === COVER_FRONT_ID && doc.frontCover) {
        entries.push({ page, subject: { kind: "cover", coverId: COVER_FRONT_ID, cover: doc.frontCover } });
      } else if (page.id === COVER_BACK_ID && doc.backCover) {
        entries.push({ page, subject: { kind: "cover", coverId: COVER_BACK_ID, cover: doc.backCover } });
      } else {
        const spread = spreadById.get(page.id);
        if (spread) entries.push({ page, subject: { kind: "spread", spread } });
      }
    }
    return buildDisplaySpreads(doc, entries);
  }, [project.screenplay, pages]);

  // Name the one extra step up front, so the account ask at the buy button
  // never feels like a surprise wall.
  const purchaseNote =
    accessLevel === "guest"
      ? "Takes a free account (about 30 seconds) — your book comes with you."
      : accessLevel === "unverified"
        ? "Verify your email first — check your inbox for our link."
        : undefined;

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8">
      <StageHeader
        title="Preview & order"
        subtitle="Review your book, then choose a printed copy or digital edition."
      />

      <div className="relative flex flex-col items-center gap-6 rounded-2xl border border-ink-200 bg-white p-6 sm:flex-row sm:items-center">
        <Celebrate play={celebrate} />
        <BookMockup
          blobId={cover?.blobId}
          pageDesign={project.design?.pages[COVER_FRONT_ID]}
          aspect={cover?.aspect ?? 1}
          className="shrink-0 py-2"
        />
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-3 text-center sm:text-left">
          <div>
            <h2 className="truncate text-lg font-bold text-ink-900">{project.title}</h2>
            <p className="text-sm text-ink-500">
              {pageCount} page{pageCount === 1 ? "" : "s"} · {sizeLabel}
            </p>
          </div>
          <Button
            variant="secondary"
            className="self-center sm:self-start"
            leftIcon={<Eye className="size-4" />}
            onClick={() => setPreviewing(true)}
            disabled={displays.length === 0}
          >
            Preview the book
          </Button>
        </div>
      </div>

      {missingArt > 0 && (
        <div className="mt-4 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            {missingArt} page{missingArt === 1 ? "" : "s"} still {missingArt === 1 ? "has" : "have"} no
            illustration and will print blank.{" "}
            <button onClick={() => setStep("edit")} className="font-semibold underline">
              Finish designing
            </button>{" "}
            first, or continue anyway.
          </span>
        </div>
      )}

      {printBlockedReason && (
        <div className="mt-4 flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            {printBlockedReason}{" "}
            <button onClick={() => setStep("edit")} className="font-semibold underline">
              Back to design
            </button>
            {ebookEnabled ? " to adjust it. The digital edition is still available." : " to adjust it."}
          </span>
        </div>
      )}

      <div className={`mt-6 grid gap-4 ${ebookEnabled ? "sm:grid-cols-2" : ""}`}>
        <OptionCard
          icon={<ShoppingBag className="size-6" />}
          tone="brand"
          title="Order a printed book"
          desc="Professionally printed, bound and shipped to your door."
          price={printFromPrice != null ? `from ${fmtMoney(printFromPrice, baseCurrency)} + shipping` : undefined}
          priceLink={
            priceLinkHref
              ? { href: priceLinkHref, label: "See the exact price & shipping" }
              : undefined
          }
          cta="Order print"
          note={printBlocked ? printBlockedReason ?? undefined : purchaseNote}
          disabled={printBlocked}
          onClick={() => requireFullAccount(() => setOrdering(true))}
        />
        {ebookEnabled && (
          <OptionCard
            icon={ebookOwned ? <Download className="size-6" /> : <Tablet className="size-6" />}
            tone={ebookOwned ? "brand" : "neutral"}
            title={
              ebookQuoteLoading ? "Checking your ebook…" : ebookOwned ? "Your ebook" : "Get the ebook"
            }
            desc={
              ebookQuoteLoading
                ? "Looking up whether you already own the digital edition."
                : ebookOwned
                  ? "You already own the digital edition — download it any time, on any device."
                  : "A high-quality PDF of your book — read it on any device, forever."
            }
            price={
              // Owning it is the whole story — showing a price alongside "already
              // purchased" would just raise the question of why one's mentioned.
              ebookQuoteLoading
                ? undefined
                : ebookOwned
                  ? "Already purchased"
                  : ebookDisplay == null
                    ? undefined
                    : ebookDisplay.included
                      ? `Included with your ${ebookDisplay.planName} plan`
                      : ebookDisplay.planName
                        ? `${fmtMoney(ebookDisplay.price, baseCurrency)} · ${ebookDisplay.planName} price`
                        : fmtMoney(ebookDisplay.price, baseCurrency)
            }
            cta={ebookOwned ? "Download your ebook" : "Get the ebook"}
            note={
              ebookQuoteLoading
                ? undefined
                : ebookOwned
                  ? ebookStale
                    ? "Design updated since you bought this — a free refresh is ready inside."
                    : "Find it anytime under Downloads in your account menu."
                  : purchaseNote
            }
            loading={ebookQuoteLoading}
            disabled={ebookQuoteLoading}
            onClick={() => requireFullAccount(() => setBuyingEbook(true))}
          />
        )}
      </div>

      <OrderDialog
        open={ordering}
        onClose={() => setOrdering(false)}
        project={project}
        pages={pages}
        design={design}
      />

      <EbookDialog
        open={buyingEbook}
        onClose={() => setBuyingEbook(false)}
        project={project}
        design={design}
        initialQuote={ebookQuote}
      />

      <AnimatePresence>
        {previewing && displays.length > 0 && (
          <BookPreview displays={displays} onClose={() => setPreviewing(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}

function OptionCard({
  icon,
  title,
  desc,
  price,
  priceLink,
  cta,
  note,
  onClick,
  tone,
  loading,
  disabled,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  /** Shown up front so nobody has to click to learn what it costs. */
  price?: string;
  /**
   * A way to see the number behind `price` in full before committing — the
   * print card's "from $X + shipping" is an entry price, and this is where
   * someone finds out what shipping to their own country actually is without
   * opening checkout to ask. Opens in a new tab: the Studio is a full-screen
   * editor a project is open in, so navigating away to check a price would
   * cost the visitor their place in it.
   */
  priceLink?: { href: string; label: string };
  cta: string;
  /** Small line under the CTA (e.g. the account/verify requirement). */
  note?: string;
  onClick: () => void;
  tone: "brand" | "neutral";
  loading?: boolean;
  /** Greys out the card + disables the CTA (e.g. the book doesn't fit this format). */
  disabled?: boolean;
}) {
  return (
    <motion.div
      className={`flex flex-col gap-3 rounded-2xl border border-ink-200 bg-white p-5 ${
        disabled ? "opacity-60" : ""
      }`}
    >
      <span
        className={
          tone === "brand"
            ? "flex size-12 items-center justify-center rounded-2xl bg-brand-600 text-(--color-brand-foreground) shadow-soft"
            : "flex size-12 items-center justify-center rounded-2xl bg-ink-100 text-ink-600"
        }
      >
        {loading ? <Loader2 className="size-6 animate-spin" /> : icon}
      </span>
      <div className="flex-1">
        <h3 className="text-sm font-bold text-ink-900">{title}</h3>
        <p className="mt-1 text-xs leading-relaxed text-ink-500">{desc}</p>
        {price && <p className="mt-2 text-sm font-bold text-ink-800">{price}</p>}
        {priceLink && (
          <a
            href={priceLink.href}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-block text-[11px] text-ink-400 underline decoration-ink-300 underline-offset-2 hover:text-brand-600"
          >
            {priceLink.label} ↗
          </a>
        )}
      </div>
      <Button
        variant={tone === "brand" ? "primary" : "secondary"}
        loading={loading}
        disabled={disabled}
        onClick={onClick}
      >
        {cta}
      </Button>
      {note && <p className="-mt-1 text-center text-[11px] leading-relaxed text-ink-400">{note}</p>}
    </motion.div>
  );
}
