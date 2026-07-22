import { useMemo } from "react";
import { BookMarked, Ruler } from "lucide-react";
import { bookSizeFromAspect } from "../../core/config/options";
import { BOOK_PRODUCTS, type BookProduct } from "../../core/fulfillment";
import { bookProductForConfig } from "../../core/book";
import type { PublicProduct } from "../../core/config/products";
import { useAppConfigStore } from "../../state/appConfigStore";
import { OptionCard } from "../components/OptionCard";
import type { BookConfig } from "../../core/types";
import type { GuidedQuestion } from "./GuidedQuestions";
import { BookSizeShape } from "./visuals";
import type { StepProps } from "./steps/types";

const BINDING_LABEL: Record<string, string> = {
  casewrap: "Hardcover",
  "linen-wrap": "Hardcover (linen)",
  "perfect-bound": "Softcover",
  "saddle-stitch": "Softcover (stapled)",
  "coil-bound": "Coil-bound",
};

/** Format a trim in inches as a friendly "8.5 × 8.5 in" string. */
function trimLabel(widthIn: number, heightIn: number): string {
  const r = (n: number) => Math.round(n * 10) / 10;
  return `${r(widthIn)} × ${r(heightIn)} in`;
}

/** Coarse shape word for a page aspect ratio. */
function shapeLabel(aspect: number): string {
  const shape = bookSizeFromAspect(aspect);
  return shape.charAt(0).toUpperCase() + shape.slice(1);
}

/** Stable key grouping products that share a physical trim (a "size"). */
function trimKey(p: BookProduct): string {
  return `${p.trim.widthIn}x${p.trim.heightIn}`;
}

/** Lowest configured price across currencies, formatted (best-effort). */
function priceLabel(pp: PublicProduct): string | null {
  const entries = Object.entries(pp.prices).filter(([, v]) => v > 0);
  if (entries.length === 0) return null;
  const [currency, amount] = entries.find(([c]) => c === "USD") ?? entries[0];
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/**
 * The products offered to readers: those an admin activated in the configurator
 * (matched to the physical catalog), falling back to the whole catalog when
 * nothing is configured yet. Mirrors the old AudienceStep behavior.
 */
function useOfferableProducts() {
  const publicProducts = useAppConfigStore((s) => s.products.products);
  return useMemo(() => {
    const activeBySku = new Map(
      publicProducts.filter((p) => p.status === "active").map((p) => [p.sku, p] as const),
    );
    const offerable = BOOK_PRODUCTS.filter((p) => activeBySku.has(p.sku));
    const shown = offerable.length > 0 ? offerable : BOOK_PRODUCTS;
    return { shown, activeBySku };
  }, [publicProducts]);
}

/** Question 1 · physical size (trim + shape), independent of binding. */
function SizeQuestion({ config, update }: StepProps) {
  const { shown } = useOfferableProducts();
  const current = bookProductForConfig(config);

  // One card per distinct trim; the first product of each trim is representative.
  const sizes = useMemo(() => {
    const byTrim = new Map<string, BookProduct>();
    for (const p of shown) if (!byTrim.has(trimKey(p))) byTrim.set(trimKey(p), p);
    return [...byTrim.values()];
  }, [shown]);

  const selectSize = (rep: BookProduct) => {
    // Keep the current binding if this trim offers it; otherwise take the first.
    const sameTrim = shown.filter((p) => trimKey(p) === trimKey(rep));
    const keep = sameTrim.find((p) => p.binding === current.binding) ?? sameTrim[0] ?? rep;
    update({ productSku: keep.sku, bookSize: bookSizeFromAspect(keep.aspect) });
  };

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {sizes.map((product) => (
        <OptionCard
          key={trimKey(product)}
          selected={trimKey(current) === trimKey(product)}
          onSelect={() => selectSize(product)}
          title={`${shapeLabel(product.aspect)} · ${trimLabel(product.trim.widthIn, product.trim.heightIn)}`}
          description={`${shapeLabel(product.aspect)} pages — real printed dimensions.`}
          visual={<BookSizeShape aspect={product.aspect} />}
        />
      ))}
    </div>
  );
}

/** Question 2 · format (binding + finish) among products sharing the size. */
function FormatQuestion({ config, update }: StepProps) {
  const { shown, activeBySku } = useOfferableProducts();
  const current = bookProductForConfig(config);
  const options = shown.filter((p) => trimKey(p) === trimKey(current));

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {options.map((product) => {
        const configured = activeBySku.get(product.sku);
        const price = configured ? priceLabel(configured) : null;
        const base = `${BINDING_LABEL[product.binding] ?? product.binding} · ${product.finish}`;
        return (
          <OptionCard
            key={product.sku}
            selected={config.productSku === product.sku}
            onSelect={() => update({ productSku: product.sku })}
            title={configured?.name ?? product.label}
            description={price ? `${base} · from ${price}` : base}
          />
        );
      })}
    </div>
  );
}

function sizeSummary(config: BookConfig): string {
  const p = bookProductForConfig(config);
  return `${shapeLabel(p.aspect)} · ${trimLabel(p.trim.widthIn, p.trim.heightIn)}`;
}

function formatSummary(config: BookConfig): string {
  const p = bookProductForConfig(config);
  return `${BINDING_LABEL[p.binding] ?? p.binding} · ${p.finish}`;
}

/**
 * The Design flow: the physical decisions that shape the printed book. Size and
 * format live here (not in Story) because anchors render square and screenplay
 * pacing no longer depends on trim, so nothing upstream needs them.
 */
export const DESIGN_QUESTIONS: GuidedQuestion[] = [
  {
    id: "size",
    title: "Choose your book size",
    subtitle: "Real printed dimensions — this sets the physical page size.",
    icon: Ruler,
    isAnswered: (c) => Boolean(c.productSku),
    summary: sizeSummary,
    render: (props) => <SizeQuestion {...props} />,
  },
  {
    id: "format",
    title: "Pick a format",
    subtitle: "How the book is bound and finished.",
    icon: BookMarked,
    isAnswered: (c) => Boolean(c.productSku),
    summary: formatSummary,
    render: (props) => <FormatQuestion {...props} />,
  },
];
