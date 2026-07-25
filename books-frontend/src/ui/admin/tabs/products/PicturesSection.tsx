"use client";

import {
  EBOOK_MEDIA_KEY,
  FALLBACK_ID,
  PRINT_OPTION_FEATURES,
  bookMediaKey,
  optionMediaKey,
  packMediaKey,
  type PrintOptionFeature,
} from "../../../../core/config/catalogMedia";
import type { ProductDefinition } from "../../../../core/config/products";
import type { SparkPack } from "../../../../core/config/sparks";
import {
  variantMediaKey,
  variantOptionsFor,
  type VariantAxisId,
} from "../../../../core/config/variants";
import { BINDINGS } from "../../../../core/fulfillment/types";
import { SKU_AXES } from "../../../../core/fulfillment/lulu/skuAxes";
import { cn } from "../../../lib/cn";
import { PictureRow } from "./Pictures";
import { Disclosure, Section } from "./parts";

/**
 * The **Product pictures** section, one per catalog segment. This is the place to
 * sit down and photograph a whole catalog: the print options, every book, the
 * digital edition, every Spark pack — plus the default sets that stand in for
 * anything not yet shot.
 *
 * It exists because none of this belongs to a product record (see
 * `catalogMedia.ts`), and a picture of a coil binding uploaded while editing one
 * book was never going to be a property of that book. The thumbnails in the
 * product form remain as shortcuts into the same store.
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

const FEATURE_LABELS: Record<PrintOptionFeature, string> = {
  trim: "Trim size",
  binding: "Binding",
  print: "Interior printing",
  paper: "Paper",
  finish: "Cover finish",
};

const VARIANT_FEATURES: VariantAxisId[] = ["print", "paper", "finish"];

/**
 * Every option value worth a picture, per feature. Format axes (trim, binding)
 * come from the SKU builder; customer-facing variant axes come from the shared
 * vocabulary in `variants.ts` (four print tiers, not separate ink/quality).
 */
function optionEntries(feature: PrintOptionFeature): OptionEntry[] {
  if (VARIANT_FEATURES.includes(feature as VariantAxisId)) {
    const axis = feature as VariantAxisId;
    return variantOptionsFor(axis).map((o) => ({
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

function StatusChip({ status }: { status: ProductDefinition["status"] }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        status === "active"
          ? "bg-emerald-50 text-emerald-700"
          : status === "draft"
            ? "bg-amber-50 text-amber-700"
            : "bg-ink-100 text-ink-500",
      )}
    >
      {status}
    </span>
  );
}

/** `8.5 × 8.5" · casewrap · matte` — enough to tell two formats apart. */
function specSummary(product: ProductDefinition): string {
  const { pageTrim, binding, finish } = product.spec;
  const size = `${pageTrim.width} × ${pageTrim.height}${pageTrim.unit === "in" ? '"' : "mm"}`;
  return [size, binding, finish].join(" · ");
}

const DEFAULT_HINT = "Stands in wherever nothing more specific has been uploaded.";

export function PrintPicturesSection({ products }: { products: ProductDefinition[] }) {
  const books = [...products].sort((a, b) => a.sortOrder - b.sortOrder);
  return (
    <Section
      title="Product pictures"
      hint="Photographs shown to customers. They live outside the product records, so a picture of a binding serves every book that uses it, and a book with none of its own falls back to the default set. Uploads take effect immediately — no Save needed."
    >
      <Disclosure label={`Books (${books.length})`} defaultOpen>
        <div className="space-y-1.5">
          <PictureRow
            mediaKey={bookMediaKey(FALLBACK_ID)}
            label="Default pictures"
            hint={DEFAULT_HINT}
          />
          {books.map((p) => (
            <PictureRow
              key={p.id}
              mediaKey={bookMediaKey(p.id)}
              label={p.presentation.name || "(unnamed product)"}
              hint={specSummary(p)}
              badge={<StatusChip status={p.status} />}
            />
          ))}
          {books.length === 0 && (
            <p className="text-[11px] text-ink-400">
              No books configured yet. The default set above will cover the first one you add.
            </p>
          )}
        </div>
      </Disclosure>

      <Disclosure label="Print options" defaultOpen>
        <div className="space-y-3">
          {PRINT_OPTION_FEATURES.map((feature) => (
            <div key={feature} className="space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                {FEATURE_LABELS[feature]}
              </p>
              {optionEntries(feature).map((o) => (
                <PictureRow key={o.key} mediaKey={o.key} label={o.label} hint={o.hint} />
              ))}
            </div>
          ))}
        </div>
      </Disclosure>
    </Section>
  );
}

export function EbookPicturesSection() {
  return (
    <Section
      title="Product pictures"
      hint="What the digital edition looks like — a tablet mock-up, a sample spread on screen. Every customer's ebook holds a different story, so these picture the format rather than the contents. Uploads take effect immediately — no Save needed."
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
