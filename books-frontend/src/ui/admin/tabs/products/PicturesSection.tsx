"use client";

import {
  EBOOK_MEDIA_KEY,
  FALLBACK_ID,
  PRINT_OPTION_FEATURES,
  activePhotosFor,
  bookMediaKey,
  optionMediaKey,
  packMediaKey,
  type PrintOptionFeature,
} from "../../../../core/config/catalogMedia";
import type { ProductDefinition } from "../../../../core/config/products";
import type { SparkPack } from "../../../../core/config/sparks";
import {
  NO_OPTION,
  variantMediaKey,
  variantOptionsFor,
  type VariantAxisId,
} from "../../../../core/config/variants";
import { BINDINGS } from "../../../../core/fulfillment/types";
import { SKU_AXES } from "../../../../core/fulfillment/lulu/skuAxes";
import { useAppConfigStore } from "../../../../state/appConfigStore";
import { cn } from "../../../lib/cn";
import { PictureRow } from "./Pictures";
import { Section } from "./parts";

/**
 * Where catalog pictures are managed.
 *
 * None of these belong to a product record (see `catalogMedia.ts`): a photo of
 * a coil binding is true of every coil-bound book, so it is set once, here, in
 * the shared **Print options** page — not repeated inside each book. The print
 * book editor only *shows* these (read-only thumbnails) and links back here.
 *
 * What stays per item: the digital edition and each Spark pack, which are
 * single products with their own artwork, and the optional own-pictures row
 * under a book's Advanced settings.
 */

/** `linen-wrap` → `Linen wrap`, for domain values no provider option describes. */
function titleCase(slug: string): string {
  const words = slug.replace(/[-_]/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

interface OptionEntry {
  key: string;
  label: string;
  hint?: string;
}

export const FEATURE_LABELS: Record<PrintOptionFeature, string> = {
  trim: "Trim size",
  binding: "Binding",
  print: "Interior printing",
  paper: "Paper",
  finish: "Cover finish",
  linen: "Linen color (linen hardcover)",
  foil: "Spine foil (linen hardcover)",
};

const VARIANT_FEATURES: VariantAxisId[] = ["print", "paper", "finish", "linen", "foil"];

/**
 * Every option value worth a picture, per feature. Format axes (trim, binding)
 * come from the SKU builder; customer-facing variant axes come from the shared
 * vocabulary in `variants.ts` (four print tiers, not separate ink/quality).
 */
export function optionEntries(feature: PrintOptionFeature): OptionEntry[] {
  if (VARIANT_FEATURES.includes(feature as VariantAxisId)) {
    const axis = feature as VariantAxisId;
    return variantOptionsFor(axis)
      .filter((o) => o.value !== NO_OPTION)
      .map((o) => ({
        key: variantMediaKey(axis, o.value),
        label: o.label,
        hint: o.hint,
      }));
  }
  const axis = SKU_AXES.find((a) => a.id === feature);
  const entries: OptionEntry[] = [];
  const seen = new Set<string>();
  for (const option of axis?.options ?? []) {
    if (!option.mediaKey || seen.has(option.mediaKey)) continue;
    seen.add(option.mediaKey);
    entries.push({ key: option.mediaKey, label: option.label, hint: option.hint });
  }
  if (feature === "binding") {
    for (const value of BINDINGS) {
      const key = optionMediaKey(feature, value);
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({
        key,
        label: titleCase(value),
        hint: "Not sold by the current print provider — pictures are kept for when it is.",
      });
    }
  }
  return entries;
}

/** `8.5 × 8.5" · casewrap · matte` — enough to tell two formats apart. */
export function specSummary(product: ProductDefinition): string {
  const { pageTrim, binding, finish } = product.spec;
  const size = `${pageTrim.width} × ${pageTrim.height}${pageTrim.unit === "in" ? '"' : "mm"}`;
  return [size, binding, finish].join(" · ");
}

const DEFAULT_HINT = "Stands in wherever nothing more specific has been uploaded.";

/**
 * The shared picture library for print books: one default set, then every
 * option a customer can choose, grouped by feature. Groups that are complete
 * fold away so the screen opens on what still needs a photo.
 */
export function PrintOptionsPanel() {
  const media = useAppConfigStore((s) => s.catalogMedia);
  const groups = PRINT_OPTION_FEATURES.map((feature) => {
    const entries = optionEntries(feature);
    const missing = entries.filter((o) => activePhotosFor(media, o.key).length === 0);
    return { feature, entries, missing };
  });
  const total = groups.reduce((n, g) => n + g.entries.length, 0);
  const missingCount = groups.reduce((n, g) => n + g.missing.length, 0);

  return (
    <div className="space-y-4">
      <p
        className={cn(
          "rounded-lg px-3 py-2 text-xs",
          missingCount === 0 ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800",
        )}
      >
        {missingCount === 0
          ? `Every print option has a picture (${total} of ${total}).`
          : `${total - missingCount} of ${total} options have a picture. Groups still missing some are open below.`}
      </p>

      <Section
        title="Default pictures"
        hint="Shown for any book that has no pictures of its own — which is most of them."
      >
        <PictureRow
          mediaKey={bookMediaKey(FALLBACK_ID)}
          label="Default pictures"
          hint={DEFAULT_HINT}
        />
      </Section>

      {groups.map(({ feature, entries, missing }) => (
        <Section
          key={feature}
          title={FEATURE_LABELS[feature]}
          collapsible
          defaultOpen={missing.length > 0}
          summary={
            missing.length === 0
              ? `All ${entries.length} have a picture`
              : `${entries.length - missing.length} of ${entries.length} have a picture`
          }
        >
          <div className="space-y-1.5">
            {entries.map((o) => (
              <PictureRow key={o.key} mediaKey={o.key} label={o.label} hint={o.hint} />
            ))}
          </div>
        </Section>
      ))}
    </div>
  );
}

export function EbookPicturesSection() {
  return (
    <Section
      title="Photos"
      hint="The format, not the contents — every customer's ebook is a different book. Uploads take effect immediately."
    >
      <PictureRow
        mediaKey={EBOOK_MEDIA_KEY}
        label="Digital edition"
        hint="Shown wherever the ebook is offered."
      />
    </Section>
  );
}

export function PackPicturesSection({ packs }: { packs: SparkPack[] }) {
  const sorted = [...packs].sort((a, b) => a.sortOrder - b.sortOrder);
  return (
    <Section
      title="Product pictures"
      hint="Artwork for the top-up packs. A pack with no picture of its own falls back to the default set. Uploads take effect immediately — no Save needed."
    >
      <div className="space-y-1.5">
        <PictureRow
          mediaKey={packMediaKey(FALLBACK_ID)}
          label="Default pictures"
          hint={DEFAULT_HINT}
        />
        {sorted.map((pack) => (
          <PictureRow
            key={pack.id}
            mediaKey={packMediaKey(pack.id)}
            label={pack.label || "(unnamed pack)"}
            hint={`${(pack.sparks + pack.bonusSparks).toLocaleString()} ✦`}
            badge={
              pack.active ? undefined : (
                <span className="shrink-0 rounded bg-ink-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-500">
                  off
                </span>
              )
            }
          />
        ))}
        {sorted.length === 0 && <p className="text-[11px] text-ink-400">No packs yet.</p>}
      </div>
    </Section>
  );
}
