import { useEffect, useMemo, useState } from "react";
import { AnimatePresence } from "framer-motion";
import {
  ArrowRight,
  CheckCircle2,
  Download,
  Eye,
  Loader2,
  ShoppingBag,
  Tablet,
  TriangleAlert,
} from "lucide-react";
import { bookProductForConfig } from "../../core/book";
import { ebookPlanPrice, findPublicProductForSku } from "../../core/config/products";
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
import { Callout } from "../components/Callout";
import { Card, CardBody } from "../components/Card";
import { Celebrate } from "../components/Celebrate";
import { fmtMoney } from "../admin/tabs/products/parts";
import { OrderCheckout } from "../checkout/OrderDialog";
import { EbookCheckout } from "../checkout/EbookDialog";
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
  // `EbookCheckout` makes) — shown as a note on the card so an owner already
  // knows a free refresh is waiting, instead of finding out only after
  // opening the dialog.
  const fingerprint = useMemo(() => renderFingerprint(project, design), [project, design]);
  const ebookStale = ebookOwned && ebookQuote?.ownedFingerprint !== fingerprint;

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

  if (ordering) {
    return (
      <OrderCheckout
        onBack={() => setOrdering(false)}
        project={project}
        pages={pages}
        design={design}
      />
    );
  }

  if (buyingEbook) {
    return (
      <EbookCheckout
        onBack={() => setBuyingEbook(false)}
        project={project}
        design={design}
        cover={cover}
        initialQuote={ebookQuote}
      />
    );
  }

  // Name the one extra step up front, so the account ask at the buy button
  // never feels like a surprise wall.
  const purchaseNote =
    accessLevel === "guest"
      ? "Takes a free account (about 30 seconds) — your book comes with you."
      : accessLevel === "unverified"
        ? "Verify your email first — check your inbox for our link."
        : undefined;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-7 sm:px-6 sm:py-9">
      <header className="max-w-2xl">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-brand-700">
          <CheckCircle2 className="size-4" /> Book ready
        </p>
        <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-ink-900 sm:text-4xl">
          Review your book
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-600 sm:text-base">
          Take one final look, then choose the edition you want.
        </p>
      </header>

      <Card className="relative mt-7 overflow-hidden">
        <Celebrate play={celebrate} />
        <CardBody className="grid gap-0 p-0 md:grid-cols-[17rem_minmax(0,1fr)]">
          <div className="flex min-h-72 items-center justify-center bg-ink-50 p-8">
            <BookMockup
              blobId={cover?.blobId}
              pageDesign={project.design?.pages[COVER_FRONT_ID]}
              aspect={cover?.aspect ?? 1}
              width={180}
              variant="flat"
            />
          </div>
          <div className="flex min-w-0 flex-col justify-center p-6 sm:p-8">
            <h2 className="truncate font-display text-2xl font-bold tracking-tight text-ink-900">
              {project.title}
            </h2>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-500">
              <span>{pageCount} {pageCount === 1 ? "page" : "pages"}</span>
              <span>{sizeLabel}</span>
            </div>
            <p className="mt-5 max-w-xl text-sm leading-relaxed text-ink-600">
              Flip through the finished pages and check the cover, text and illustrations before
              ordering or downloading.
            </p>
            <Button
              variant="secondary"
              className="mt-5 self-start"
              leftIcon={<Eye className="size-4" />}
              onClick={() => setPreviewing(true)}
              disabled={displays.length === 0}
            >
              Preview every page
            </Button>
          </div>
        </CardBody>
      </Card>

      {missingArt > 0 && (
        <Callout
          tone="warning"
          icon={TriangleAlert}
          className="mt-4"
          title={`${missingArt} ${missingArt === 1 ? "page is" : "pages are"} missing artwork`}
          action={
            <Button size="sm" variant="secondary" onClick={() => setStep("edit")}>
              Finish designing
            </Button>
          }
        >
          Missing illustrations will appear blank in either edition.
        </Callout>
      )}

      {printBlockedReason && (
        <Callout
          tone="danger"
          icon={TriangleAlert}
          className="mt-4"
          title="This page count cannot be printed"
          action={
            <Button size="sm" variant="secondary" onClick={() => setStep("edit")}>
              Adjust pages
            </Button>
          }
        >
          {printBlockedReason}
          {ebookEnabled ? " The digital edition is still available." : ""}
        </Callout>
      )}

      <section className="mt-9" aria-labelledby="edition-heading">
        <div>
          <h2 id="edition-heading" className="font-display text-xl font-bold text-ink-900">
            Choose an edition
          </h2>
          <p className="mt-1 text-sm text-ink-500">You can come back for the other edition anytime.</p>
        </div>

        <div className={`mt-4 grid gap-4 ${ebookEnabled ? "md:grid-cols-2" : ""}`}>
        <EditionCard
          eyebrow="Printed edition"
          icon={<ShoppingBag className="size-6" />}
          featured
          title="A book to hold"
          description="Professionally printed and bound, with delivery tracking to your door."
          price={printFromPrice != null ? `from ${fmtMoney(printFromPrice, baseCurrency)} + shipping` : undefined}
          cta="Choose print options"
          note={printBlocked ? "Adjust the page count before ordering." : purchaseNote}
          disabled={printBlocked}
          onClick={() => requireFullAccount(() => setOrdering(true))}
        />
        {ebookEnabled && (
          <EditionCard
            eyebrow="Digital edition"
            icon={ebookOwned ? <Download className="size-6" /> : <Tablet className="size-6" />}
            title={
              ebookQuoteLoading ? "Checking your ebook…" : ebookOwned ? "Already yours" : "Read it anywhere"
            }
            description={
              ebookQuoteLoading
                ? "Checking your account for this digital edition."
                : ebookOwned
                  ? "Download the high-quality PDF again whenever you need it."
                  : "A high-quality PDF for tablets, phones and computers."
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
            cta={ebookOwned ? "Open digital edition" : "Choose digital edition"}
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
      </section>

      <AnimatePresence>
        {previewing && displays.length > 0 && (
          <BookPreview displays={displays} onClose={() => setPreviewing(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}

function EditionCard({
  eyebrow,
  icon,
  title,
  description,
  price,
  cta,
  note,
  onClick,
  featured,
  loading,
  disabled,
}: {
  eyebrow: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  /** Shown up front so nobody has to click to learn what it costs. */
  price?: string;
  cta: string;
  /** Small line under the CTA (e.g. the account/verify requirement). */
  note?: string;
  onClick: () => void;
  featured?: boolean;
  loading?: boolean;
  /** Greys out the card + disables the CTA (e.g. the book doesn't fit this format). */
  disabled?: boolean;
}) {
  return (
    <Card
      className={`flex min-h-72 flex-col overflow-hidden ${
        featured ? "ring-brand-200" : ""
      } ${disabled ? "opacity-60" : ""}`}
    >
      <CardBody className="flex h-full flex-1 flex-col p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-400">{eyebrow}</p>
            <h3 className="mt-2 font-display text-xl font-bold tracking-tight text-ink-900">{title}</h3>
          </div>
          <span className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${
            featured ? "bg-brand-600 text-(--color-brand-foreground)" : "bg-ink-100 text-ink-600"
          }`}>
            {loading ? <Loader2 className="size-5 animate-spin" /> : icon}
          </span>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-ink-500">{description}</p>
        <div className="mt-auto pt-6">
          {price && <p className="mb-3 text-sm font-semibold text-ink-800">{price}</p>}
          <Button
            className="w-full"
            variant={featured ? "primary" : "secondary"}
            rightIcon={<ArrowRight className="size-4" />}
            loading={loading}
            disabled={disabled}
            onClick={onClick}
          >
            {cta}
          </Button>
          {note && <p className="mt-2 text-center text-[11px] leading-relaxed text-ink-400">{note}</p>}
        </div>
      </CardBody>
    </Card>
  );
}
