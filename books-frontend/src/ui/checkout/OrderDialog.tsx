"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Package, ShieldCheck, TriangleAlert, Truck } from "lucide-react";
import { bookProductForConfig } from "../../core/book";
import { findPublicPlanByPriceId } from "../../core/config/plans";
import {
  SUPPORTED_MARKETS,
  findPublicProductForSku,
  planMeetsAccess,
  productAccessOf,
} from "../../core/config/products";
import { allowedMarketsFor } from "../../core/config/productMath";
import { countryLabel } from "../../core/analytics/markets";
import {
  createDefaultVariantPolicy,
  firstAllowedVariant,
  normalizeVariantPolicy,
  variantAllowed,
  type VariantSelection,
} from "../../core/config/variants";
import { buildOrderDraft } from "../../core/fulfillment/draft";
import { bindingNoun, normalizePageCount } from "../../core/fulfillment";
import { FulfillmentError } from "../../core/fulfillment/errors";
import type {
  Recipient,
  ShippingMethod,
} from "../../core/fulfillment/types";
import { BASE_VARIANT } from "../../core/fulfillment/lulu/products";
import { skuForVariant, variantFromSku } from "../../core/fulfillment/lulu/skuAxes";
import type { BookDesign, Project } from "../../core/types";
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
import { useProjectsStore } from "../../state/projectsStore";
import { useAppConfigStore } from "../../state/appConfigStore";
import { useSubscriptionStore } from "../../state/subscriptionStore";
import { useFormatsForConfigSize } from "../hooks/useOfferableFormats";
import { PlanUpsell } from "../billing/PlanUpsell";
import { Button } from "../components/Button";
import { Field, Input } from "../components/Input";
import { Modal } from "../components/Modal";
import { Select } from "../components/Select";
import { notify } from "../lib/notify";
import type { DesignPage } from "../design/designInit";
import { OrderAssetRunner, type OrderAssets } from "./orderAssets";
import { FormatPicker } from "./FormatPicker";
import { VariantPicker } from "./VariantPicker";
import {
  AddressSuggestion,
  suggestionKey,
  type AddressChoice,
  type EnteredAddress,
} from "./AddressSuggestion";

type Phase = "form" | "rendering" | "submitting";

/**
 * Fallback country list, used only before the catalog has loaded.
 *
 * There is deliberately no hand-maintained list here any more. This one offered
 * France, Spain, Italy and the Netherlands — markets nobody had measured or
 * priced — so a customer could pick a destination the server would then refuse.
 * The real options come from the product's own geo policy.
 */
const FALLBACK_COUNTRIES: { value: string; label: string }[] = SUPPORTED_MARKETS.map((value) => ({
  value,
  label: countryLabel(value),
}));

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

const CURRENCY = "USD";

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

export function OrderDialog({
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
  const provider = useMemo(() => createFulfillment(), []);
  const email = useAuthStore((s) => s.user?.email ?? "");

  // The book's SIZE is fixed by the design (every illustration was generated at
  // its aspect). The BINDING isn't: the formats below all print the same pages at
  // the same trim, so it's chosen here, where the final page count — the thing
  // that decides which bindings can even take this book — is known.
  const { formats, offerable: offerableCatalog } = useFormatsForConfigSize(project.config);
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
      firstAllowedVariant(
        variantPolicy,
        catalogProduct?.defaultVariant ?? variantFromSku(product.sku) ?? BASE_VARIANT,
      ) ?? BASE_VARIANT,
    [variantPolicy, catalogProduct, product.sku],
  );
  const [variant, setVariant] = useState<VariantSelection>(defaultVariant);
  // Changing the binding changes which print/paper/finish options exist (saddle
  // stitch has no standard-colour package, for one). Keep what the customer
  // already chose wherever the new format still sells it, and only fall back to
  // the default for the parts it doesn't.
  useEffect(() => {
    setVariant((prev) =>
      variantAllowed(variantPolicy, prev)
        ? prev
        : firstAllowedVariant(variantPolicy, prev) ?? defaultVariant,
    );
  }, [variantPolicy, defaultVariant]);

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
  const preferredAddress = useProfileStore((s) => s.preferredAddress);
  const upsertAddress = useProfileStore((s) => s.upsertAddress);

  const contentPages = pages.filter((p) => !p.isCover).length;
  const pageCount = normalizePageCount(product, contentPages);

  // Order limits for this format. The admin catalog is authoritative when set;
  // otherwise we fall back to the provider catalog's own page limits. The
  // backend re-checks these at checkout — this just fails fast with a clear
  // message instead of after the (slow) print-file render.
  const minPages = catalogProduct?.conditions.pages.min ?? product.minPages;
  const maxPages = catalogProduct?.conditions.pages.max ?? product.maxPages;
  const maxCopies = catalogProduct?.conditions.copies.max ?? Number.POSITIVE_INFINITY;

  // Countries this product can actually be shipped to, from the same function
  // the server enforces with — so the picker can't offer a destination checkout
  // will refuse.
  const countryOptions = useMemo(() => {
    if (!catalogProduct) return FALLBACK_COUNTRIES;
    const allowed = allowedMarketsFor(catalogProduct.shipping.destinations);
    return allowed.map((value) => ({ value, label: countryLabel(value) }));
  }, [catalogProduct]);

  // Shipping methods the product actually supports (backend rejects the rest).
  const shippingOptions = useMemo(() => {
    const enabled = catalogProduct?.shipping.methods.filter((m) => m.enabled) ?? [];
    if (enabled.length === 0) return SHIPPING;
    return enabled.map((m) => ({
      value: m.method,
      label: m.label || SHIPPING_LABEL[m.method] || m.method,
    }));
  }, [catalogProduct]);

  const [phase, setPhase] = useState<Phase>("form");
  const [status, setStatus] = useState("");
  const [coverDims, setCoverDims] = useState<{ widthMm: number; heightMm: number } | null>(null);

  const [name, setName] = useState(DEV_PREFILL?.name ?? "");
  const [contactEmail, setContactEmail] = useState(email);
  const [phone, setPhone] = useState(DEV_PREFILL?.phone ?? "");
  const [line1, setLine1] = useState(DEV_PREFILL?.line1 ?? "");
  const [line2, setLine2] = useState(DEV_PREFILL?.line2 ?? "");
  const [city, setCity] = useState(DEV_PREFILL?.city ?? "");
  const [region, setRegion] = useState(DEV_PREFILL?.region ?? "");
  const [postal, setPostal] = useState(DEV_PREFILL?.postal ?? "");
  const [country, setCountry] = useState(DEV_PREFILL?.country ?? "US");
  const [copies, setCopies] = useState(1);
  // Budget (Lulu MAIL) is the only level quotable in every destination we sell
  // to — GROUND ("Standard") is unavailable to the US and UK, and EXPEDITED
  // ("Express") is US-only, so defaulting to either fails the first price quote.
  // Per-product availability is configured in the admin catalog's shipping tab.
  const [shipping, setShipping] = useState<ShippingMethod>("Budget");

  // Saved-address book: "" means a new/unsaved address is being entered.
  const [selectedAddressId, setSelectedAddressId] = useState("");
  const [saveForNextTime, setSaveForNextTime] = useState(true);
  // Prefill from the user's preferred address once per dialog open, so returning
  // customers don't retype. Skipped in dev (the DEV_PREFILL already fills it).
  const prefilledRef = useRef(false);

  const [quote, setQuote] = useState<RetailPricePreview | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const quoteSeq = useRef(0);

  // Which address the customer settled on when the carrier suggested a different
  // one. `"unreviewed"` blocks payment: an unanswered address question is how an
  // order ends up held at the printer with the money already taken. The key is
  // the suggestion itself, so editing the address asks again rather than carrying
  // an answer over to a different question.
  const [addressChoice, setAddressChoice] = useState<AddressChoice>("unreviewed");
  const [reviewedSuggestion, setReviewedSuggestion] = useState("");

  const enteredAddress: EnteredAddress = { line1, line2, city, region, postal, country };
  const validation = quote?.addressValidation ?? null;
  const pendingSuggestion = suggestionKey(validation);
  const addressChoiceForSuggestion: AddressChoice =
    pendingSuggestion && pendingSuggestion === reviewedSuggestion ? addressChoice : "unreviewed";
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
    // exactly as typing would — otherwise saving would overwrite it silently.
    setSelectedAddressId("");
    setReviewedSuggestion(pendingSuggestion);
    setAddressChoice("suggested");
  };

  const keepEnteredAddress = () => {
    setReviewedSuggestion(pendingSuggestion);
    setAddressChoice("entered");
  };

  // Enough of a destination to ask the provider for a price. Lulu requires a
  // city + postcode (and a state for many countries) to compute shipping.
  const canQuote = Boolean(city.trim() && postal.trim() && country);

  useEffect(() => {
    if (open) setContactEmail((e) => e || email);
  }, [open, email]);

  // Keep the selected shipping method within what the product supports (the
  // options can arrive/refresh after the dialog opens).
  useEffect(() => {
    if (!shippingOptions.some((o) => o.value === shipping)) {
      setShipping(shippingOptions[0]?.value ?? "Standard");
    }
  }, [shippingOptions, shipping]);

  // Same for the country. A saved address from before a market was withdrawn
  // can hold a country no longer offered, and a `<select>` whose value isn't
  // among its options SHOWS the first one while holding the old value — so the
  // customer would read "United States" and have the order refused for France.
  useEffect(() => {
    if (countryOptions.length === 0) return;
    if (!countryOptions.some((o) => o.value === country)) {
      setCountry(countryOptions[0].value);
    }
  }, [countryOptions, country]);

  // Editing any address field detaches from the picked saved address, so saving
  // creates a new entry instead of silently overwriting the selected one.
  const editAddr = (setter: (value: string) => void, value: string) => {
    setter(value);
    setSelectedAddressId("");
  };

  const applyAddress = (a: SavedAddress) => {
    setSelectedAddressId(a.id);
    setName(a.recipientName);
    setPhone(a.phone);
    if (a.email) setContactEmail(a.email);
    setLine1(a.line1);
    setLine2(a.line2);
    setCity(a.city);
    setRegion(a.region);
    setPostal(a.postal);
    setCountry(a.country || "US");
  };

  // Prefill from the preferred saved address when the dialog opens (once).
  useEffect(() => {
    if (!open) {
      prefilledRef.current = false;
      setAddressChoice("unreviewed");
      setReviewedSuggestion("");
      return;
    }
    if (prefilledRef.current || DEV_PREFILL) return;
    const preferred = preferredAddress();
    if (preferred) {
      prefilledRef.current = true;
      applyAddress(preferred);
    }
    // Depend on the address count so prefill still fires if the saved addresses
    // finish loading AFTER the dialog opened. The ref guards against re-running
    // on every keystroke. applyAddress/preferredAddress are intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, savedAddresses.length]);

  // Live shipping/price quote (no print files needed) whenever the inputs change.
  // Held until there's enough of a destination address for the provider to price.
  useEffect(() => {
    if (!open) return;
    const seq = ++quoteSeq.current;
    if (!canQuote) {
      setQuoting(false);
      setQuote(null);
      setQuoteError(null);
      return;
    }
    setQuoting(true);
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
          currency: CURRENCY,
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
    open,
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
      formats.find((f) => {
        if (f.sku === product.sku) return false;
        const entry = offerableCatalog.get(f.sku);
        const min = entry?.conditions.pages.min ?? f.minPages;
        const max = entry?.conditions.pages.max ?? f.maxPages;
        return contentPages >= min && contentPages <= max;
      }),
    [formats, product.sku, offerableCatalog, contentPages],
  );

  const requirementError = useMemo(() => {
    const fix = alternative
      ? ` ${capitalize(bindingNoun(alternative.binding))} takes a book this length — switch below.`
      : "";
    if (contentPages < minPages) {
      return `A ${bindingNoun(product.binding)} needs at least ${minPages} pages — your book has ${contentPages}.${
        fix || ` Add ${minPages - contentPages} more before ordering.`
      }`;
    }
    if (contentPages > maxPages) {
      return `A ${bindingNoun(product.binding)} takes up to ${maxPages} pages — your book has ${contentPages}.${
        fix || " Remove some pages before ordering."
      }`;
    }
    if (copies > maxCopies) {
      return `You can order up to ${maxCopies} copies at a time.`;
    }
    return null;
  }, [contentPages, minPages, maxPages, copies, maxCopies, product.binding, alternative]);

  const addressComplete = Boolean(
    name.trim() &&
      phone.trim() &&
      line1.trim() &&
      city.trim() &&
      postal.trim() &&
      country &&
      copies >= 1,
  );
  const canOrder = addressComplete && !requirementError && !addressNeedsReview;

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
      notify.error("Add a recipient name, phone number and full shipping address.");
      return;
    }
    try {
      setPhase("rendering");
      setStatus("Calculating cover size…");
      const dims = await provider.getCoverDimensionsMm(printSku, pageCount);
      setCoverDims(dims);
      setStatus("Rendering print files…");
      // OrderAssetRunner mounts below once coverDims is set and calls onAssets.
    } catch (err) {
      setPhase("form");
      notify.error(err);
    }
  }

  async function onAssets(assets: OrderAssets) {
    try {
      setPhase("submitting");
      setStatus("Redirecting to secure checkout…");
      const draft = buildOrderDraft({
        product,
        copies,
        recipient: recipient(),
        shippingMethod: shipping,
        interior: assets.interior,
        pageCount: assets.pageCount,
        cover: assets.cover,
        destinationCountry: country,
        currency: CURRENCY,
        merchantReference: project.id,
      });
      // Remember this address for faster reordering (deduped; first one becomes
      // the default). Best-effort — done before the redirect so it isn't lost.
      if (saveForNextTime) {
        void upsertAddress({
          id: selectedAddressId || undefined,
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
      const { url } = await startOrderCheckout({ draft, pageCount, variant });
      window.location.href = url;
    } catch (err) {
      setPhase("form");
      setCoverDims(null);
      notify.error(err);
    }
  }

  const busy = phase === "rendering" || phase === "submitting";

  return (
    // Closing during "rendering" is allowed — it unmounts the asset runner and
    // safely abandons the render (nothing uploaded/charged yet), so a hung
    // render can't trap the user. Only "submitting" (checkout request already
    // in flight) is locked.
    <Modal
      open={open}
      onClose={phase === "submitting" ? () => {} : onClose}
      title="Order a printed book"
      size="max-w-xl"
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={phase === "submitting"}>
            Cancel
          </Button>
          <Button
            onClick={() => void beginRender()}
            loading={busy}
            disabled={busy || !canOrder || !accessGate.ok}
          >
            {phase === "rendering"
              ? "Preparing files…"
              : phase === "submitting"
                ? "Redirecting…"
                : addressUnverifiable
                  ? "Check your address"
                  : addressNeedsReview
                    ? "Confirm your address"
                    : "Continue to payment"}
          </Button>
        </div>
      }
    >
      {
        <div className="space-y-5">
          {/* Product */}
          <div className="flex items-start gap-3 rounded-xl border border-ink-100 bg-ink-50 px-3.5 py-3">
            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
              <Package className="size-4" />
            </span>
            <div className="min-w-0 text-sm">
              <p className="font-medium text-ink-800">{project.title || "Your storybook"}</p>
              <p className="text-xs text-ink-500">
                {product.trim.widthIn}×{product.trim.heightIn}″ · {pageCount} pages ·{" "}
                {bindingNoun(product.binding)}
              </p>
            </div>
          </div>

          {/* Format requirement gate — the book doesn't fit this product yet. */}
          {requirementError && (
            <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm text-rose-700">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <span>{requirementError}</span>
            </div>
          )}

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

          {/* WHAT to make, before WHERE to send it: the binding, then how the
              inside is printed and the cover finished. None of it touches the
              designed pages — that's exactly why these are asked here and not
              back in the design flow. */}
          <FormatPicker
            formats={formats}
            catalog={offerableCatalog}
            value={product.sku}
            onChange={(sku) => void updateConfig({ productSku: sku })}
            contentPages={contentPages}
            currency={CURRENCY}
          />

          <VariantPicker
            policy={variantPolicy}
            value={variant}
            onChange={setVariant}
            currency={CURRENCY}
            pages={pageCount}
          />

          {/* Saved address picker — lets returning customers reuse an address. */}
          {savedAddresses.length > 0 && (
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
                  else setSelectedAddressId("");
                }}
              />
            </Field>
          )}

          {/* Recipient — wrapped in a form with autocomplete tokens so the
              browser can offer to autofill the whole shipping block at once. */}
          <form className="grid grid-cols-2 gap-3" onSubmit={(e) => e.preventDefault()}>
            <Field label="Recipient name" required className="col-span-2">
              <Input
                value={name}
                onChange={(e) => editAddr(setName, e.target.value)}
                placeholder="Jane Doe"
                autoComplete="shipping name"
              />
            </Field>
            <Field label="Email">
              <Input
                type="email"
                value={contactEmail}
                onChange={(e) => editAddr(setContactEmail, e.target.value)}
                placeholder="for shipping updates"
                autoComplete="email"
              />
            </Field>
            <Field label="Phone" required>
              <Input
                type="tel"
                value={phone}
                onChange={(e) => editAddr(setPhone, e.target.value)}
                placeholder="for the carrier"
                autoComplete="shipping tel"
              />
            </Field>
            <Field label="Address" required className="col-span-2">
              <Input
                value={line1}
                onChange={(e) => editAddr(setLine1, e.target.value)}
                placeholder="Street address"
                autoComplete="shipping address-line1"
              />
            </Field>
            <Field label="Address line 2" className="col-span-2">
              <Input
                value={line2}
                onChange={(e) => editAddr(setLine2, e.target.value)}
                placeholder="Apt, suite (optional)"
                autoComplete="shipping address-line2"
              />
            </Field>
            <Field label="City" required>
              <Input
                value={city}
                onChange={(e) => editAddr(setCity, e.target.value)}
                autoComplete="shipping address-level2"
              />
            </Field>
            <Field label="State / County">
              <Input
                value={region}
                onChange={(e) => editAddr(setRegion, e.target.value)}
                autoComplete="shipping address-level1"
              />
            </Field>
            <Field label="Postal / ZIP" required>
              <Input
                value={postal}
                onChange={(e) => editAddr(setPostal, e.target.value)}
                autoComplete="shipping postal-code"
              />
            </Field>
            <Field label="Country" required>
              <Select
                options={countryOptions}
                value={country}
                onChange={(e) => editAddr(setCountry, e.target.value)}
                autoComplete="shipping country"
              />
            </Field>
          </form>

          {/* The carrier's verdict on the address, from the live quote. Asked
              here — while it's still free — because a mismatch discovered after
              payment parks the print job awaiting manual confirmation. */}
          {validation && (
            <AddressSuggestion
              validation={validation}
              entered={enteredAddress}
              choice={addressChoiceForSuggestion}
              onUseSuggested={applyAddressChoice}
              onKeepEntered={keepEnteredAddress}
            />
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

          {/* Copies + shipping */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Copies" required>
              <Input
                type="number"
                min={1}
                max={Number.isFinite(maxCopies) ? maxCopies : undefined}
                value={copies}
                onChange={(e) => {
                  const next = Math.max(1, Number(e.target.value) || 1);
                  setCopies(Number.isFinite(maxCopies) ? Math.min(next, maxCopies) : next);
                }}
              />
            </Field>
            <Field label="Shipping" required>
              <Select
                options={shippingOptions}
                value={shipping}
                onChange={(e) => setShipping(e.target.value as ShippingMethod)}
              />
            </Field>
          </div>

          {/* Quote */}
          <div className="rounded-xl border border-ink-100 px-3.5 py-3 text-sm">
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ink-400">
              <Truck className="size-3.5" /> Estimated cost
            </div>
            {quoting ? (
              <div className="flex items-center gap-2 text-ink-500">
                <Loader2 className="size-4 animate-spin" /> Getting a live quote…
              </div>
            ) : quote ? (
              <>
                <QuoteLines quote={quote} />
                {/* Only when the customer isn't already getting a member price —
                    otherwise this would advertise a discount they have. */}
                {quote.discountPct === 0 && (
                  <PlanUpsell context="print" variant="inline" className="mt-2" />
                )}
              </>
            ) : quoteError ? (
              <p className="text-rose-500">{quoteError}</p>
            ) : (
              <p className="text-ink-500">
                Enter a city, state and postal code to see pricing.
              </p>
            )}
          </div>

          {busy && (
            <div className="flex items-center gap-2 rounded-xl border border-brand-100 bg-brand-50 px-3 py-2.5 text-sm text-brand-700">
              <Loader2 className="size-4 animate-spin" />
              <span className="truncate" title={status}>
                {status}
              </span>
            </div>
          )}

          <p className="flex items-center gap-1.5 text-[11px] leading-relaxed text-ink-400">
            <ShieldCheck className="size-3.5 shrink-0" />
            Payment is processed securely by Stripe. You'll review the final total — including any
            tax — before paying. Your order is sent to print only after payment succeeds.
          </p>
        </div>
      }

      {phase === "rendering" && coverDims && (
        <OrderAssetRunner
          project={project}
          pages={pages}
          design={design}
          coverWidthMm={coverDims.widthMm}
          coverHeightMm={coverDims.heightMm}
          onProgress={setStatus}
          onDone={onAssets}
          onError={(err) => {
            setPhase("form");
            setCoverDims(null);
            notify.error(err);
          }}
        />
      )}
    </Modal>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
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

function QuoteLines({ quote }: { quote: RetailPricePreview }) {
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
      <Row label="Shipping" value={money(String(quote.shipping), currency)} />
      <div className="my-1 h-px bg-ink-100" />
      <Row label="Estimated total" value={money(String(quote.total), currency)} bold />
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={bold ? "font-semibold text-ink-800" : "text-ink-600"}>{label}</span>
      <span className={bold ? "font-semibold text-ink-900" : "text-ink-700"}>{value}</span>
    </div>
  );
}
