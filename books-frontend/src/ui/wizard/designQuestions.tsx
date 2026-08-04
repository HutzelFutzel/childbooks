import { useEffect, useMemo, useState } from "react";
import { Check, LayoutTemplate, Ruler, TriangleAlert } from "lucide-react";
import { bookSizeFromAspect } from "../../core/config/options";
import { bookProductForConfig } from "../../core/book";
import { getBookLayout, isKnownLayoutId } from "../../core/book/layouts";
import { layoutAvailability, resolveLayoutById, resolvedLayouts } from "../../core/book/layoutCatalog";
import { useOfferableFormats, trimKey, type SizeOption } from "../hooks/useOfferableFormats";
import { useAppConfigStore } from "../../state/appConfigStore";
import { useProjectsStore } from "../../state/projectsStore";
import { OptionCard } from "../components/OptionCard";
import { Button } from "../components/Button";
import { LayoutSchematic } from "../design/LayoutSchematic";
import { cn } from "../lib/cn";
import type { BookConfig } from "../../core/types";
import type { GuidedQuestion } from "./GuidedQuestions";
import { BookSizeShape } from "./visuals";
import type { StepProps } from "./steps/types";

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

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

type PickerProps = StepProps & {
  /** Single-column rows for the docked Setup accordion (~320px). */
  compact?: boolean;
};

/** Question 1 · physical size (trim), the one choice the design is built around. */
export function SizeQuestion({ config, compact }: PickerProps) {
  const { sizes, purchasable, offerable, currency, catalogLoaded } = useOfferableFormats();
  const current = bookProductForConfig(config);
  // Art is generated at the page's aspect ratio, so a different shape means every
  // illustration is cropped to fit. That makes size the one decision this flow
  // can't quietly revise on a return visit.
  const artCount = useProjectsStore((s) => Object.keys(s.current()?.illustrations ?? {}).length);
  // The store action rather than the `update` prop: this component writes from an
  // effect, and the prop is a fresh closure on every render.
  const update = useProjectsStore((s) => s.updateConfig);
  const [confirming, setConfirming] = useState<SizeOption | null>(null);

  const currentOffered = offerable.has(current.sku);
  const selectedKey = sizes.some((s) => s.key === trimKey(current)) ? trimKey(current) : null;

  // Snap a project whose size is no longer sold onto one that is — but only
  // before any art exists, where it costs nothing. After that the choice is the
  // reader's to make (or not), so we explain it instead.
  useEffect(() => {
    if (!purchasable || currentOffered || artCount > 0) return;
    const fallback = sizes[0];
    if (!fallback) return;
    void update({ productSku: fallback.rep.sku, bookSize: bookSizeFromAspect(fallback.rep.aspect) });
  }, [purchasable, currentOffered, artCount, sizes, update]);

  const apply = (size: SizeOption) => {
    // Keep the current binding when this size is printed in it, so a reader who
    // switches size and back doesn't silently change format too.
    const keep = size.formats.find((p) => p.binding === current.binding) ?? size.rep;
    void update({ productSku: keep.sku, bookSize: bookSizeFromAspect(keep.aspect) });
    setConfirming(null);
  };

  const select = (size: SizeOption) => {
    if (size.key === trimKey(current)) return;
    // Only a change of shape re-crops the art; a same-aspect size never would.
    if (artCount > 0 && size.rep.aspect !== current.aspect) setConfirming(size);
    else apply(size);
  };

  const warnCls = compact
    ? "flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-800"
    : "flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm text-amber-800";

  return (
    <div className={cn("space-y-3", compact && "space-y-2")}>
      {/* Nothing is on sale, so these are page shapes rather than things to buy.
          Said plainly here instead of at the order step, where it would arrive
          as a surprise after all the work. */}
      {catalogLoaded && !purchasable && (
        <div className={warnCls}>
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            Printed copies aren't on sale right now, so pick whichever shape suits your story —
            nothing is lost. You'll be able to order once printing is back.
          </span>
        </div>
      )}

      {purchasable && !currentOffered && artCount > 0 && (
        <div className={warnCls}>
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            The size this book was started at ({trimLabel(current.trim.widthIn, current.trim.heightIn)})
            isn't sold any more. Pick one below to make it printable — your {artCount} illustration
            {artCount === 1 ? "" : "s"} will need re-generating to match the new shape.
          </span>
        </div>
      )}

      {compact ? (
        <div className="flex flex-col gap-1.5">
          {sizes.map((size) => (
            <CompactOptionRow
              key={size.key}
              selected={selectedKey === size.key}
              onSelect={() => select(size)}
              title={`${shapeLabel(size.rep.aspect)} · ${trimLabel(size.rep.trim.widthIn, size.rep.trim.heightIn)}`}
              description={
                size.cheapest != null
                  ? `From ${money(size.cheapest, currency)}`
                  : "Printed dimensions"
              }
              visual={<BookSizeShape aspect={size.rep.aspect} size="sm" />}
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sizes.map((size) => (
            <OptionCard
              key={size.key}
              selected={selectedKey === size.key}
              onSelect={() => select(size)}
              title={`${shapeLabel(size.rep.aspect)} · ${trimLabel(size.rep.trim.widthIn, size.rep.trim.heightIn)}`}
              description={
                size.cheapest != null
                  ? `Real printed dimensions · from ${money(size.cheapest, currency)}`
                  : "Real printed dimensions."
              }
              visual={<BookSizeShape aspect={size.rep.aspect} />}
            />
          ))}
        </div>
      )}

      {confirming && (
        <div className={warnCls}>
          <div className="min-w-0 flex-1 space-y-2">
            <p className="flex items-start gap-2">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <span>
                Your {artCount} illustration{artCount === 1 ? "" : "s"}{" "}
                {artCount === 1 ? "was" : "were"} drawn for {shapeLabel(current.aspect).toLowerCase()}{" "}
                pages. Switching to {shapeLabel(confirming.rep.aspect).toLowerCase()} keeps them, but
                they'll be cropped to the new shape until you re-generate them.
              </span>
            </p>
            <div className={cn("flex gap-2", compact && "flex-col")}>
              <Button size="sm" onClick={() => apply(confirming)}>
                Change the size anyway
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                Keep {shapeLabel(current.aspect).toLowerCase()}
              </Button>
            </div>
          </div>
        </div>
      )}

      {purchasable && (
        <p className="text-xs text-ink-400">
          How the book is bound — hardcover, softcover, stapled — is chosen when you order, once
          your book has a final page count to bind.
        </p>
      )}
    </div>
  );
}

export function sizeSummary(config: BookConfig): string {
  const p = bookProductForConfig(config);
  return `${shapeLabel(p.aspect)} · ${trimLabel(p.trim.widthIn, p.trim.heightIn)}`;
}

/**
 * Question 2 · where the words sit on the page.
 *
 * Asked after the size, because availability depends on it: a layout with a
 * one-third text column is unreadable on a small square trim, and it says so
 * rather than disappearing. Unavailable layouts stay visible with their reason
 * — a reader who came looking for one deserves to learn why they can't have it.
 */
export function LayoutQuestion({ config, compact }: PickerProps) {
  const layoutsConfig = useAppConfigStore((s) => s.layouts);
  const update = useProjectsStore((s) => s.updateConfig);
  const artCount = useProjectsStore((s) => Object.keys(s.current()?.illustrations ?? {}).length);
  const product = bookProductForConfig(config);
  const shape = bookSizeFromAspect(product.aspect);

  const options = useMemo(
    () => resolvedLayouts(layoutsConfig, shape),
    [layoutsConfig, shape],
  );
  const selectedId = resolveLayoutById(config.layoutId, layoutsConfig).id;

  // Only one layout ships today; a picker of one is noise, so it renders as a
  // plain description until there's a real choice to make.
  const single = options.length === 1;

  return (
    <div className={cn("space-y-3", compact && "space-y-2.5")}>
      {compact ? (
        <div className="flex flex-col gap-2.5">
          {options.map((option) => {
            const availability = layoutAvailability(option, { product, config: layoutsConfig });
            const example = option.examples[0];
            return (
              <CompactMediaCard
                key={option.id}
                selected={option.id === selectedId}
                disabled={!availability.ok}
                onSelect={() => void update({ layoutId: option.id })}
                title={option.label}
                description={
                  availability.ok
                    ? option.description
                    : (availability as { reason: string }).reason
                }
                visual={
                  example ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={example.imageUrl}
                      alt={example.alt ?? `${option.label} example`}
                      className="size-full object-cover"
                    />
                  ) : (
                    <LayoutSchematic
                      layout={option.layout}
                      product={product}
                      mode={option.defaultMode}
                      className="h-full min-h-[8.5rem] w-full rounded-none bg-ink-50/80 p-3"
                    />
                  )
                }
              />
            );
          })}
        </div>
      ) : (
        <div className={cn("grid gap-3", single ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2")}>
          {options.map((option) => {
            const availability = layoutAvailability(option, { product, config: layoutsConfig });
            const example = option.examples[0];
            return (
              <OptionCard
                key={option.id}
                selected={option.id === selectedId}
                disabled={!availability.ok}
                onSelect={() => void update({ layoutId: option.id })}
                title={option.label}
                description={
                  availability.ok
                    ? option.description
                    : (availability as { reason: string }).reason
                }
                visual={
                  example ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={example.imageUrl}
                      alt={example.alt ?? `${option.label} example`}
                      className="h-20 w-full rounded-lg object-cover"
                    />
                  ) : (
                    <LayoutSchematic
                      layout={option.layout}
                      product={product}
                      mode={option.defaultMode}
                    />
                  )
                }
              />
            );
          })}
        </div>
      )}

      {artCount > 0 && !single && (
        <p className="text-xs text-ink-400">
          Changing the layout moves the story text and leaves your artwork in place — pages whose
          art was composed for the old layout are flagged so you can re-generate them.
        </p>
      )}
    </div>
  );
}

export function layoutSummary(config: BookConfig): string {
  return getBookLayout(config.layoutId).label;
}

/** Radio-style row for docked book-size picks (small shape glyph is enough). */
function CompactOptionRow({
  selected,
  onSelect,
  title,
  description,
  visual,
  disabled,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  description?: string;
  visual?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg border px-2 py-2 text-left transition",
        selected
          ? "border-brand-500 bg-brand-50/70 ring-1 ring-brand-200"
          : "border-ink-200 bg-white hover:border-brand-300",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      {visual}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold leading-snug text-ink-800">{title}</span>
        {description && (
          <span className="mt-0.5 line-clamp-2 block text-[11px] leading-snug text-ink-500">
            {description}
          </span>
        )}
      </span>
      <SelectDot selected={selected} />
    </button>
  );
}

/** Stacked card with a large preview — layout examples need room to read. */
function CompactMediaCard({
  selected,
  onSelect,
  title,
  description,
  visual,
  disabled,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  description?: string;
  visual?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex w-full flex-col overflow-hidden rounded-xl border text-left transition",
        selected
          ? "border-brand-500 bg-brand-50/50 ring-1 ring-brand-200"
          : "border-ink-200 bg-white hover:border-brand-300",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <div className="aspect-4/3 w-full overflow-hidden bg-ink-50">{visual}</div>
      <span className="flex items-start gap-2 px-2.5 py-2">
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold leading-snug text-ink-800">{title}</span>
          {description && (
            <span className="mt-0.5 line-clamp-2 block text-[11px] leading-snug text-ink-500">
              {description}
            </span>
          )}
        </span>
        <SelectDot selected={selected} />
      </span>
    </button>
  );
}

function SelectDot({ selected }: { selected: boolean }) {
  return (
    <span
      className={cn(
        "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border transition",
        selected
          ? "border-brand-500 bg-brand-500 text-white"
          : "border-ink-300 bg-white text-transparent",
      )}
    >
      <Check className="size-2.5" strokeWidth={3} />
    </span>
  );
}

/**
 * The Design flow: the decisions the pages themselves are built on.
 *
 * The page size sets the aspect every illustration is generated at, and the
 * layout decides where the words sit and what the image model is told to keep
 * clear for them. Both have to be settled before any art exists; everything
 * else about the printed object — binding, print tier, paper, cover finish —
 * leaves the pages untouched and is asked at checkout, where the page count
 * that constrains the binding is finally known.
 */
export const DESIGN_QUESTIONS: GuidedQuestion[] = [
  {
    id: "size",
    title: "Choose your book size",
    subtitle: "Real printed dimensions — this sets the shape of every page.",
    icon: Ruler,
    isAnswered: (c) => Boolean(c.productSku),
    summary: sizeSummary,
    render: (props) => <SizeQuestion {...props} />,
  },
  {
    id: "layout",
    title: "Layout",
    subtitle: "How each page divides between the story text and the illustration.",
    icon: LayoutTemplate,
    isAnswered: (c) => isKnownLayoutId(c.layoutId),
    summary: layoutSummary,
    render: (props) => <LayoutQuestion {...props} />,
  },
];
