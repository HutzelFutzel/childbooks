"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, Loader2, MapPin, Minus, Plus, ShieldCheck, TriangleAlert } from "lucide-react";
import { bookProductForConfig, formatCapabilitiesForProject } from "../../core/book";
import { findPublicPlanByPriceId } from "../../core/config/plans";
import {
  findPublicProductForSku,
  planMeetsAccess,
  productAccessOf,
} from "../../core/config/products";
import { allowedMarketsFor } from "../../core/config/productMath";
import {
  currencyForMarket,
  PROBE_STATE,
  STATE_CODE_REQUIRED,
  TAX_ID_LABEL,
  TAX_ID_REQUIRED,
} from "../../core/config/countries";
import { subdivisionsFor } from "../../core/config/subdivisions";
import { countryFlag, countryLabel } from "../../core/analytics/markets";
import {
  createDefaultVariantPolicy,
  CUSTOMER_VARIANT_AXES,
  NO_OPTION,
  normalizeVariantPolicy,
  simplifiedPrintVariant,
  variantOptionLabel,
  type VariantSelection,
} from "../../core/config/variants";
import { buildOrderDraft } from "../../core/fulfillment/draft";
import { bindingNoun } from "../../core/fulfillment";
import { bestAlternative, limitsOf, planPageCount } from "../../core/print/pageCountPlan";
import { insertSpreadProject } from "../../core/book/pageEdits";
import { PAGE_TEMPLATES, type PageTemplate } from "../../core/book/pageTemplates";
import { renderFingerprint } from "../../core/print/fingerprint";
import { interiorLeafPlan, physicalPageCount } from "../../core/print/pagePlan";
import { preflightInterior } from "../../core/print/preflight";
import { coverDocumentKey, fetchRenderAvailability, renderBook } from "../../platform/renders";
import { getCursor } from "../../core/versioning";
import { illustrationUnits } from "../../state/bookUnits";
import { unitIsDone } from "../../core/book/pageCompletion";
import { isNetworkError } from "../../core/errors";
import { FulfillmentError } from "../../core/fulfillment/errors";
import type {
  Recipient,
  ShippingMethod,
} from "../../core/fulfillment/types";
import { coverLinesOf } from "../../core/book/coverLines";
import { foilStampText } from "../../core/fulfillment/lulu/foilStamp";
import { phoneProblem, taxIdProblem } from "../../core/fulfillment/recipientFormat";
import { SpineStampFields, type SpineLines } from "./SpineStampFields";
import { BASE_VARIANT } from "../../core/fulfillment/lulu/products";
import { skuForVariant, variantFromSku } from "../../core/fulfillment/lulu/skuAxes";
import { COVER_FRONT_ID, type BookDesign, type Project } from "../../core/types";
import { addressSummary, type SavedAddress } from "../../core/profile/types";
import { createFulfillment } from "../../platform/fulfillment";
import {
  fetchOrderPrice,
  startOrderCheckout,
  type RetailPricePreview,
} from "../../platform/payments";
import { isDev } from "../../platform/runtime";
import { activeSubscription } from "../../platform/subscriptions";
import { useAuthStore } from "../../state/authStore";
import { useProfileStore } from "../../state/profileStore";
import { flushProjectSaves, useProjectsStore } from "../../state/projectsStore";
import { useAppConfigStore } from "../../state/appConfigStore";
import { useSubscriptionStore } from "../../state/subscriptionStore";
import { useFormatsForConfigSize } from "../hooks/useOfferableFormats";
import { CouponField } from "./CouponField";
import { OfferPreviewNote } from "./OfferPreviewNote";
import { useShipCountry } from "../hooks/useShipCountry";
import { Button } from "../components/Button";
import { PageCountNotice } from "./PageCountNotice";
import { Card, CardBody, CardHeader, CardTitle } from "../components/Card";
import { Field, Input, fieldMessageId } from "../components/Input";
import { Select } from "../components/Select";
import { cn } from "../lib/cn";
import { notify } from "../lib/notify";
import { insetPageText, type DesignPage } from "../design/designInit";
import { BookMockup } from "../components/BookMockup";
import { buildCoverPlan } from "../design/printTargets";
import { busyReason } from "../../core/guide/bookBusy";
import { useBookBusy } from "../../state/useBookBusy";
import { FormatPicker } from "./FormatPicker";
import { VariantPicker } from "./VariantPicker";
import {
  AddressSuggestion,
  addressSignature,
  suggestionKey,
  type AddressChoice,
  type EnteredAddress,
} from "./AddressSuggestion";

type Phase = "form" | "rendering" | "submitting";

const MM_PER_IN = 25.4;

const SHIPPING: { value: ShippingMethod; label: string }[] = [
  { value: "Budget", label: "Budget (slowest, cheapest)" },
  { value: "Standard", label: "Standard" },
  { value: "StandardPlus", label: "Standard Plus" },
  { value: "Express", label: "Express" },
  { value: "Overnight", label: "Overnight (fastest)" },
];

const SHIPPING_LABEL: Record<ShippingMethod, string> = Object.fromEntries(
  SHIPPING.map((s) => [s.value, s.label]),
) as Record<ShippingMethod, string>;

// In dev, seed the form with a real Lulu-priceable address so the live quote
// fires and the order can be placed without typing. Empty in production.
const DEV_PREFILL = isDev()
  ? {
      name: "David Sperber",
      phone: "+1 669 677 0452",
      line1: "1850 Sand Hill Road",
      line2: "18",
      city: "Palo Alto",
      region: "CA",
      postal: "94304",
      country: "US",
    }
  : null;

/** Pages that make sense at the END of the book, where a spare page costs nothing. */
const BACK_PAGE_TEMPLATES = PAGE_TEMPLATES.filter((t) => t.position === "back");

export function OrderCheckout({
  onBack,
  project,
  pages,
  design,
  onChooseEbook,
}: {
  onBack: () => void;
  project: Project;
  pages: DesignPage[];
  design: BookDesign;
  /**
   * Offered when the caller can also sell the digital edition from here. A
   * customer who finds the printed price or the delivery step more than they
   * wanted should be able to step sideways, not back out to find another door.
   */
  onChooseEbook?: () => void;
}) {
  const provider = useMemo(() => createFulfillment(), []);
  const email = useAuthStore((s) => s.user?.email ?? "");

  // The book's SIZE is fixed by the design (every illustration was generated at
  // its aspect). The BINDING isn't: the formats below all print the same pages at
  // the same trim, so it's chosen here, where the final page count — the thing
  // that decides which bindings can even take this book — is known.
  // The destination, hoisted above the format hooks because it now FEEDS them:
  // which bindings exist is a question about where the book is going, so the
  // country has to be known before the format list can be built. It stays part
  // of the address block in the form below.
  //
  // Seeded from the visitor's location only as a guess. Where the buyer sits
  // and where a gift is sent are different countries often enough that the
  // guess must never survive contact with a real address.
  const { country: geoCountry, setCountry: rememberCountry } = useShipCountry();
  const [country, setCountry] = useState(DEV_PREFILL?.country ?? "");
  const { formats, offerable: offerableCatalog } = useFormatsForConfigSize(
    project.config,
    country,
  );
  const designFormat = bookProductForConfig(project.config);
  const updateConfig = useProjectsStore((s) => s.updateConfig);
  const product = useMemo(
    () => formats.find((f) => f.sku === project.config.productSku) ?? designFormat,
    [formats, project.config.productSku, designFormat],
  );

  // Subscription access gate. The backend is the authoritative check at
  // checkout; this mirrors it so we can disable ordering + explain why up front.
  const publicProducts = useAppConfigStore((s) => s.products.products);
  const publicPlans = useAppConfigStore((s) => s.plans.plans);
  // The open markets bound the country picker. Empty until the snapshot lands,
  // which is the right way round — offering a country we don't ship to sends
  // the customer down a path checkout refuses.
  const registry = useAppConfigStore((s) => s.markets);
  const marketsLoaded = useAppConfigStore((s) => s.marketsLoaded);
  const pricingSettings = useAppConfigStore((s) => s.pricingSettings);
  const subscriptions = useSubscriptionStore((s) => s.subscriptions);
  const watchSubscriptions = useSubscriptionStore((s) => s.watch);
  useEffect(() => {
    watchSubscriptions();
  }, [watchSubscriptions]);
  const catalogProduct = useMemo(
    () => findPublicProductForSku(publicProducts, product.sku),
    [publicProducts, product.sku],
  );

  const variantPolicy = useMemo(
    () =>
      normalizeVariantPolicy(
        catalogProduct?.variants ?? createDefaultVariantPolicy(),
        catalogProduct?.defaultVariant ?? variantFromSku(product.sku) ?? BASE_VARIANT,
      ),
    [catalogProduct, product.sku],
  );
  const defaultVariant = useMemo(
    () =>
      simplifiedPrintVariant(
        variantPolicy,
        catalogProduct?.defaultVariant ?? variantFromSku(product.sku) ?? BASE_VARIANT,
      ) ?? BASE_VARIANT,
    [variantPolicy, catalogProduct, product.sku],
  );
  const [variant, setVariant] = useState<VariantSelection>(defaultVariant);
  // The last linen and foil the customer picked, so trying another binding and
  // coming back to the linen hardcover doesn't lose their colours.
  const [clothChoice, setClothChoice] = useState<Pick<VariantSelection, "linen" | "foil"> | null>(null);
  // Changing the binding can change which finishes and cloths exist. Preserve
  // the visible choices while re-applying the fixed picture-book interior spec.
  useEffect(() => {
    setVariant(
      (prev) =>
        simplifiedPrintVariant(variantPolicy, { ...defaultVariant, finish: prev.finish, ...clothChoice }) ??
        defaultVariant,
    );
  }, [variantPolicy, defaultVariant, clothChoice]);
  const spineDefaults = useMemo<SpineLines>(() => {
    const lines = coverLinesOf(project);
    return { title: lines.title, author: lines.author };
  }, [project]);
  // Null until the customer edits the spine: until then it follows the book.
  const [spineEdit, setSpineEdit] = useState<SpineLines | null>(null);
  const spineLines = spineEdit ?? spineDefaults;
  const foilStamp = useMemo(
    () => (variant.foil !== NO_OPTION ? foilStampText(spineLines) : null),
    [variant.foil, spineLines],
  );
  const chooseVariant = (next: VariantSelection) => {
    const chosen = simplifiedPrintVariant(variantPolicy, next) ?? defaultVariant;
    if (chosen.linen !== NO_OPTION) setClothChoice({ linen: chosen.linen, foil: chosen.foil });
    setVariant(chosen);
  };

  const printSku = useMemo(
    () => skuForVariant(product.sku, variant) ?? product.sku,
    [product.sku, variant],
  );
  const accessGate = useMemo(() => {
    if (!catalogProduct) return { ok: true as const, mode: "public" as const };
    const access = productAccessOf(catalogProduct.conditions);
    if (access.mode === "public") return { ok: true as const, mode: access.mode };
    const sub = activeSubscription(subscriptions);
    const plan = sub ? findPublicPlanByPriceId(publicPlans, sub.priceId) : null;
    const planId = plan?.id ?? publicPlans.find((p) => p.isFree)?.id ?? "free";
    const isSubscribed = Boolean(plan && !plan.isFree);
    return { ok: planMeetsAccess(access, { planId, isSubscribed }), mode: access.mode };
  }, [catalogProduct, publicPlans, subscriptions]);

  const savedAddresses = useProfileStore((s) => s.addresses);
  const addressesLoading = useProfileStore((s) => s.loading);
  const preferredAddress = useProfileStore((s) => s.preferredAddress);
  const upsertAddress = useProfileStore((s) => s.upsertAddress);

  // The PHYSICAL page count, not the number of design pages. A double-page
  // spread is one design page but two printed leaves, and a pagination filler
  // is a printed leaf with no design page at all — counting editor pages
  // priced books by a number the interior PDF never had.
  const doc = useMemo(
    () => (project.screenplay ? getCursor(project.screenplay).content : null),
    [project.screenplay],
  );
  const contentPages = useMemo(() => physicalPageCount(doc), [doc]);
  // Printed length = the story rounded up to what this binding takes (sheet
  // size and minimum). Blank pages make up the difference; it is only ever a
  // book longer than the binding holds that can't be ordered as is.
  const pageLimits = useMemo(() => limitsOf(product, catalogProduct), [product, catalogProduct]);
  const pagePlan = useMemo(() => planPageCount(contentPages, pageLimits), [contentPages, pageLimits]);
  const pageCount = pagePlan.printed;
  const incompleteUnits = useMemo(
    () => illustrationUnits(project).filter((unit) => !unitIsDone(project, unit)).length,
    [project],
  );

  // Placement problems the editor can't show, because it has no idea where the
  // knife lands or where the binding curves. Advisory: the margins are comfort,
  // not a cliff, and a deliberate bleed-to-edge word shouldn't block a sale.
  const preflight = useMemo(
    () =>
      preflightInterior({
        plan: interiorLeafPlan(doc),
        design,
        caps: formatCapabilitiesForProject(project),
        hasArtwork: (pageId) => {
          if (pages.find((p) => p.id === pageId)?.blobId) return true;
          const unit = illustrationUnits(project).find((item) => item.id === pageId);
          return unit ? unitIsDone(project, unit) : false;
        },
        labelFor: (pageId) => pages.find((p) => p.id === pageId)?.label ?? "A page",
      }),
    [doc, design, project, pages],
  );

  // Order limits for this format. The admin catalog is authoritative when set;
  // otherwise we fall back to the provider catalog's own page limits. The
  // backend re-checks these at checkout — this just fails fast with a clear
  // message instead of after the (slow) print-file render.
  const maxCopies = catalogProduct?.conditions.copies.max ?? Number.POSITIVE_INFINITY;

  // Countries this product can actually be shipped to, from the same function
  // the server enforces with — so the picker can't offer a destination checkout
  // will refuse.
  //
  // There is deliberately no hardcoded fallback list. The old one offered
  // France, Spain, Italy and the Netherlands — markets nobody had opened — so a
  // customer could pick a destination the server would then refuse. Until the
  // registry and the catalog have both loaded the picker is simply empty.
  const countryOptions = useMemo(() => {
    if (!catalogProduct) return [];
    return allowedMarketsFor(registry, catalogProduct.shipping.destinations).map((value) => ({
      value,
      label: `${countryFlag(value)} ${countryLabel(value)}`,
    }));
  }, [catalogProduct, registry]);

  const [phase, setPhase] = useState<Phase>("form");
  const [status, setStatus] = useState("");
  const [coverDims, setCoverDims] = useState<{ widthMm: number; heightMm: number } | null>(null);
  const fingerprint = useMemo(() => renderFingerprint(project, design), [project, design]);

  const [name, setName] = useState(DEV_PREFILL?.name ?? "");
  const [contactEmail, setContactEmail] = useState(email);
  const [phone, setPhone] = useState(DEV_PREFILL?.phone ?? "");
  const [line1, setLine1] = useState(DEV_PREFILL?.line1 ?? "");
  const [line2, setLine2] = useState(DEV_PREFILL?.line2 ?? "");
  const [city, setCity] = useState(DEV_PREFILL?.city ?? "");
  const [region, setRegion] = useState(DEV_PREFILL?.region ?? "");
  const [postal, setPostal] = useState(DEV_PREFILL?.postal ?? "");
  // The recipient's own tax id, for the handful of customs regimes that demand
  // one. Collected HERE because it is the last cheap moment: the provider only
  // rejects a missing one when the print job is created, which is after the
  // customer has been charged.
  const [taxId, setTaxId] = useState("");
  const [formatTouched, setFormatTouched] = useState({ phone: false, taxId: false });
  const [copies, setCopies] = useState(1);
  // Corrected to something this destination actually offers as soon as the
  // catalog and the country are both known. A fixed default was wrong for most
  // countries — the printer runs a different set of services in each — and the
  // customer only found out when the first quote failed.
  const [shipping, setShipping] = useState<ShippingMethod>("Budget");
  // A coupon code the customer entered and the server accepted for THIS order.
  // Held here rather than in the draft because it isn't part of the book — it's
  // re-validated inside the checkout transaction and can be refused there.
  const [couponCode, setCouponCode] = useState<string | null>(null);
  // What that code takes off, so the totals show what will actually be charged.
  const [couponDiscount, setCouponDiscount] = useState(0);
  // Bumped when the customer leaves, or the dialog unmounts. Preparing the print
  // files is a chain of awaits that ends in a redirect to payment; without this,
  // pressing Back part-way through still carried on and sent them to Stripe from
  // a screen they had already left.
  const runRef = useRef(0);
  useEffect(
    () => () => {
      runRef.current += 1;
    },
    [],
  );
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [checkOpen, setCheckOpen] = useState(false);
  const [showLine2, setShowLine2] = useState(Boolean(DEV_PREFILL?.line2));
  const [showOptionalRegion, setShowOptionalRegion] = useState(false);

  // Saved-address book: "" means a new/unsaved address is being entered.
  const [selectedAddressId, setSelectedAddressId] = useState("");
  // The saved entry a carrier-corrected address came from. Taking the carrier's
  // version detaches from the selection (like typing would), but saving it should
  // still REPLACE the entry it corrects — otherwise the address book fills with
  // a near-duplicate and the wrong original stays the default.
  const [correctedFromId, setCorrectedFromId] = useState("");
  const [saveForNextTime, setSaveForNextTime] = useState(true);
  // Prefill from the user's preferred address once per dialog open, so returning
  // customers don't retype. Skipped in dev (the DEV_PREFILL already fills it).
  const prefilledRef = useRef(false);

  const [quote, setQuote] = useState<RetailPricePreview | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoteRetry, setQuoteRetry] = useState(0);
  // The address the current quote was made FOR. A carrier verdict is only a
  // verdict on that exact address; once a field changes it describes something
  // else, and offering its "correction" would overwrite what was just typed.
  const [quotedFor, setQuotedFor] = useState("");
  const quoteSeq = useRef(0);

  // The code box only exists while there's a quote, and takes what it knew with it
  // when it goes. Without this the parent kept holding the code (and sending it
  // to checkout) after the field showing it had unmounted.
  const hasQuote = quote != null;
  useEffect(() => {
    if (hasQuote) return;
    setCouponCode(null);
    setCouponDiscount(0);
  }, [hasQuote]);

  // Which address the customer settled on when the carrier suggested a different
  // one. `"unreviewed"` blocks payment: an unanswered address question is how an
  // order ends up held at the printer with the money already taken. The key is
  // the suggestion itself, so editing the address asks again rather than carrying
  // an answer over to a different question.
  //
  // The decision is tied to the suggestion AND to the address it was made about,
  // not the suggestion alone: the carrier often repeats the same correction for
  // a different address (it only changes the field that differs), so a "keep
  // mine" answered for one street used to carry over to the next one typed.
  const [decision, setDecision] = useState<{
    choice: "suggested" | "entered";
    /** The suggestion + address that was answered. */
    key: string;
    /** The address as it stood after answering (differs from the key's when taking the carrier's). */
    afterSig: string;
  } | null>(null);

  const enteredAddress: EnteredAddress = { line1, line2, city, region, postal, country };
  const addressSig = addressSignature(enteredAddress);

  // What this customer is billed in: the destination's own currency where the
  // catalog supports it, the base currency otherwise. Derived from the country
  // rather than fixed at USD, which is what it used to be — a German customer
  // was charged a dollar amount for a book priced in euros, and every market
  // opened after the first inherited the same mismatch. The server recomputes
  // this from the same function, so the preview and the charge can't disagree.
  const currency = useMemo(
    () => currencyForMarket(country, pricingSettings.currencies, pricingSettings.baseCurrency),
    [country, pricingSettings],
  );

  // A destination we don't sell to — a saved address from before a market was
  // opened elsewhere or withdrawn here. Told plainly rather than corrected: this
  // used to silently rewrite the country to the first one on offer, so a
  // customer with a Tokyo address on file would have their order quietly turned
  // into an Australian one. Only meaningful once the picker has something in it;
  // an empty one means the registry and catalog are still loading, which is not
  // the same as a refusal.
  //
  // The country stays in the picker as a disabled entry, so what the customer
  // reads is what checkout will actually be asked for.
  const unserviced =
    countryOptions.length > 0 && Boolean(country) && !countryOptions.some((o) => o.value === country);
  const countrySelectOptions = useMemo(
    () =>
      unserviced
        ? [
            ...countryOptions,
            { value: country, label: `${countryFlag(country)} ${countryLabel(country)}`, disabled: true },
          ]
        : countryOptions,
    [countryOptions, country, unserviced],
  );

  // The speeds this destination actually offers, with how long each takes and
  // what it costs.
  //
  // Driven by the published rate rows, which are the same rows the server
  // resolves the order against — so the picker can't offer a speed checkout
  // would refuse. It used to list whatever the product had enabled regardless
  // of country, and since the printer runs a different set of services in each,
  // most of those entries were fiction until the quote came back.
  const shippingChoices = useMemo(() => {
    const labels = new Map(
      (catalogProduct?.shipping.methods ?? []).map((m) => [m.method, m.label || SHIPPING_LABEL[m.method]]),
    );
    const rows = (catalogProduct?.shipping.rates ?? []).filter(
      (r) => r.country === country && r.available,
    );
    return rows
      .map((row) => {
        const terms = row.charged[currency];
        return {
          value: row.method,
          label: labels.get(row.method) ?? SHIPPING_LABEL[row.method] ?? row.method,
          // Absent when the route was never measured. The order still prices —
          // checkout live-quotes it — so the option is offered without a
          // number rather than withheld.
          price: terms ? terms.base + terms.perCopy * copies : null,
          transit: transitLabel(row.transitDaysMin, row.transitDaysMax),
        };
      })
      .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
  }, [catalogProduct, country, currency, copies]);

  // Extra fields this destination's carrier demands. Both are hard refusals at
  // the provider rather than style notes, so they're required, not advisory.
  const destination = country.trim().toUpperCase();
  const regionRequired = STATE_CODE_REQUIRED.has(destination);
  const taxIdRequired = TAX_ID_REQUIRED.has(destination);
  const taxIdLabel = TAX_ID_LABEL[destination] ?? "Tax ID";
  // A blank first entry when the field is required: preselecting a state the
  // customer never chose is how a parcel goes to the wrong one.
  //
  // A stored value the list doesn't contain is shown as a disabled entry rather
  // than dropped, for the same reason the country picker does it — an address
  // saved as "California" before this was a picker would otherwise display
  // "Select a state" while still holding a value the carrier rejects.
  const regionOptions = useMemo(() => {
    const subs = subdivisionsFor(destination);
    if (subs.length === 0) return [];
    const known = subs.some((s) => s.code === region);
    return [
      { value: "", label: "Select a state / province" },
      ...subs.map((s) => ({ value: s.code, label: `${s.name} (${s.code})` })),
      ...(region && !known ? [{ value: region, label: `${region} — not recognized`, disabled: true }] : []),
    ];
  }, [destination, region]);
  const regionUnrecognised =
    regionOptions.length > 0 && Boolean(region) && !subdivisionsFor(destination).some((s) => s.code === region);
  // Asked up front only where the carrier needs it (or we can offer a verified
  // list). Elsewhere — Germany, France, the UK — it's an unfamiliar box that
  // nobody needs to fill, so it sits behind a link. A value that's already there
  // keeps the field visible: a hidden value would be sent without being seen.
  const showRegion =
    regionRequired || regionOptions.length > 0 || region.trim() !== "" || showOptionalRegion;
  const quoteIsCurrent = quote != null && quotedFor === addressSig;
  const validation = quoteIsCurrent ? (quote?.addressValidation ?? null) : null;
  const pendingSuggestion = suggestionKey(validation);
  const pendingKey = pendingSuggestion ? `${pendingSuggestion}|${addressSig}` : "";
  const addressChoiceForSuggestion: AddressChoice =
    pendingKey && decision?.key === pendingKey ? decision.choice : "unreviewed";
  // What to record on the order: the answer to a suggestion still on screen, or
  // — once the carrier's version has been adopted and there is nothing left to
  // suggest — the fact that this address IS the carrier's.
  const recordedAddressChoice: "suggested" | "entered" | undefined = pendingKey
    ? addressChoiceForSuggestion === "unreviewed"
      ? undefined
      : addressChoiceForSuggestion
    : decision?.choice === "suggested" && decision.afterSig === addressSig
      ? "suggested"
      : undefined;
  // Two reasons to hold checkout, and only two. An unanswered suggestion, and an
  // address the provider says it cannot validate at all — it would refuse the
  // print job, so letting the payment through would strand it. Everything else
  // (a note about what got tidied up) is information, not a blocker.
  const addressUnverifiable = validation?.severity === "error";
  const addressNeedsReview =
    addressUnverifiable ||
    Boolean(validation?.suggested && addressChoiceForSuggestion === "unreviewed");

  const applyAddressChoice = (next: EnteredAddress) => {
    setLine1(next.line1);
    setLine2(next.line2);
    setCity(next.city);
    setRegion(next.region);
    setPostal(next.postal);
    setCountry(next.country);
    // Adopting the carrier's version detaches from the saved entry it came from,
    // exactly as typing would — but remembers which one, so saving replaces it.
    if (selectedAddressId) setCorrectedFromId(selectedAddressId);
    setSelectedAddressId("");
    setDecision({ choice: "suggested", key: pendingKey, afterSig: addressSignature(next) });
  };

  const keepEnteredAddress = () => {
    setDecision({ choice: "entered", key: pendingKey, afterSig: addressSig });
  };

  // Enough of a destination to ask the provider for a price. The provider needs
  // a city + postcode, and a state in the countries that mandate one — quoting
  // without it validates a different address than the order would ship to. An
  // unserviced country is not asked about at all: the server would refuse it,
  // and a refusal in the price box says less than the notice under the picker.
  const canQuote = Boolean(
    city.trim() &&
      postal.trim() &&
      country &&
      !unserviced &&
      !regionUnrecognised &&
      (!regionRequired || region.trim()),
  );

  useEffect(() => {
    setContactEmail((e) => e || email);
  }, [email]);

  // Fill an empty country once, from the geo hint if we have one and otherwise
  // from the only market on offer.
  //
  // It starts empty rather than at "US", which is what it used to be: a German
  // customer opened checkout already set to the United States, saw US shipping
  // speeds and US prices, and had to notice and correct it. Filling it from a
  // guess is only safe because it is the EMPTY case — a saved address or
  // anything the customer typed is left alone.
  useEffect(() => {
    if (country) return;
    const seed = geoCountry || (countryOptions.length === 1 ? countryOptions[0].value : "");
    if (seed) setCountry(seed);
  }, [country, geoCountry, countryOptions]);

  // Keep the selection inside what this destination offers. Runs on every
  // country change, not just on open: the previous speed may not exist there,
  // and leaving it selected quotes a combination the server refuses.
  useEffect(() => {
    if (shippingChoices.length === 0) return;
    if (!shippingChoices.some((o) => o.value === shipping)) {
      setShipping(shippingChoices[0].value);
    }
  }, [shippingChoices, shipping]);

  // Same rule one level up, for the BINDING. A destination can remove a whole
  // format — the printer doesn't bind every one in every facility — and the
  // picker below simply stops listing it. Without this the config would keep
  // pointing at a format nobody can see, quoting a book this country can't
  // receive, so the selection is moved to a sibling at the same trim instead.
  //
  // Deliberately not run while the list is empty: that's the catalog still
  // loading, not a destination that refuses everything.
  useEffect(() => {
    if (formats.length === 0) return;
    if (!formats.some((f) => f.sku === project.config.productSku)) {
      void updateConfig({ productSku: formats[0].sku });
    }
  }, [formats, project.config.productSku, updateConfig]);

  // Editing any address field detaches from the picked saved address, so saving
  // creates a new entry instead of silently overwriting the selected one.
  const editAddr = (setter: (value: string) => void, value: string) => {
    setter(value);
    setSelectedAddressId("");
    setCorrectedFromId("");
  };

  const applyAddress = (a: SavedAddress) => {
    setSelectedAddressId(a.id);
    setCorrectedFromId("");
    setName(a.recipientName);
    setPhone(a.phone);
    if (a.email) setContactEmail(a.email);
    setLine1(a.line1);
    setLine2(a.line2);
    setCity(a.city);
    setRegion(a.region);
    setPostal(a.postal);
    // Empty rather than "US" when the saved entry has no country: the seeding
    // effect then fills it from the geo hint, which is a better guess than a
    // fixed default and is the same one the customer saw before opening this.
    setCountry(a.country || "");
  };

  // Prefill from the preferred saved address once.
  useEffect(() => {
    if (prefilledRef.current || DEV_PREFILL) return;
    const preferred = preferredAddress();
    if (preferred) {
      prefilledRef.current = true;
      applyAddress(preferred);
    }
    // Depend on the address count so prefill still fires if the saved addresses
    // finish loading after checkout mounted. The ref guards against re-running
    // on every keystroke. applyAddress/preferredAddress are intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedAddresses.length]);

  // Live shipping/price quote (no print files needed) whenever the inputs change.
  // Held until there's enough of a destination address for the provider to price.
  useEffect(() => {
    const seq = ++quoteSeq.current;
    if (!canQuote) {
      setQuoting(false);
      setQuote(null);
      setQuoteError(null);
      return;
    }
    setQuoting(true);
    const sigAtRequest = addressSignature({ line1, line2, city, region, postal, country });
    const t = setTimeout(async () => {
      try {
        // Retail pricing from the backend — the SAME path used at checkout
        // (tiered retail price + plan discount + charged shipping), so this is
        // what the customer will actually pay (before tax), not the print
        // provider's wholesale quote.
        const priced = await fetchOrderPrice({
          productSku: product.sku,
          variant,
          copies,
          pageCount,
          currency,
          shippingMethod: shipping,
          destinationCountry: country,
          line1,
          // Not price-affecting, but the carrier validates it — quoting without
          // it would clear an address the order isn't going to ship to.
          line2,
          city,
          state: region,
          postalCode: postal,
        });
        if (seq !== quoteSeq.current) return;
        setQuote(priced);
        setQuotedFor(sigAtRequest);
        setQuoteError(null);
      } catch (err) {
        if (seq === quoteSeq.current) {
          setQuote(null);
          // Surface the real reason (the backend returns actionable messages
          // like "This product isn't available." or "Currency … isn't
          // supported."). Only fall back to a generic hint when there's none.
          setQuoteError(
            err instanceof FulfillmentError && err.kind === "auth"
              ? "Please sign in again to see live pricing."
              : isNetworkError(err)
                ? "We couldn't reach our servers to price this. Check your connection and try again."
                : (err instanceof Error && err.message) ||
                  "We couldn't price this destination. Check the city, state and postal code.",
          );
        }
      } finally {
        if (seq === quoteSeq.current) setQuoting(false);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [
    product.sku,
    variant,
    copies,
    country,
    line1,
    line2,
    city,
    region,
    postal,
    shipping,
    canQuote,
    pageCount,
    quoteRetry,
  ]);

  function recipient(): Recipient {
    return {
      name: name.trim(),
      email: contactEmail.trim() || undefined,
      phoneNumber: phone.trim() || undefined,
      address: {
        line1: line1.trim(),
        line2: line2.trim() || undefined,
        townOrCity: city.trim(),
        stateOrCounty: region.trim() || undefined,
        postalOrZipCode: postal.trim(),
        countryCode: country,
        taxId: taxId.trim() || undefined,
      },
    };
  }

  // Format requirements (page count + copies) checked up front so a book that
  // can't be printed in this format never renders → uploads → fails at Stripe.
  //
  // The binding is picked in this dialog, so a length the chosen one won't take
  // is a nudge towards a sibling that will — not the dead end it used to be,
  // when the only cure was going back to the design flow and changing format
  // there (which meant re-picking the size too).
  const alternative = useMemo(
    () =>
      bestAlternative(
        contentPages,
        product.sku,
        formats.map((f) => ({
          sku: f.sku,
          label: bindingNoun(f.binding),
          limits: limitsOf(f, offerableCatalog.get(f.sku)),
        })),
      ),
    [formats, product.sku, offerableCatalog, contentPages],
  );

  const requirementError = useMemo(() => {
    if (incompleteUnits > 0) {
      return `${incompleteUnits} ${
        incompleteUnits === 1 ? "page needs" : "pages need"
      } artwork or an explicit text-only/blank treatment before ordering.`;
    }
    // Too short is never an error — blank pages are added. Only a book longer
    // than the binding holds can't be printed as chosen.
    if (pagePlan.status === "too-long") {
      return alternative
        ? `Your book is too long for a ${bindingNoun(product.binding)} — switch to a ${alternative.label} below.`
        : `Your book is too long for a ${bindingNoun(product.binding)}.`;
    }
    if (copies > maxCopies) {
      return `You can order up to ${maxCopies} copies at a time.`;
    }
    return null;
  }, [
    incompleteUnits,
    pagePlan.status,
    copies,
    maxCopies,
    product.binding,
    alternative,
  ]);

  // Checked as typed but only SHOWN once the field is left (or a saved address
  // filled it), so nobody is told their number is too short while typing it.
  const phoneError = phone.trim() ? phoneProblem(phone) : null;
  const taxIdError = taxIdRequired ? taxIdProblem(destination, taxId) : null;
  const phoneShown = formatTouched.phone || Boolean(selectedAddressId);
  const taxIdShown = formatTouched.taxId;
  const formatError = phoneError ? "Check the phone number." : taxIdError ? `Check the ${taxIdLabel}.` : null;

  const addressComplete = Boolean(
    name.trim() &&
      phone.trim() &&
      !formatError &&
      line1.trim() &&
      city.trim() &&
      postal.trim() &&
      country &&
      (!regionRequired || region.trim()) &&
      (!taxIdRequired || taxId.trim()) &&
      copies >= 1,
  );
  // What prints is the saved book: a picture that is still being drawn would print as it was.
  const drawing = useBookBusy(project);
  const canOrder =
    !drawing.busy &&
    marketsLoaded &&
    countryOptions.some((option) => option.value === country) &&
    shippingChoices.some((option) => option.value === shipping) &&
    quote != null &&
    quoteIsCurrent &&
    !quoting &&
    !quoteError &&
    addressComplete &&
    !unserviced &&
    !regionUnrecognised &&
    !requirementError &&
    !addressNeedsReview;

  const checkoutBlockReason = drawing.busy
    ? busyReason(drawing)
    : !accessGate.ok
    ? "This binding requires an eligible membership."
    : requirementError
      ? requirementError
      : !marketsLoaded
        ? "Loading available destinations…"
        : unserviced
          ? `Choose a destination we currently ship to.`
          : regionUnrecognised
            ? "Choose a recognized state or province."
            : formatError
              ? formatError
              : !addressComplete
              ? "Complete the required delivery address fields."
              : shippingChoices.length === 0
                ? "Choose a destination with an available delivery method."
                : addressUnverifiable
                  ? "Correct the delivery address before continuing."
                  : addressNeedsReview
                    ? "Review the carrier's address suggestion."
                    : quoting
                      ? "Updating the delivery total…"
                      : quoteError
                        ? quoteError
                        : !quote
                          ? "Add the city and postal code to calculate the total."
                          : null;

  // What the customer will actually be asked to pay, before tax. The code's
  // discount is only trusted while the code is; the server re-prices at payment.
  const discount = couponCode && quote ? Math.min(couponDiscount, quote.total) : 0;
  const totalDue = quote ? Math.max(0, quote.total - discount) : 0;
  const locale = typeof navigator === "undefined" ? "en" : navigator.language;
  const cover = pages.find((p) => p.id === COVER_FRONT_ID) ?? pages[0];

  // Preflight items the app can repair itself: layout-owned or reader-placed text
  // sitting outside the safe area. A gutter-crossing line or a page with no art
  // can't be fixed by nudging, so those stay as information.
  const unsafeFixable = useMemo(
    () =>
      preflight
        .filter((issue) => issue.code === "text-outside-safe-area")
        .map((issue) => issue.pageId)
        .filter((id) => {
          const page = pages.find((p) => p.id === id);
          const stored = design.pages[id];
          return Boolean(page && stored && insetPageText(page, stored, true) !== stored);
        }),
    [preflight, pages, design],
  );

  function moveTextInward() {
    // Read from the live project, not this render's snapshot: an edit saved a
    // moment ago must not be overwritten by the older design held here.
    void useProjectsStore.getState().patchCurrent((live) => {
      if (live.id !== project.id || !live.design) return live;
      const nextPages = { ...live.design.pages };
      let changed = false;
      for (const id of unsafeFixable) {
        const page = pages.find((p) => p.id === id);
        const stored = nextPages[id];
        if (!page || !stored) continue;
        const fixed = insetPageText(page, stored, true);
        if (fixed !== stored) {
          nextPages[id] = fixed;
          changed = true;
        }
      }
      return changed ? { ...live, design: { ...live.design, pages: nextPages } } : live;
    });
  }

  // Put a spare page to use. Only end-of-book templates are offered here: a page
  // at the front would swap which margin of every later page is the binding side.
  // It goes in through the project store, like "Move text inward" above, rather
  // than the editor's undo stack, which isn't open at checkout.
  function useSparePage(template: PageTemplate) {
    void useProjectsStore.getState().patchCurrent((live) => {
      if (live.id !== project.id || !live.screenplay) return live;
      const end = getCursor(live.screenplay).content.spreads.length;
      return insertSpreadProject(live, end, { text: template.text }).project;
    });
  }

  function leave() {
    runRef.current += 1;
    setPhase("form");
    setCoverDims(null);
    onBack();
  }

  async function beginRender() {
    if (requirementError) {
      notify.error(requirementError);
      return;
    }
    if (!accessGate.ok) {
      notify.error("This product is only available with a subscription. Upgrade your plan to order it.");
      return;
    }
    if (addressUnverifiable) {
      notify.error("This shipping address couldn't be verified. Please check and correct it.");
      return;
    }
    if (addressNeedsReview) {
      notify.error("The delivery carrier suggested an address correction — pick one before paying.");
      return;
    }
    if (!canOrder) {
      notify.error(checkoutBlockReason ?? "Review the order details before continuing.");
      return;
    }
    const run = ++runRef.current;
    const live = () => runRef.current === run;
    try {
      setPhase("rendering");
      setProgress(null);
      setStatus("Calculating cover size…");
      const dims = await provider.getCoverDimensionsMm(printSku, pageCount);
      if (!live()) return;
      setCoverDims(dims);

      // A book that hasn't changed since it was last ordered is already
      // rendered and assembled on the server — the cover included, as long as
      // the binding and page count still match the spine it was cut for.
      // The server renders the SAVED book, so the last edit has to be on disk
      // before it looks — otherwise it prints the version before this one.
      setStatus("Checking your book…");
      await flushProjectSaves();
      if (!live()) return;
      const availability = await fetchRenderAvailability(fingerprint);
      if (!live()) return;
      const cached =
        availability.interior &&
        // The interior is padded to a binding's length, so one assembled for a
        // different binding is the wrong file even when the cover matches.
        availability.interiorPageCount === pageCount &&
        availability.covers.includes(coverDocumentKey(printSku, pageCount));
      if (!cached) {
        // The panels are the book's own trim plus its outer bleed; the spine is
        // whatever the provider's cover width leaves between them. Same split
        // the renderer draws to, so the artwork lands where the fold is cut.
        const { panelWidthIn, flapWidthIn } = buildCoverPlan(project, pages, undefined, {
          coverHeightIn: dims.heightMm / MM_PER_IN,
        });
        await renderBook({
          fingerprint,
          projectId: project.id,
          documents: [
            { kind: "interior", padToPages: pageCount },
            {
              kind: "cover",
              sku: printSku,
              padToPages: pageCount,
              cover: {
                widthIn: dims.widthMm / MM_PER_IN,
                heightIn: dims.heightMm / MM_PER_IN,
                panelWidthIn,
                ...(flapWidthIn > 0 ? { flapWidthIn } : {}),
              },
            },
          ],
          onProgress: (step, done, total) => {
            if (!live()) return;
            setStatus(step);
            setProgress(total && total > 0 ? { done: Math.min(done ?? 0, total), total } : null);
          },
          isCancelled: () => !live(),
        });
      }
      if (!live()) return;
      await placeOrder(run);
    } catch (err) {
      // They left; an error about a screen they've closed is just noise.
      if (!live()) return;
      setPhase("form");
      setCoverDims(null);
      notify.error(err);
    }
  }

  async function placeOrder(run: number) {
    try {
      setPhase("submitting");
      setStatus("Redirecting to secure checkout…");
      const draft = buildOrderDraft({
        product,
        copies,
        recipient: recipient(),
        shippingMethod: shipping,
        // No blobs: the print files were assembled server-side and are found
        // by fingerprint.
        pageCount,
        destinationCountry: country,
        currency,
        merchantReference: project.id,
      });
      // Remember this address for faster reordering (deduped; first one becomes
      // the default). Best-effort — done before the redirect so it isn't lost.
      if (saveForNextTime) {
        void upsertAddress({
          id: selectedAddressId || correctedFromId || undefined,
          label: city.trim() || name.trim() || "Address",
          recipientName: name.trim(),
          phone: phone.trim(),
          email: contactEmail.trim(),
          line1: line1.trim(),
          line2: line2.trim(),
          city: city.trim(),
          region: region.trim(),
          postal: postal.trim(),
          country,
        });
      }
      // Payment-gated: the backend prices the order, uploads the print files,
      // and opens a Stripe Checkout Session. The print order is placed only
      // AFTER Stripe confirms payment (via webhook). Redirect to Stripe.
      // Send the SAME (normalized) page count the price preview used so the
      // charge matches what the customer was quoted.
      const { url } = await startOrderCheckout({
        draft,
        pageCount,
        variant,
        fingerprint,
        addressConfirmed:
          !validation?.suggested || addressChoiceForSuggestion !== "unreviewed",
        addressChoice: recordedAddressChoice,
        couponCode: couponCode ?? undefined,
        foilStamp: foilStamp ?? undefined,
      });
      if (runRef.current !== run) return;
      window.location.href = url;
    } catch (err) {
      if (runRef.current !== run) return;
      setPhase("form");
      setCoverDims(null);
      notify.error(err);
    }
  }

  const busy = phase === "rendering" || phase === "submitting";
  const checkoutCtaLabel =
    phase === "rendering"
      ? "Preparing your book…"
      : phase === "submitting"
        ? "Opening secure payment…"
        : addressUnverifiable
          ? "Check your address"
          : addressNeedsReview
            ? "Confirm your address"
            : "Continue to secure payment";
  const bindingLabel = bindingNoun(product.binding);
  const quoteCurrency = quote?.currency || currency;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-28 pt-6 sm:px-6 lg:py-8">
      <header className="flex items-start gap-4">
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<ArrowLeft className="size-4" />}
          onClick={leave}
          disabled={phase === "submitting"}
          className="mt-0.5 shrink-0"
        >
          Back
        </Button>
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">
            Order your printed book
          </h1>
          <p className="mt-1 text-sm leading-relaxed text-ink-500">
            Choose your book, tell us where to send it, then pay securely.
          </p>
        </div>
      </header>

      {drawing.busy && (
        <div
          role="status"
          aria-live="polite"
          className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm text-amber-800"
        >
          <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin motion-reduce:animate-none" />
          <span>{busyReason(drawing)} Ordering is on hold so the book prints as you see it.</span>
        </div>
      )}

      <div className="fixed inset-x-4 bottom-4 z-30 rounded-2xl border border-ink-200 bg-white/95 p-2.5 shadow-lifted backdrop-blur lg:hidden">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1 pl-1">
            <p className="text-[11px] font-medium text-ink-500">{totalLabel(quote)}</p>
            <p className="truncate text-sm font-bold text-ink-900">
              {quote && quoteIsCurrent && !drawing.busy
                ? money(String(totalDue), quoteCurrency)
                : checkoutBlockReason}
            </p>
          </div>
          <Button
            onClick={() => void beginRender()}
            loading={busy}
            disabled={busy || !canOrder || !accessGate.ok}
          >
            {checkoutCtaLabel}
          </Button>
        </div>
      </div>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <CardBody className="p-5 sm:p-6">
            {/* Everything the customer can change, locked as one while the print
                files are being prepared. Editing mid-render used to leave the
                order being placed out of step with the form on screen: the
                payment step runs from the values the render started with. */}
            <fieldset disabled={busy} className="m-0 min-w-0 border-0 p-0">
              <legend className="sr-only">Order details</legend>

              {/* ---- 1 · Your book ------------------------------------------- */}
              <section className="space-y-5" aria-labelledby="order-book-heading">
                <SectionHeading
                  id="order-book-heading"
                  n={1}
                  title="Your book"
                  hint="How it's bound, how the cover feels, and how many you need."
                />

                {/* Subscription gate — this product is restricted to certain plans. */}
                {!accessGate.ok && (
                  <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm text-amber-800">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0" />
                    <span>
                      {accessGate.mode === "subscribersOnly"
                        ? "This printed product is available with any paid subscription. Upgrade your plan to order it."
                        : "This printed product is available on select subscription plans. Upgrade your plan to order it."}
                    </span>
                  </div>
                )}

                {/* Format requirement gate — the book doesn't fit this product yet.
                    (Too-long is explained by the binding notice below, with its fix.) */}
                {requirementError && pagePlan.status !== "too-long" && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm text-rose-700"
                  >
                    <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                    <span>{requirementError}</span>
                  </div>
                )}

                {/* WHAT to make, before WHERE to send it. None of it touches the
                    designed pages — that's why these are asked here and not back
                    in the design flow. */}
                <FormatPicker
                  formats={formats}
                  catalog={offerableCatalog}
                  value={product.sku}
                  onChange={(sku) => void updateConfig({ productSku: sku })}
                  contentPages={contentPages}
                  currency={currency}
                  locale={locale}
                />

                {/* Whenever blank pages get added: a quiet note for a page or two,
                    a warning when it's mostly padding or too long. */}
                <PageCountNotice
                  plan={pagePlan}
                  binding={bindingLabel}
                  alternative={alternative}
                  onSwitch={(sku) => void updateConfig({ productSku: sku })}
                  spareTemplates={BACK_PAGE_TEMPLATES}
                  onUseSpare={useSparePage}
                  onEditInStudio={leave}
                />

                <VariantPicker
                  policy={variantPolicy}
                  value={variant}
                  onChange={chooseVariant}
                  currency={currency}
                  locale={locale}
                  pages={pageCount}
                  visibleAxes={CUSTOMER_VARIANT_AXES}
                />

                {variant.foil !== NO_OPTION && (
                  <SpineStampFields
                    value={spineLines}
                    defaults={spineDefaults}
                    foilLabel={variantOptionLabel("foil", variant.foil)}
                    onChange={(next) =>
                      setSpineEdit(
                        next.title === spineDefaults.title && next.author === spineDefaults.author ? null : next,
                      )
                    }
                  />
                )}

                <div>
                  <p className="text-[12px] font-semibold text-ink-800" id="copies-label">
                    Copies
                  </p>
                  <div
                    role="group"
                    aria-labelledby="copies-label"
                    className="mt-2 inline-flex items-center rounded-xl2 bg-white ring-1 ring-inset ring-ink-200"
                  >
                    <button
                      type="button"
                      aria-label="One fewer copy"
                      disabled={copies <= 1}
                      onClick={() => setCopies((c) => Math.max(1, c - 1))}
                      className="flex size-10 items-center justify-center rounded-l-xl2 text-ink-600 transition hover:bg-ink-50 disabled:opacity-30"
                    >
                      <Minus className="size-4" />
                    </button>
                    <output
                      aria-live="polite"
                      className="w-10 text-center text-sm font-semibold tabular-nums text-ink-900"
                    >
                      {copies}
                    </output>
                    <button
                      type="button"
                      aria-label="One more copy"
                      disabled={copies >= maxCopies}
                      onClick={() => setCopies((c) => Math.min(c + 1, maxCopies))}
                      className="flex size-10 items-center justify-center rounded-r-xl2 text-ink-600 transition hover:bg-ink-50 disabled:opacity-30"
                    >
                      <Plus className="size-4" />
                    </button>
                  </div>
                  {Number.isFinite(maxCopies) && (
                    <p className="mt-1.5 text-[11px] text-ink-500">Up to {maxCopies} at a time.</p>
                  )}
                </div>

                {/* Print preflight — things that print "correctly" and still come
                    out wrong: text the trim will clip, a line that disappears
                    into the fold, a page with no artwork. Collapsed, because it is
                    advice rather than a step; shown here because this is the last
                    moment before it costs money to be wrong. */}
                {preflight.length > 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 text-sm text-amber-800">
                    <button
                      type="button"
                      onClick={() => setCheckOpen((o) => !o)}
                      aria-expanded={checkOpen}
                      className="flex w-full items-center gap-2 px-3.5 py-3 text-left font-medium"
                    >
                      <TriangleAlert className="size-4 shrink-0" />
                      <span className="flex-1">
                        {preflight.length === 1
                          ? "1 thing worth a look before you print"
                          : `${preflight.length} things worth a look before you print`}
                      </span>
                      <ChevronDown
                        className={cn("size-4 shrink-0 transition", checkOpen && "rotate-180")}
                      />
                    </button>
                    {checkOpen && (
                      <div className="space-y-2.5 border-t border-amber-200 px-3.5 pb-3 pt-2.5">
                        <ul className="space-y-1 pl-5 text-xs leading-relaxed">
                          {preflight.slice(0, 6).map((issue) => (
                            <li key={`${issue.code}:${issue.pageId}`} className="list-disc">
                              {issue.message}
                            </li>
                          ))}
                        </ul>
                        {preflight.length > 6 && (
                          <p className="pl-5 text-xs">…and {preflight.length - 6} more.</p>
                        )}
                        {unsafeFixable.length > 0 && (
                          <Button size="sm" variant="secondary" onClick={moveTextInward}>
                            Move text inward
                          </Button>
                        )}
                        <p className="text-xs">
                          You can order anyway — these are judgment calls, not errors.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </section>

              {/* ---- 2 · Delivery -------------------------------------------- */}
              <section
                className="mt-8 space-y-5 border-t border-ink-100 pt-8"
                aria-labelledby="order-delivery-heading"
              >
                <SectionHeading
                  id="order-delivery-heading"
                  n={2}
                  title="Delivery"
                  hint="Where to send it, and how fast."
                />

                {/* Saved address picker — lets returning customers reuse an address. */}
                {addressesLoading && savedAddresses.length === 0 ? (
                  <div className="flex items-center gap-2 text-xs text-ink-400">
                    <Loader2 className="size-3.5 animate-spin" /> Loading saved addresses…
                  </div>
                ) : savedAddresses.length > 0 ? (
                  <Field label="Use a saved address">
                    <Select
                      options={[
                        { value: "", label: "New address…" },
                        ...savedAddresses.map((a) => ({ value: a.id, label: addressSummary(a) })),
                      ]}
                      value={selectedAddressId}
                      onChange={(e) => {
                        const a = savedAddresses.find((x) => x.id === e.target.value);
                        if (a) applyAddress(a);
                        else {
                          setSelectedAddressId("");
                          setCorrectedFromId("");
                        }
                      }}
                    />
                  </Field>
                ) : null}

                {/* Recipient — wrapped in a form with autocomplete tokens so the
                    browser can offer to autofill the whole shipping block at once.
                    Country comes first: it decides which fields, which delivery
                    speeds and which currency everything below applies to. */}
                <form
                  className="grid grid-cols-1 gap-3 sm:grid-cols-2"
                  onSubmit={(e) => e.preventDefault()}
                >
                  <Field
                    label="Country"
                    required
                    className="sm:col-span-2"
                    error={
                      unserviced
                        ? `We're sorry — we don't currently ship to ${countryLabel(country)}. Choose another destination to continue.`
                        : undefined
                    }
                  >
                    <Select
                      options={countrySelectOptions}
                      value={country}
                      onChange={(e) => {
                        editAddr(setCountry, e.target.value);
                        // A state or province belongs to the country it was typed
                        // for. Carried over, "CA" (California) would ride along to a
                        // German order as a state code, now that the field is
                        // hidden there and nobody would see it.
                        if (e.target.value !== country) {
                          setRegion("");
                          setShowOptionalRegion(false);
                        }
                        // Correcting the destination here is the strongest signal we
                        // get about where this person ships, so it replaces the guess
                        // for the rest of the session and the next visit — including
                        // the format picker back in the design flow, which would
                        // otherwise go on offering a binding checkout just refused.
                        rememberCountry(e.target.value);
                      }}
                      autoComplete="shipping country"
                    />
                  </Field>
                  <Field label="Recipient name" required className="sm:col-span-2">
                    <Input
                      value={name}
                      onChange={(e) => editAddr(setName, e.target.value)}
                      placeholder="Jane Doe"
                      autoComplete="shipping name"
                    />
                  </Field>
                  <Field label="Address" required className="sm:col-span-2">
                    <Input
                      value={line1}
                      onChange={(e) => editAddr(setLine1, e.target.value)}
                      placeholder="Street address"
                      autoComplete="shipping address-line1"
                    />
                  </Field>
                  {showLine2 || line2.trim() ? (
                    <Field label="Apartment, suite, etc." className="sm:col-span-2">
                      <Input
                        value={line2}
                        onChange={(e) => editAddr(setLine2, e.target.value)}
                        autoComplete="shipping address-line2"
                      />
                    </Field>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowLine2(true)}
                      className="-mt-1 justify-self-start text-xs font-medium text-ink-500 underline decoration-ink-300 underline-offset-2 transition hover:text-ink-700 sm:col-span-2"
                    >
                      Add apartment, suite, etc.
                    </button>
                  )}
                  <Field label="City" required>
                    <Input
                      value={city}
                      onChange={(e) => editAddr(setCity, e.target.value)}
                      autoComplete="shipping address-level2"
                    />
                  </Field>
                  {showRegion && (
                    <Field
                      label="State / Province"
                      required={regionRequired}
                      error={regionUnrecognised ? "Please pick this from the list." : undefined}
                      hint={
                        regionOptions.length > 0
                          ? undefined
                          : regionRequired
                            ? `The carrier won't deliver here without the official code (e.g. ${PROBE_STATE[destination] ?? "AB"}), not the full name.`
                            : undefined
                      }
                    >
                      {/* A picker wherever the codes have been verified, because the
                          carrier wants "CA", not "California", and rejects the address
                          outright otherwise — after payment, in the countries that also
                          need a tax id. Elsewhere it stays a text field with an example
                          rather than a guessed-at list the customer couldn't override. */}
                      {regionOptions.length > 0 ? (
                        <Select
                          options={regionOptions}
                          value={region}
                          onChange={(e) => editAddr(setRegion, e.target.value)}
                          autoComplete="shipping address-level1"
                        />
                      ) : (
                        <Input
                          value={region}
                          onChange={(e) => editAddr(setRegion, e.target.value)}
                          autoComplete="shipping address-level1"
                        />
                      )}
                    </Field>
                  )}
                  <Field label="Postal / ZIP" required>
                    <Input
                      value={postal}
                      onChange={(e) => editAddr(setPostal, e.target.value)}
                      autoComplete="shipping postal-code"
                    />
                  </Field>
                  {!showRegion && (
                    <button
                      type="button"
                      onClick={() => setShowOptionalRegion(true)}
                      className="-mt-1 justify-self-start text-xs font-medium text-ink-500 underline decoration-ink-300 underline-offset-2 transition hover:text-ink-700 sm:col-span-2"
                    >
                      Add state / region (optional)
                    </button>
                  )}
                  <Field
                    label="Phone"
                    required
                    htmlFor="order-phone"
                    hint="For the carrier, if there's a delivery problem."
                    error={phoneShown ? (phoneError ?? undefined) : undefined}
                  >
                    <Input
                      id="order-phone"
                      type="tel"
                      value={phone}
                      onChange={(e) => editAddr(setPhone, e.target.value)}
                      onBlur={() => setFormatTouched((t) => ({ ...t, phone: true }))}
                      aria-invalid={phoneShown && phoneError ? true : undefined}
                      aria-describedby={fieldMessageId("order-phone")}
                      autoComplete="shipping tel"
                    />
                  </Field>
                  <Field label="Email" className="sm:col-span-2" hint="For shipping updates.">
                    <Input
                      type="email"
                      value={contactEmail}
                      onChange={(e) => editAddr(setContactEmail, e.target.value)}
                      autoComplete="email"
                    />
                  </Field>
                  {/* Only rendered where customs actually demands it — three countries
                      today. Showing it everywhere would ask every customer for a
                      government id to buy a picture book. */}
                  {taxIdRequired && (
                    <Field
                      label={`Recipient ${taxIdLabel}`}
                      required
                      htmlFor="order-tax-id"
                      className="sm:col-span-2"
                      hint="Customs in this country requires the recipient's tax number before a parcel can clear."
                      error={taxIdShown ? (taxIdError ?? undefined) : undefined}
                    >
                      <Input
                        id="order-tax-id"
                        value={taxId}
                        onChange={(e) => editAddr(setTaxId, e.target.value)}
                        onBlur={() => setFormatTouched((t) => ({ ...t, taxId: true }))}
                        aria-invalid={taxIdShown && taxIdError ? true : undefined}
                        aria-describedby={fieldMessageId("order-tax-id")}
                      />
                    </Field>
                  )}
                </form>

                {/* The carrier's verdict on the address, from the live quote. Asked
                    here — while it's still free — because a mismatch discovered
                    after payment parks the print job awaiting manual confirmation. */}
                {validation && (
                  <AddressSuggestion
                    validation={validation}
                    entered={enteredAddress}
                    choice={addressChoiceForSuggestion}
                    onUseSuggested={applyAddressChoice}
                    onKeepEntered={keepEnteredAddress}
                  />
                )}

                {/* Right after taking the carrier's version the old verdict no longer
                    applies (it was about the previous address) and the new one is
                    still on its way. Say so, rather than letting the card vanish. */}
                {!validation && decision?.choice === "suggested" && decision.afterSig === addressSig && (
                  <p
                    role="status"
                    className="flex items-center gap-1.5 rounded-xl border border-ink-200 bg-white px-3.5 py-2.5 text-xs text-ink-600"
                  >
                    <MapPin className="size-3.5 shrink-0 text-brand-600" />
                    {quoteIsCurrent
                      ? "Using the carrier's corrected address."
                      : "Using the carrier's corrected address — checking it…"}
                  </p>
                )}

                {/* Save this address for faster reordering next time. */}
                <label className="flex items-center gap-2 text-sm text-ink-600">
                  <input
                    type="checkbox"
                    checked={saveForNextTime}
                    onChange={(e) => setSaveForNextTime(e.target.checked)}
                    className="size-4 rounded border-ink-300 text-brand-600 focus:ring-brand-400"
                  />
                  Save this address for next time
                </label>

                {/* Delivery speed. Cards rather than a dropdown because the choice
                    is between a time and a price, and neither fits in an option
                    label — a customer picking blind between five names is how "why
                    is this taking three weeks" happens. */}
                <Field label="Delivery speed" required>
                  {shippingChoices.length === 0 ? (
                    <p className="text-xs text-ink-400">
                      {!marketsLoaded
                        ? "Loading available destinations…"
                        : countryOptions.length === 0
                          ? "Print ordering is not available in any destination right now."
                          : unserviced || !country
                            ? "Choose a destination to see delivery options."
                            : "No delivery options are currently available for this destination."}
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {shippingChoices.map((option) => (
                        <label
                          key={option.value}
                          className={cn(
                            "flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition",
                            shipping === option.value
                              ? "border-brand-400 bg-brand-50/60"
                              : "border-ink-100 hover:border-ink-200",
                          )}
                        >
                          <input
                            type="radio"
                            name="shipping-method"
                            checked={shipping === option.value}
                            onChange={() => setShipping(option.value)}
                            className="size-4 shrink-0 border-ink-300 text-brand-600 focus:ring-brand-400"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-ink-800">{option.label}</span>
                            <span className="block text-xs text-ink-400">
                              {option.transit ?? "Delivery time confirmed at checkout"}
                            </span>
                          </span>
                          <span className="shrink-0 text-sm font-medium text-ink-700">
                            {option.price == null
                              ? "—"
                              : option.price === 0
                                ? "Free"
                                : money(String(option.price), currency)}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </Field>
              </section>
            </fieldset>
          </CardBody>
        </Card>

        <aside className="lg:sticky lg:top-4">
          <Card>
            <CardHeader>
              <CardTitle>Order summary</CardTitle>
            </CardHeader>
            <CardBody className="space-y-5">
              <div className="flex items-start gap-4">
                <div className="flex shrink-0 items-center justify-center rounded-xl bg-ink-50 p-3">
                  <BookMockup
                    blobId={cover?.blobId}
                    title={project.title}
                    pageDesign={design.pages[COVER_FRONT_ID]}
                    aspect={cover?.aspect ?? product.trim.widthIn / product.trim.heightIn}
                    width={64}
                    variant="flat"
                  />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink-900">
                    {project.title || "Your storybook"}
                  </p>
                  <p className="mt-0.5 text-xs capitalize leading-relaxed text-ink-500">
                    {bindingLabel} · {variantOptionLabel("finish", variant.finish)}{" "}
                    {variant.linen !== NO_OPTION ? "jacket" : "cover"}
                    {variant.linen !== NO_OPTION &&
                      ` · ${variantOptionLabel("linen", variant.linen)} linen · ${variantOptionLabel("foil", variant.foil)} foil`}
                  </p>
                  {variant.foil !== NO_OPTION && (
                    <p className="text-xs leading-relaxed text-ink-500">
                      {foilStamp
                        ? `Spine stamped: “${[foilStamp.title, foilStamp.author].filter(Boolean).join(" · ")}”`
                        : "Plain spine — nothing stamped."}
                    </p>
                  )}
                  <p className="text-xs leading-relaxed text-ink-500">
                    {product.trim.widthIn}×{product.trim.heightIn}″ · {pageCount} printed pages
                  </p>
                </div>
              </div>

              <div className="border-t border-ink-100 pt-4 text-sm">
                {quoting ? (
                  <div role="status" className="flex items-center gap-2 text-ink-500">
                    <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> Updating price…
                  </div>
                ) : quote ? (
                  <div aria-live="polite">
                    <QuoteLines quote={quote} discount={discount} total={totalDue} />
                  </div>
                ) : quoteError ? (
                  <div role="alert" className="space-y-2">
                    <p className="leading-relaxed text-rose-600">{quoteError}</p>
                    <Button size="sm" variant="secondary" onClick={() => setQuoteRetry((n) => n + 1)}>
                      Try again
                    </Button>
                  </div>
                ) : (
                  <p className="leading-relaxed text-ink-500">
                    Complete the delivery address to see the total.
                  </p>
                )}
                {/* Only once there's a total: a code is validated against the
                    order value, so offering the box before the price is known
                    would be checking it against nothing. Locked while preparing,
                    for the same reason as the form. */}
                {quote && (
                  <fieldset disabled={busy} className="m-0 mt-3 min-w-0 border-0 p-0">
                    <CouponField
                      itemType="print"
                      subtotal={quote.items}
                      orderTotal={quote.total}
                      atCostTotal={quote.atCostTotal}
                      currency={quoteCurrency}
                      productId={offerableCatalog.get(product.sku)?.id}
                      country={country}
                      onChange={setCouponCode}
                      onDiscount={setCouponDiscount}
                    />
                  </fieldset>
                )}
                {/* What else this order earns — shown before the button, because
                    a reward discovered in a receipt changed nobody's mind. */}
                {quote && quoteIsCurrent && (
                  <OfferPreviewNote
                    className="mt-3"
                    itemType="print"
                    amount={quoteCurrency === pricingSettings.baseCurrency ? totalDue : undefined}
                    productId={offerableCatalog.get(product.sku)?.id}
                    projectId={project.id}
                  />
                )}
              </div>

              {busy && (
                <div
                  role="status"
                  aria-live="polite"
                  className="rounded-xl bg-brand-50 px-3 py-2.5 text-sm text-brand-700"
                >
                  <div className="flex items-center gap-2">
                    <Loader2 className="size-4 shrink-0 animate-spin motion-reduce:animate-none" />
                    <span className="min-w-0 truncate" title={status}>
                      {status}
                    </span>
                  </div>
                  {phase === "rendering" && (
                    <>
                      {progress && (
                        <div
                          role="progressbar"
                          aria-valuemin={0}
                          aria-valuemax={progress.total}
                          aria-valuenow={progress.done}
                          className="mt-2 h-1.5 overflow-hidden rounded-full bg-brand-100"
                        >
                          <div
                            className="h-full rounded-full bg-brand-500 transition-[width] duration-500"
                            style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
                          />
                        </div>
                      )}
                      <p className="mt-2 text-xs leading-relaxed text-brand-700/80">
                        Preparing your print files takes about a minute. Please keep this tab open —
                        you&apos;ll go straight to payment when it&apos;s done.
                      </p>
                    </>
                  )}
                </div>
              )}

              <Button
                size="lg"
                className="w-full"
                onClick={() => void beginRender()}
                loading={busy}
                disabled={busy || !canOrder || !accessGate.ok}
              >
                {checkoutCtaLabel}
              </Button>

              {!busy && checkoutBlockReason && (
                <p className="-mt-2 text-center text-xs leading-relaxed text-ink-500">
                  {checkoutBlockReason}
                </p>
              )}

              {onChooseEbook && !busy && (
                <button
                  type="button"
                  onClick={onChooseEbook}
                  className="-mt-2 block w-full text-center text-xs font-medium text-ink-500 underline decoration-ink-300 underline-offset-2 transition hover:text-ink-700"
                >
                  Prefer a digital copy? Get the ebook instead
                </button>
              )}

              <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-400">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
                Stripe securely handles payment and shows tax before you pay. Your book goes to
                print only after payment succeeds.
              </p>
            </CardBody>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function SectionHeading({
  id,
  n,
  title,
  hint,
}: {
  id: string;
  n: number;
  title: string;
  hint: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span
        aria-hidden
        className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-ink-900 text-xs font-semibold text-white"
      >
        {n}
      </span>
      <div>
        <h2 id={id} className="font-display text-lg font-semibold leading-7 text-ink-900">
          {title}
        </h2>
        <p className="text-xs leading-relaxed text-ink-500">{hint}</p>
      </div>
    </div>
  );
}

/**
 * "5–8 business days", or null when the provider didn't say.
 *
 * Null rather than a guess. The figure includes production, varies by country,
 * and is the one part of this screen a customer will hold us to — inventing it
 * from the tier's name is how "Express" comes to mean whatever they hoped.
 */
function transitLabel(min: number | undefined, max: number | undefined): string | null {
  if (min == null && max == null) return null;
  const low = min ?? max;
  const high = max ?? min;
  if (low == null || high == null) return null;
  const range = low === high ? `${low}` : `${low}–${high}`;
  return `${range} business day${high === 1 ? "" : "s"}`;
}

function money(amount: string, currency: string): string {
  const n = Number(amount);
  if (Number.isNaN(n)) return `${amount} ${currency}`;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

function QuoteLines({
  quote,
  discount,
  total,
}: {
  quote: RetailPricePreview;
  /** What an accepted coupon takes off, 0 when none. */
  discount: number;
  /** The total after that discount. */
  total: number;
}) {
  const currency = quote.currency || "USD";
  const hasDiscount = quote.discountPct > 0 && quote.listUnitPrice > quote.unitPrice;
  return (
    <div className="space-y-1 text-ink-700">
      <Row
        label={`Books (${quote.copies} × ${money(String(quote.unitPrice), currency)})`}
        value={money(String(quote.items), currency)}
      />
      {hasDiscount && (
        <p className="text-xs text-emerald-600">
          Your plan saves you {quote.discountPct}% (was {money(String(quote.listUnitPrice), currency)}{" "}
          per copy).
        </p>
      )}
      {discount > 0 && (
        <div className="flex items-center justify-between text-emerald-700">
          <span>Discount code</span>
          <span>−{money(String(discount), currency)}</span>
        </div>
      )}
      <Row label="Shipping" value={money(String(quote.shipping), currency)} />
      <div className="my-1 h-px bg-ink-100" />
      <Row label={totalLabel(quote)} value={money(String(total), currency)} bold />
      {quote.taxBehavior !== "inclusive" && (
        <p className="text-[11px] text-ink-400">Any sales tax is added at payment.</p>
      )}
    </div>
  );
}

function totalLabel(quote: RetailPricePreview | null): string {
  return quote?.taxBehavior === "inclusive" ? "Estimated total (incl. tax)" : "Estimated total (before tax)";
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={bold ? "font-semibold text-ink-800" : "text-ink-600"}>{label}</span>
      <span className={bold ? "font-semibold text-ink-900" : "text-ink-700"}>{value}</span>
    </div>
  );
}
