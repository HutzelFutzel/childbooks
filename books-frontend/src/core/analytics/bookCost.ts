/**
 * What a book costs to make — the shapes and vocabulary of the "Cost per book"
 * report, shared by the backend that builds it and the admin card that shows it.
 *
 * The reference value for everything here is USD of real provider spend. It is the
 * one unit that does not move with the Sparks economy: a Spark is worth something
 * different to every user (a free grant, a small pack, a large pack, a share of a
 * subscription), but a book cost the same dollars to generate whoever paid for it.
 * Sparks are reported as a conversion OF that cost, never as the measurement.
 */
import type { AnalyticsRange, StatSummary } from "./types";

/**
 * Where a book's money goes, in the order a book is made. Every action id lands in
 * exactly one of these (unknown ids fall to `other`), so the components always add
 * up to the book's total — see {@link componentOfAction}.
 */
export type BookCostComponentId =
  | "story"
  | "guide"
  | "artReading"
  | "cast"
  | "portraits"
  | "pages"
  | "covers"
  | "other"
  | "unattributed"
  | "printPrep";

export interface BookCostComponentInfo {
  id: BookCostComponentId;
  label: string;
  /** One line on what is in it, shown as a tooltip/subtitle. */
  hint: string;
  /** Text ("text") or picture ("image") spend, for the headline split. */
  modality: "text" | "image" | "mixed";
}

export const BOOK_COST_COMPONENTS: readonly BookCostComponentInfo[] = [
  {
    id: "guide",
    label: "Guide chat",
    hint: "Every message of the studio conversation: reading what the reader typed, writing the replies, answering questions, pulling the cast out of a pasted story.",
    modality: "text",
  },
  {
    id: "story",
    label: "Story & page plan",
    hint: "Drafting, refining, translating and checking the story, finding its cast, suggesting looks, and planning the pages.",
    modality: "text",
  },
  {
    id: "artReading",
    label: "Art & picture reading",
    hint: "Vision calls that read uploaded artwork, place subjects on a page or interpret an edit.",
    modality: "text",
  },
  {
    id: "cast",
    label: "Cast reference sheets",
    hint: "The reference images for each character, place and object, every redraw included.",
    modality: "image",
  },
  {
    id: "portraits",
    label: "Portraits",
    hint: "Chat-studio portraits of the people in the book.",
    modality: "image",
  },
  {
    id: "pages",
    label: "Page illustrations",
    hint: "Every page render, with its quality-control repairs, retries and edits.",
    modality: "image",
  },
  {
    id: "covers",
    label: "Cover illustrations",
    hint: "Front and back cover artwork.",
    modality: "image",
  },
  {
    id: "other",
    label: "Other AI",
    hint: "Metered AI work on this book that is none of the above.",
    modality: "mixed",
  },
  {
    id: "unattributed",
    label: "Not itemized (older books)",
    hint: "Spend the book's own total records but that has no per-action detail yet. Shrinks as older books are itemized.",
    modality: "mixed",
  },
  {
    id: "printPrep",
    label: "Print preparation",
    hint: "Upscaling the pictures to print resolution after the book was ordered. Not part of the AI total; only books that were ordered carry it.",
    modality: "image",
  },
] as const;

const ACTION_TO_COMPONENT: Record<string, BookCostComponentId> = {
  guideInterpret: "guide",
  guideSpeak: "guide",
  guideCompose: "guide",
  guideAnswer: "guide",
  guideExtractCast: "guide",
  storyDraft: "story",
  storyEdit: "story",
  storyCheck: "story",
  storyAnalysis: "story",
  anchorDescription: "story",
  screenplay: "story",
  extractArtStyle: "artReading",
  extractArtLook: "artReading",
  localize: "artReading",
  bindingPass: "artReading",
  editIntent: "artReading",
  anchorImage: "cast",
  portrait: "portraits",
  pageIllustration: "pages",
  coverIllustration: "covers",
};

/** The component an action's spend belongs to. Total over all ids: unknown → `other`. */
export function componentOfAction(action: string): BookCostComponentId {
  return ACTION_TO_COMPONENT[action] ?? "other";
}

// ---- The question ------------------------------------------------------------

/**
 * Which books count as "the last N".
 *  - `started`  — books that had at least one metered AI run. The default: a book
 *                 that was only ever opened cost nothing and says nothing about
 *                 what making one costs.
 *  - `finished` — books the reader got to the end of (finished, previewed, or
 *                 ordered): what a COMPLETE book costs, the number to size a grant
 *                 against.
 *  - `all`      — every book, zero-cost ones included.
 */
export type BookCostCohort = "started" | "finished" | "all";

/** Which clock orders the books before the newest N are taken. */
export type BookCostOrder = "created" | "active";

/** Who paid for the book's sparks. `free` = it never touched a paid Spark. */
export type BookCostFunding = "any" | "free" | "paid";

export interface BookCostQuery {
  /** How many books: the newest N after every other filter. 1–1000. */
  count: number;
  /** Alternative to count-only: restrict to a window on the ordering clock. */
  range?: AnalyticsRange;
  order: BookCostOrder;
  cohort: BookCostCohort;
  funding: BookCostFunding;
  /** Only each account's first book — what a NEW signup costs. */
  firstBookOnly: boolean;
  /** Only books idle at least this many days, so a book still being made isn't counted half-done. 0 = off. */
  settledDays: number;
  /** Leave out accounts on the admin exclusion list (staff, tests). */
  excludeStaff: boolean;
}

export const DEFAULT_BOOK_COST_QUERY: BookCostQuery = {
  count: 100,
  order: "created",
  cohort: "started",
  funding: "any",
  firstBookOnly: false,
  settledDays: 0,
  excludeStaff: true,
};

export const MAX_BOOK_COST_COUNT = 1000;

// ---- The answer --------------------------------------------------------------

export interface BookCostComponentRow {
  id: BookCostComponentId;
  label: string;
  hint: string;
  /** Spend on these books, USD. */
  totalUsd: number;
  /** Average over ALL books in the sample (books with none count as 0), so the rows add to the headline. */
  perBookUsd: number;
  /** Per page, pooled: this component's total ÷ the sample's total pages. */
  perPageUsd: number;
  /** Share of the sample's total cost, 0–1. */
  share: number;
  /** How many books had any of it. */
  booksWith: number;
}

export interface BookCostSparkReference {
  /** The Sparks economy was off or unconfigured: Spark figures are meaningless. */
  enabled: boolean;
  /** USD one Spark is listed at. */
  pegUsd: number;
  markup: number;
  /**
   * What one FREE Spark costs us: peg ÷ markup. Every price is "cost × markup ÷
   * peg" Sparks, so this is the exchange rate that does not depend on who is
   * spending — and it is the right rate to size a free grant with.
   */
  costPerFreeSparkUsd: number;
  /** Cost of the books ÷ Sparks actually charged for them: whether real spend still tracks the price list. */
  realizedCostPerChargedSparkUsd: number | null;
  /** What a Spark brings in when bought: cheapest and dearest active pack (USD per Spark). */
  packRevenuePerSpark: { min: number; max: number } | null;
}

export interface BookCostGrantCoverage {
  /** Free Sparks a fully verified account gets from the ladder. */
  grantSparks: number;
  /** What that grant costs us if it is all spent, USD. */
  grantCostUsd: number;
  /** Share of books (0–1) that cost no more than the grant's worth. */
  booksCoveredShare: number;
  /** Grant ÷ the average book (1.5 = enough for one and a half average books). */
  averageBooksCovered: number;
  /** Grant ÷ the median book. */
  medianBooksCovered: number;
  /** Free Sparks that would cover this share of books, at list prices. */
  sparksToCover: { p50: number; p75: number; p90: number };
}

export interface BookCostQuality {
  /** Books the query asked for and how many it found. `matched < requested` = the history is shorter. */
  requested: number;
  matched: number;
  /** Books left out because they had no metered run (cohort `started`/`finished`). */
  noSpendExcluded: number;
  /** Books with no page count recorded — left out of every per-page figure. */
  booksWithoutPages: number;
  /** Books with at least one run priced without a known model: their cost is a floor. */
  booksWithUnpriced: number;
  /** Books still without a per-action breakdown after this run. */
  booksNotItemized: number;
  /** Books itemized just now (written back; later reports are instant). */
  itemizedNow: number;
  /** Total of the books' own cost counter vs the sum of components — they must agree. */
  componentsReconcile: boolean;
  /** Oldest / newest book in the sample (createdAt, epoch ms). */
  oldestAt: number | null;
  newestAt: number | null;
  /** Scan ended at its safety cap before finding N matches. */
  capped: boolean;
  notes: string[];
}

export interface BookCostReport {
  generatedAt: number;
  query: BookCostQuery;
  /** Number of books the figures are over. */
  books: number;
  headline: {
    /** Average all-in cost of one book, USD. */
    perBookUsd: number;
    /** Pooled cost per page: total spend ÷ total pages. The honest per-page number. */
    perPageUsd: number;
    avgPages: number;
    totalUsd: number;
    totalPages: number;
    /** The same average book, in Sparks at today's price list. */
    perBookSparks: number;
    perPageSparks: number;
  };
  /** Cost per book across the sample (USD). 4-decimal precision. */
  perBook: StatSummary;
  /** Per-book cost per page (USD), over books with a page count. Each book weighs the same here. */
  perPage: StatSummary;
  /** Book size, in pages (illustrated units: pages plus covers). */
  pages: StatSummary;
  /** Per-book cost in Sparks at list price (cost × markup ÷ peg). */
  perBookSparks: StatSummary;
  /** Sparks actually charged per book (0 when the book was built from free grants only counts as charged too). */
  chargedSparks: StatSummary;
  components: BookCostComponentRow[];
  /** Text versus picture spend (USD, over the sample). */
  split: { imageUsd: number; textUsd: number; unsplitUsd: number };
  /** Parts of the total that are INSIDE it — not extra. */
  within: {
    /** Spend on attempts that produced nothing: failures, timeouts. */
    failedUsd: number;
    failedShare: number;
    /** Quality-control repairs and swallowed retries we absorbed (not charged to the reader). */
    absorbedUsd: number;
    absorbedShare: number;
  };
  sparks: BookCostSparkReference;
  grant: BookCostGrantCoverage;
  quality: BookCostQuality;
}
