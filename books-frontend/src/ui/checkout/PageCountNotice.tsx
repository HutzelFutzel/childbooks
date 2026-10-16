"use client";

import { FilePlus2, Info, TriangleAlert } from "lucide-react";
import type { PageTemplate } from "../../core/book/pageTemplates";
import {
  pageCountCopy,
  type PageCountAlternative,
  type PageCountPlan,
} from "../../core/print/pageCountPlan";
import { Button } from "../components/Button";
import { cn } from "../lib/cn";

/**
 * The page arithmetic, said once and plainly: "18 story pages + 2 blank = 20
 * printed pages", why, and what it does to the price.
 *
 * It never blocks. Blank pages are added at the end whatever happens; the notice
 * only makes sure the customer isn't surprised by them, and offers to put them to
 * use. A book that is too long for a binding is the one real limit, and even
 * there the way out is a single button — the nearest binding that takes the book
 * — never a dead end.
 *
 * Three tones, proportionate to what's being asked of the customer:
 *   - a page or two of rounding (`padded`): a quiet note, nothing to decide;
 *   - mostly padding (`padded-heavy`): a warning, with a better binding offered;
 *   - too long: an error, with the binding that does take it.
 */
export function PageCountNotice({
  plan,
  binding,
  alternative,
  onSwitch,
  spareTemplates = [],
  onUseSpare,
  onEditInStudio,
  className,
}: {
  plan: PageCountPlan;
  /** Binding noun for the current choice, e.g. "stapled book". */
  binding: string;
  /** A binding that fits better, when there is one. */
  alternative: PageCountAlternative | null;
  onSwitch: (sku: string) => void;
  /**
   * Pages a customer can turn a spare one into. Back-of-book only, by the
   * caller's choice: a page added at the FRONT moves every later page to the
   * other side of the spread (swapping which margin is the binding), which is
   * something to do while looking at the whole book, not from the order screen.
   */
  spareTemplates?: readonly PageTemplate[];
  onUseSpare?: (template: PageTemplate) => void;
  /** Leave checkout for the studio, for anything that needs the book in view. */
  onEditInStudio?: () => void;
  className?: string;
}) {
  if (plan.status === "exact") return null;
  const { headline, detail } = pageCountCopy(plan, binding);
  const tooLong = plan.status === "too-long";
  const heavy = plan.status === "padded-heavy";
  const tone = tooLong
    ? "border-rose-200 bg-rose-50 text-rose-700"
    : heavy
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : "border-ink-200 bg-ink-50 text-ink-700";
  const Icon = tooLong || heavy ? TriangleAlert : Info;
  const canUseSpare = !tooLong && plan.blank > 0 && spareTemplates.length > 0 && onUseSpare;

  return (
    <div
      role={tooLong ? "alert" : "note"}
      className={cn("flex items-start gap-2 rounded-xl border px-3.5 py-3 text-sm", tone, className)}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 space-y-1.5">
        <p className="font-medium">{headline}</p>
        {detail && <p className="text-xs leading-relaxed">{detail}</p>}
        {tooLong && !alternative && (
          <p className="text-xs leading-relaxed">
            No binding at this size holds a book this long. Remove some pages, or split it into two books.
          </p>
        )}
        {alternative && (
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <Button size="sm" variant="secondary" onClick={() => onSwitch(alternative.sku)}>
              Switch to {alternative.label}
            </Button>
            <span className="text-xs">
              {alternative.plan.blank === 0
                ? `Fits your book exactly — ${alternative.plan.printed} pages, no blank pages.`
                : `${alternative.plan.printed} pages, ${alternative.plan.blank} blank.`}
            </span>
          </div>
        )}
        {canUseSpare && (
          <div className="space-y-1.5 pt-1">
            <p className="text-xs font-medium">Rather not have blank pages? Use one for:</p>
            <div className="flex flex-wrap gap-1.5">
              {spareTemplates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => onUseSpare(template)}
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-white px-2 text-xs font-medium text-ink-700 shadow-sm ring-1 ring-inset ring-ink-200 transition hover:bg-ink-50"
                >
                  <FilePlus2 className="size-3.5" />
                  {template.label}
                </button>
              ))}
            </div>
            {onEditInStudio && (
              <p className="text-xs">
                Want a dedication or &ldquo;this book belongs to&rdquo; page at the front?{" "}
                <button
                  type="button"
                  onClick={onEditInStudio}
                  className="font-semibold underline underline-offset-2 hover:no-underline"
                >
                  Add it in the studio
                </button>
                .
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
