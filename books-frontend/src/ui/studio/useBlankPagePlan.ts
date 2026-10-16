"use client";

import { useMemo } from "react";
import { bindingNoun } from "../../core/fulfillment";
import { bookProductForConfig } from "../../core/book";
import { frontMatterIsSafe } from "../../core/book/pageTemplates";
import { limitsOf, planPageCount, type PageCountPlan } from "../../core/print/pageCountPlan";
import { physicalPageCount } from "../../core/print/pagePlan";
import { getCursor } from "../../core/versioning";
import { useFormatsForConfigSize } from "../hooks/useOfferableFormats";
import { useStudio } from "./StudioContext";

export interface BlankPageInfo {
  plan: PageCountPlan;
  /** Binding noun the arithmetic is quoted for. */
  binding: string;
  /** Whether a page can safely go before the story. */
  frontSafe: boolean;
  /** Index in `spreads` just past the last page. */
  endIndex: number;
}

/**
 * The page arithmetic for the book as the editor sees it: the story's printed
 * length in the binding the project currently points at.
 *
 * The binding is only settled at checkout, where every option shows its own
 * count; this is the working figure the editor quotes meanwhile, named with the
 * binding it applies to so it never reads as a promise about another one.
 */
export function useBlankPagePlan(): BlankPageInfo | null {
  const { project } = useStudio();
  const { offerable } = useFormatsForConfigSize(project.config);
  const doc = project.screenplay ? getCursor(project.screenplay).content : null;
  return useMemo(() => {
    if (!doc || doc.spreads.length === 0) return null;
    const product = bookProductForConfig(project.config);
    const plan = planPageCount(physicalPageCount(doc), limitsOf(product, offerable.get(product.sku)));
    return {
      plan,
      binding: bindingNoun(product.binding),
      frontSafe: frontMatterIsSafe(doc.spreads),
      endIndex: doc.spreads.length,
    };
  }, [doc, project.config, offerable]);
}
