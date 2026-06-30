import { AGE_RANGES, bookSizeFromAspect } from "../../../core/config/options";
import { BOOK_PRODUCTS } from "../../../core/fulfillment";
import type { PublicProduct } from "../../../core/config/products";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { OptionCard } from "../../components/OptionCard";
import { BookSizeShape } from "../visuals";
import type { StepProps } from "./types";

/** Format a trim in inches as a friendly "8.5 × 8.5 in" string. */
function trimLabel(widthIn: number, heightIn: number): string {
  const r = (n: number) => Math.round(n * 10) / 10;
  return `${r(widthIn)} × ${r(heightIn)} in`;
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

const BINDING_LABEL: Record<string, string> = {
  casewrap: "Hardcover",
  "linen-wrap": "Hardcover (linen)",
  "perfect-bound": "Softcover",
  "saddle-stitch": "Softcover (stapled)",
  "coil-bound": "Coil-bound",
};

export function AudienceStep({ config, update }: StepProps) {
  const publicProducts = useAppConfigStore((s) => s.products.products);

  // Offer only products an admin has activated in the configurator, matched to
  // the physical catalog (which still drives trim/aspect for image generation).
  // Falls back to the full catalog when nothing is configured yet.
  const activeBySku = new Map(
    publicProducts.filter((p) => p.status === "active").map((p) => [p.sku, p] as const),
  );
  const offerable = BOOK_PRODUCTS.filter((p) => activeBySku.has(p.sku));
  const shownProducts = offerable.length > 0 ? offerable : BOOK_PRODUCTS;

  return (
    <div className="space-y-7">
      <section>
        <h2 className="text-lg font-semibold text-ink-900">Who is it for?</h2>
        <p className="mt-1 text-sm text-ink-500">
          The age range guides reading level, sentence length, and pacing.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {AGE_RANGES.map((age) => (
            <OptionCard
              key={age.id}
              selected={config.ageRangeId === age.id}
              onSelect={() => update({ ageRangeId: age.id })}
              title={age.label}
              description={age.description}
            />
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-ink-700">Book size &amp; format</h3>
        <p className="mt-1 text-xs text-ink-500">
          Real printed dimensions. This sets the physical page size, which is why
          the same font looks bigger or smaller depending on the book.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shownProducts.map((product) => {
            const configured = activeBySku.get(product.sku);
            const price = configured ? priceLabel(configured) : null;
            const baseDesc = `${BINDING_LABEL[product.binding] ?? product.binding} · ${trimLabel(
              product.trim.widthIn,
              product.trim.heightIn,
            )}`;
            return (
              <OptionCard
                key={product.sku}
                selected={config.productSku === product.sku}
                onSelect={() =>
                  update({
                    productSku: product.sku,
                    // Keep the coarse shape in sync for image generation / prompts.
                    bookSize: bookSizeFromAspect(product.aspect),
                  })
                }
                title={configured?.name ?? product.label}
                description={price ? `${baseDesc} · from ${price}` : baseDesc}
                visual={<BookSizeShape aspect={product.aspect} />}
              />
            );
          })}
        </div>
      </section>
    </div>
  );
}
