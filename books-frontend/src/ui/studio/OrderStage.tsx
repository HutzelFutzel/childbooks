import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  BookOpenCheck,
  Eye,
  Loader2,
  ShoppingBag,
  Tablet,
  TriangleAlert,
} from "lucide-react";
import { bookProductForConfig } from "../../core/book";
import { ebookPlanPrice } from "../../core/config/products";
import { findPublicPlanByPriceId } from "../../core/config/plans";
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
import { useStudio } from "./StudioContext";
import { buildDisplaySpreads, type Entry } from "./SpreadEditor";
import { getCursor } from "../../core/versioning";
import { COVER_BACK_ID, COVER_FRONT_ID } from "../../core/types";
import { BookPreview } from "./BookPreview";

/**
 * Step 4 · Order. The finish line: flip through the book, order a professionally
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
  const pageCount = pages.length;
  const contentPages = pages.filter((p) => !p.isCover).length;
  const bookProduct = bookProductForConfig(project.config);
  const sizeLabel = bookProduct.label;

  const catalogProduct = useMemo(
    () => publicProducts.find((p) => p.sku === bookProduct.sku),
    [publicProducts, bookProduct.sku],
  );

  // Physical page limits for the chosen format. Falls back to the provider
  // catalog's minimum when the admin catalog hasn't been configured yet.
  const minPages = catalogProduct?.conditions.pages.min ?? bookProduct.minPages;
  const maxPages = catalogProduct?.conditions.pages.max ?? Number.POSITIVE_INFINITY;
  const belowMinPages = contentPages < minPages;
  const aboveMaxPages = contentPages > maxPages;
  const printBlocked = belowMinPages || aboveMaxPages;
  const printBlockedReason = belowMinPages
    ? `This format needs at least ${minPages} pages — your book has ${contentPages}. Add ${minPages - contentPages} more before ordering a print copy.`
    : aboveMaxPages
      ? `This format allows up to ${maxPages} pages — your book has ${contentPages}. Remove some pages or choose another format.`
      : null;

  const printFromPrice = useMemo(() => {
    const price = catalogProduct?.prices[baseCurrency];
    return typeof price === "number" && price > 0 ? price : null;
  }, [catalogProduct, baseCurrency]);

  // Plan-aware ebook price (mirrors the server quote): the subscriber's plan
  // price replaces the sticker price when one is configured; 0 ⇒ included with
  // the plan. Wording is derived from the data so it stays correct no matter
  // how plans/prices are configured in the admin.
  const ebookDisplay = useMemo(() => {
    const listPrice = ebookSettings.prices[baseCurrency] ?? 0;
    if (listPrice <= 0) return null;
    const sub = activeSubscription(subscriptions);
    const plan = sub ? findPublicPlanByPriceId(publicPlans, sub.priceId) : null;
    const planPrice = plan && !plan.isFree ? ebookPlanPrice(ebookSettings, plan.id, baseCurrency) : null;
    const planApplied = planPrice != null && planPrice < listPrice;
    const price = planApplied ? planPrice : listPrice;
    return {
      price,
      planName: planApplied && plan ? plan.name : null,
      included: planApplied && price <= 0,
    };
  }, [ebookSettings, baseCurrency, subscriptions, publicPlans]);

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
        eyebrow="Step 4 · Order"
        eyebrowIcon={BookOpenCheck}
        tone="mint"
        title="Your book is ready"
        subtitle="Take one last look, then order a beautifully bound copy or get the digital edition."
      />

      <div className="relative flex flex-col items-center gap-6 rounded-3xl border border-ink-100 bg-aurora p-6 shadow-soft sm:flex-row sm:items-center">
        <Celebrate play={celebrate} />
        <BookMockup blobId={cover?.blobId} aspect={cover?.aspect ?? 1} className="shrink-0 py-2" />
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
          cta="Order print"
          note={printBlocked ? printBlockedReason ?? undefined : purchaseNote}
          disabled={printBlocked}
          onClick={() => requireFullAccount(() => setOrdering(true))}
        />
        {ebookEnabled && (
          <OptionCard
            icon={<Tablet className="size-6" />}
            tone="neutral"
            title="Get the ebook"
            desc="A high-quality PDF of your book — read it on any device, forever."
            price={
              ebookDisplay == null
                ? undefined
                : ebookDisplay.included
                  ? `Included with your ${ebookDisplay.planName} plan`
                  : ebookDisplay.planName
                    ? `${fmtMoney(ebookDisplay.price, baseCurrency)} · ${ebookDisplay.planName} price`
                    : fmtMoney(ebookDisplay.price, baseCurrency)
            }
            cta="Get the ebook"
            note={purchaseNote}
            onClick={() => requireFullAccount(() => setBuyingEbook(true))}
          />
        )}
      </div>

      <div className="mt-8 flex justify-center">
        <button
          onClick={() => setStep("edit")}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-ink-500 transition hover:bg-ink-100 hover:text-brand-600"
        >
          <ArrowLeft className="size-3.5" /> Back to design
        </button>
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
        pages={pages}
        design={design}
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
      whileHover={disabled ? undefined : { y: -3 }}
      transition={{ type: "spring", stiffness: 360, damping: 26 }}
      className={`flex flex-col gap-3 rounded-3xl border border-ink-100 bg-white p-5 shadow-soft ${
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
