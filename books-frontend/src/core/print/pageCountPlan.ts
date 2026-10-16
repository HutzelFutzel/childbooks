/**
 * How a book's page count becomes a printed page count — one pure answer shared
 * by the editor, the format picker, the order summary and the server.
 *
 * A bindery only takes certain lengths: a stapled book is folded from sheets of
 * four pages, a perfect-bound or hardcover book from two-sided leaves, and every
 * binding has a minimum and a maximum. A story rarely lands on one of those, so
 * the difference is made up with blank pages at the end. That has to be (a)
 * never a reason an order fails, and (b) never a surprise on the customer's
 * bill, which is why the arithmetic lives here once and every surface quotes it:
 *
 *     18 story pages + 2 blank = 20 printed pages
 *
 * The only length that can't be printed in a binding is one ABOVE its maximum;
 * even then a sibling binding that takes it is offered ({@link bestAlternative}),
 * so there is always a way to order.
 */

export interface PageLimits {
  /** Fewest printed pages the binding accepts. */
  min: number;
  /** Most printed pages the binding accepts. */
  max: number;
  /** Printed pages come in multiples of this (4 = stapled sheets, 2 = leaves). */
  step: number;
}

export type PageCountStatus =
  /** The story already is a printable length. */
  | "exact"
  /** A few blank pages at the end bring it to a printable length. */
  | "padded"
  /** Blank pages would be a noticeable share of the book — worth offering a better binding. */
  | "padded-heavy"
  /** Longer than this binding can hold. */
  | "too-long";

export interface PageCountPlan {
  /** Pages the story itself fills (spreads count as two, pagination fillers as one). */
  story: number;
  /** What the printer is asked for — and what is priced. */
  printed: number;
  /** Blank pages added at the end: `printed - story`. */
  blank: number;
  /** Why blanks are needed: the sheet size, or the binding's minimum. */
  reason: "sheet" | "minimum" | null;
  status: PageCountStatus;
  limits: PageLimits;
}

/** Blank pages above this share of the book, and at least {@link HEAVY_MIN_BLANKS}, read as padding rather than finishing. */
const HEAVY_SHARE = 0.25;
const HEAVY_MIN_BLANKS = 4;

/**
 * The limits that apply to a format: the admin catalog entry when there is one
 * (it can narrow what we sell, and the server enforces its numbers), else the
 * provider catalog's own.
 */
export function limitsOf(
  format: { minPages: number; maxPages: number; pageStep: number },
  entry?: { conditions: { pages: PageLimits } } | null,
): PageLimits {
  const pages = entry?.conditions.pages;
  return {
    min: pages?.min ?? format.minPages,
    max: pages?.max ?? format.maxPages,
    step: pages?.step ?? format.pageStep,
  };
}

/** Smallest printed length ≥ `story` that satisfies the binding's step and minimum. */
export function printedPageCount(story: number, limits: PageLimits): number {
  const step = Math.max(1, Math.floor(limits.step) || 1);
  const want = Math.max(limits.min, Math.floor(story), 1);
  return Math.ceil(want / step) * step;
}

/** Work out the printed length for a story length in one binding. Pure. */
export function planPageCount(storyPages: number, limits: PageLimits): PageCountPlan {
  const story = Math.max(0, Math.floor(storyPages));
  const step = Math.max(1, Math.floor(limits.step) || 1);
  const printed = printedPageCount(story, limits);

  if (printed > limits.max) {
    // Report the longest length the binding could print so callers can still
    // show a sensible number; the status is what says it can't take this book.
    const longest = Math.max(step, Math.floor(limits.max / step) * step);
    return { story, printed: longest, blank: 0, reason: null, status: "too-long", limits };
  }

  const blank = printed - story;
  if (blank === 0) return { story, printed, blank, reason: null, status: "exact", limits };

  const heavy = blank >= HEAVY_MIN_BLANKS && blank / printed > HEAVY_SHARE;
  return {
    story,
    printed,
    blank,
    reason: story < limits.min ? "minimum" : "sheet",
    status: heavy ? "padded-heavy" : "padded",
    limits,
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export interface PageCountCopy {
  /** The arithmetic, in one line. Empty when nothing needs explaining. */
  headline: string;
  /** Why, and what it means for the price. */
  detail: string;
}

/**
 * The words for a plan. `binding` is the noun for the binding ("stapled book",
 * "hardcover"). One wording for every surface, so what the editor says is what
 * the order summary says.
 */
export function pageCountCopy(plan: PageCountPlan, binding: string): PageCountCopy {
  const { story, printed, blank, limits } = plan;
  if (plan.status === "too-long") {
    return {
      headline: `${plural(story, "page", "pages")} is too long for a ${binding}`,
      detail: `A ${binding} holds up to ${limits.max} pages.`,
    };
  }
  if (blank === 0) {
    return { headline: `${plural(printed, "page", "pages")}, no blank pages`, detail: "" };
  }
  const headline = `${plural(story, "story page", "story pages")} + ${blank} blank = ${plural(
    printed,
    "printed page",
    "printed pages",
  )}`;
  const why =
    plan.reason === "minimum"
      ? `A ${binding} needs at least ${limits.min} pages.`
      : limits.step >= 4
        ? `A ${binding} is made in sheets of ${limits.step} pages.`
        : `A ${binding} is printed on two-sided sheets, so the page count is always even.`;
  return {
    headline,
    detail: `${why} The ${plural(blank, "blank page", "blank pages")} ${
      blank === 1 ? "is" : "are"
    } added at the end. The price is for ${printed} pages.`,
  };
}

export interface PageCountCandidate {
  sku: string;
  /** Binding noun, e.g. "paperback". */
  label: string;
  limits: PageLimits;
}

export interface PageCountAlternative {
  sku: string;
  label: string;
  plan: PageCountPlan;
}

/**
 * The sibling binding to point a customer at when the current one is a poor fit
 * (too long, or mostly blank pages). `null` when the current binding is already
 * the best available, or no other one takes the book.
 *
 * Fewest blank pages wins; the first candidate wins a tie, so the caller's
 * ordering (the admin's sort order) decides between equals.
 */
export function bestAlternative(
  storyPages: number,
  currentSku: string,
  candidates: readonly PageCountCandidate[],
): PageCountAlternative | null {
  const current = candidates.find((c) => c.sku === currentSku);
  const currentPlan = current ? planPageCount(storyPages, current.limits) : null;
  let best: PageCountAlternative | null = null;
  for (const c of candidates) {
    if (c.sku === currentSku) continue;
    const plan = planPageCount(storyPages, c.limits);
    if (plan.status === "too-long") continue;
    if (!best || plan.blank < best.plan.blank) best = { sku: c.sku, label: c.label, plan };
  }
  if (!best) return null;
  if (!currentPlan || currentPlan.status === "too-long") return best;
  // Only worth interrupting someone for a real improvement.
  return currentPlan.status === "padded-heavy" && best.plan.blank < currentPlan.blank ? best : null;
}
