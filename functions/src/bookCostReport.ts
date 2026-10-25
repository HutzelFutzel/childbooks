/**
 * The "Cost per book" report, as a pure function of project mirrors.
 *
 * No Firestore in here on purpose: everything that decides what a book cost and
 * how it is averaged lives in this file, so `scripts/book-cost-invariants.ts` can
 * run it against hand-made books and prove the numbers add up. The reading and
 * writing of mirrors is `bookCosts.ts`.
 *
 * What one book costs (the only definition used anywhere in this report):
 *
 *     cost = mirror.cost.providerUsd      every metered provider call on the book:
 *                                         text, images, the whole guide chat, quality
 *                                         repairs, retries, failed attempts
 *          + mirror.cost.printPrepUsd     upscaling after it was ordered (if any)
 *
 * and a book's size is `derived.pageCount` — the illustrated units (pages plus the
 * covers), not printed pages.
 *
 * Two kinds of per-page number are reported and they answer different questions:
 *   - POOLED   (total cost ÷ total pages) is the headline: the cost of an average
 *     page across everything made. A long book weighs more, as it should.
 *   - PER BOOK (each book's cost ÷ its pages, then summarized) shows how the rate
 *     varies; every book weighs the same here. A 2-page test book with a $0.40
 *     cover reads very high and drags this average, which is why it is not the
 *     headline.
 */
import {
  BOOK_COST_COMPONENTS,
  componentOfAction,
  type BookCostComponentId,
  type BookCostComponentRow,
  type BookCostGrantCoverage,
  type BookCostQuery,
  type BookCostReport,
  type BookCostSparkReference,
} from "../../books-frontend/src/core/analytics/bookCost";
import { packTotalSparks, totalGrantSparks, type SparksConfig } from "../../books-frontend/src/core/config/sparks";
import type { ProjectMirror } from "./projects";
import { emptyStat, summarize } from "./stats";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Money in these figures is fractions of a cent: keep four decimals, never two. */
const USD_DIGITS = 4;
const round4 = (n: number) => Math.round(n * 10 ** USD_DIGITS) / 10 ** USD_DIGITS;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Milestones that mean the reader reached the end of the book. */
const FINISHED_MILESTONES = ["finished", "previewed", "checkoutStarted", "ordered"] as const;

export function reachedTheEnd(m: ProjectMirror): boolean {
  return FINISHED_MILESTONES.some((k) => Boolean(m.milestones?.[k]));
}

/** Did the book cost anything at all — i.e. was an AI call ever metered on it. */
export function hasSpend(m: ProjectMirror): boolean {
  return (m.counters?.runs ?? 0) > 0 || (m.cost?.providerUsd ?? 0) > 0;
}

export interface BookCostSelection {
  query: BookCostQuery;
  excludeUids?: ReadonlySet<string>;
  now: number;
}

/**
 * Whether a book belongs in the sample. Everything except the ordering window is
 * decided here (not in Firestore) because these are low-cardinality slices over a
 * page of results and each would otherwise need its own composite index.
 */
export function selectsBook(m: ProjectMirror, s: BookCostSelection): boolean {
  const q = s.query;
  if (q.excludeStaff && s.excludeUids?.has(m.uid)) return false;
  if (q.cohort !== "all" && !hasSpend(m)) return false;
  if (q.cohort === "finished" && !reachedTheEnd(m)) return false;
  if (q.funding === "free" && (m.sparks?.paid ?? 0) > 0) return false;
  if (q.funding === "paid" && !((m.sparks?.paid ?? 0) > 0)) return false;
  if (q.firstBookOnly && m.seq !== 1) return false;
  if (q.settledDays > 0 && m.lastActionAt > s.now - q.settledDays * DAY_MS) return false;
  return true;
}

/** The clock the "newest N" and the date range are measured on. */
export function orderClock(m: ProjectMirror, order: BookCostQuery["order"]): number {
  return order === "created" ? m.createdAt : m.lastActionAt;
}

export interface BookCostMeta {
  /** How many books the query asked for. */
  requested: number;
  /** Books the cohort filter dropped for having no metered run. */
  noSpendExcluded: number;
  /** Books whose per-action breakdown was derived during this request. */
  itemizedNow: number;
  /** The scan stopped at its safety cap before the sample was full. */
  capped: boolean;
}

interface BookFigures {
  m: ProjectMirror;
  totalUsd: number;
  pages: number;
  components: Map<BookCostComponentId, number>;
  /** Per-action sum minus the book's own counter. Should be ~0; positive means the itemized data over-reports. */
  drift: number;
}

/** One book's cost, split into components that always add up to its total. */
export function figuresFor(m: ProjectMirror): BookFigures {
  const aiUsd = Math.max(0, m.cost?.providerUsd ?? 0);
  const printPrep = Math.max(0, m.cost?.printPrepUsd ?? 0);
  const components = new Map<BookCostComponentId, number>();
  let attributed = 0;
  for (const [action, usd] of Object.entries(m.cost?.byAction ?? {})) {
    if (typeof usd !== "number" || !Number.isFinite(usd) || usd === 0) continue;
    const id = componentOfAction(action);
    components.set(id, (components.get(id) ?? 0) + usd);
    attributed += usd;
  }
  // Whatever the book's own counter holds that the per-action map does not: the
  // book simply has not been itemized yet. Never negative — if the map somehow
  // holds MORE than the counter, the components are shown as they are and the
  // report's reconcile flag says so, rather than quietly clipping real data.
  const remainder = aiUsd - attributed;
  if (remainder > 1e-9) components.set("unattributed", remainder);
  if (printPrep > 0) components.set("printPrep", printPrep);
  const total = Math.max(aiUsd, attributed) + printPrep;
  return { m, totalUsd: total, pages: Math.max(0, m.derived?.pageCount ?? 0), components, drift: attributed - aiUsd };
}

function sparksFromUsd(usd: number, sparks: SparksConfig): number {
  if (!(sparks.sparkValueUsd > 0)) return 0;
  return (usd * sparks.markupMultiplier) / sparks.sparkValueUsd;
}

function packRevenueRange(sparks: SparksConfig): { min: number; max: number } | null {
  const rates: number[] = [];
  for (const pack of sparks.packs ?? []) {
    if (!pack.active) continue;
    const price = pack.prices?.USD;
    const total = packTotalSparks(pack);
    if (typeof price === "number" && price > 0 && total > 0) rates.push(price / total);
  }
  if (rates.length === 0) return null;
  return { min: round4(Math.min(...rates)), max: round4(Math.max(...rates)) };
}

/** Build the report over an already-selected sample of books. */
export function buildBookCostReport(
  mirrors: ProjectMirror[],
  query: BookCostQuery,
  sparks: SparksConfig,
  meta: BookCostMeta,
  now: number,
): BookCostReport {
  const books = mirrors.map(figuresFor);
  const n = books.length;

  const totalUsd = books.reduce((a, b) => a + b.totalUsd, 0);
  const sized = books.filter((b) => b.pages > 0);
  const totalPages = sized.reduce((a, b) => a + b.pages, 0);
  const sizedUsd = sized.reduce((a, b) => a + b.totalUsd, 0);

  const perBook = n ? summarize(books.map((b) => b.totalUsd), USD_DIGITS) : emptyStat();
  const perPage = sized.length ? summarize(sized.map((b) => b.totalUsd / b.pages), USD_DIGITS) : emptyStat();
  const pages = n ? summarize(books.map((b) => b.pages), 1) : emptyStat();
  const perBookSparksStat = n ? summarize(books.map((b) => sparksFromUsd(b.totalUsd, sparks)), 1) : emptyStat();
  const chargedSparks = n ? summarize(books.map((b) => b.m.sparks?.charged ?? 0), 1) : emptyStat();

  const pooledPerPage = totalPages > 0 ? sizedUsd / totalPages : 0;
  const avgPerBook = n ? totalUsd / n : 0;

  // ---- Components --------------------------------------------------------
  const componentRows: BookCostComponentRow[] = [];
  for (const info of BOOK_COST_COMPONENTS) {
    let total = 0;
    let totalSized = 0;
    let withIt = 0;
    for (const b of books) {
      const v = b.components.get(info.id) ?? 0;
      if (v <= 0) continue;
      total += v;
      withIt += 1;
      if (b.pages > 0) totalSized += v;
    }
    if (total <= 0) continue;
    componentRows.push({
      id: info.id,
      label: info.label,
      hint: info.hint,
      totalUsd: round4(total),
      perBookUsd: round4(n ? total / n : 0),
      perPageUsd: round4(totalPages > 0 ? totalSized / totalPages : 0),
      share: totalUsd > 0 ? Math.round((total / totalUsd) * 10000) / 10000 : 0,
      booksWith: withIt,
    });
  }

  // The rows must account for the headline; if not, the report says so loudly.
  const componentSum = componentRows.reduce((a, r) => a + r.totalUsd, 0);
  const componentsReconcile =
    Math.abs(componentSum - totalUsd) <= Math.max(0.0002 * Math.max(n, 1), totalUsd * 0.0005) &&
    books.every((b) => b.drift <= 0.0005);

  // ---- Text versus pictures ---------------------------------------------
  let imageUsd = 0;
  let textUsd = 0;
  let unsplitUsd = 0;
  for (const b of books) {
    const ai = Math.max(0, b.m.cost?.providerUsd ?? 0);
    const img = Math.max(0, b.m.cost?.imageUsd ?? 0);
    const txt = Math.max(0, b.m.cost?.textUsd ?? 0);
    imageUsd += img;
    textUsd += txt;
    unsplitUsd += Math.max(0, ai - img - txt);
    // Print preparation is picture work, but it sits outside providerUsd.
    imageUsd += Math.max(0, b.m.cost?.printPrepUsd ?? 0);
  }

  // ---- What is inside the total, not on top of it -------------------------
  const failedUsd = books.reduce((a, b) => a + Math.max(0, b.m.cost?.failedUsd ?? 0), 0);
  const absorbedUsd = books.reduce((a, b) => a + Math.max(0, b.m.cost?.unbilledUsd ?? 0), 0);

  // ---- Sparks ----------------------------------------------------------------
  const costPerFreeSpark = sparks.markupMultiplier > 0 ? sparks.sparkValueUsd / sparks.markupMultiplier : 0;
  const chargedBooks = books.filter((b) => (b.m.sparks?.charged ?? 0) > 0);
  const chargedTotal = chargedBooks.reduce((a, b) => a + (b.m.sparks?.charged ?? 0), 0);
  const chargedCost = chargedBooks.reduce((a, b) => a + Math.max(0, b.m.cost?.providerUsd ?? 0), 0);
  const sparkRef: BookCostSparkReference = {
    enabled: sparks.enabled,
    pegUsd: sparks.sparkValueUsd,
    markup: sparks.markupMultiplier,
    costPerFreeSparkUsd: round4(costPerFreeSpark),
    realizedCostPerChargedSparkUsd: chargedTotal > 0 ? round4(chargedCost / chargedTotal) : null,
    packRevenuePerSpark: packRevenueRange(sparks),
  };

  const grantSparks = totalGrantSparks(sparks);
  const grantCostUsd = grantSparks * costPerFreeSpark;
  const covered = books.filter((b) => b.totalUsd <= grantCostUsd + 1e-9).length;
  const grant: BookCostGrantCoverage = {
    grantSparks,
    grantCostUsd: round4(grantCostUsd),
    booksCoveredShare: n ? Math.round((covered / n) * 10000) / 10000 : 0,
    averageBooksCovered: avgPerBook > 0 ? round2(grantCostUsd / avgPerBook) : 0,
    medianBooksCovered: perBook.median > 0 ? round2(grantCostUsd / perBook.median) : 0,
    sparksToCover: {
      p50: Math.ceil(perBookSparksStat.median),
      p75: Math.ceil(perBookSparksStat.p75),
      p90: Math.ceil(perBookSparksStat.p90),
    },
  };

  // ---- Quality flags -----------------------------------------------------------
  const notItemized = books.filter((b) => !b.m.cost?.breakdownVersion).length;
  const withUnpriced = books.filter((b) => (b.m.cost?.unpricedRuns ?? 0) > 0).length;
  const created = books.map((b) => b.m.createdAt).filter((t) => typeof t === "number" && t > 0);
  const notes: string[] = [];
  if (n < meta.requested) {
    notes.push(`Only ${n} book${n === 1 ? "" : "s"} match; you asked for ${meta.requested}. The history is shorter than that, or the filters are narrow.`);
  }
  if (meta.capped) {
    notes.push("The scan stopped before the sample was full, so it covers the most recent books only.");
  }
  if (withUnpriced > 0) {
    notes.push(`${withUnpriced} book${withUnpriced === 1 ? "" : "s"} used a model with no price on file, so their cost is a floor. Add the model to the cost table.`);
  }
  if (notItemized > 0) {
    notes.push(`${notItemized} older book${notItemized === 1 ? " has" : "s have"} no per-action detail yet; their spend shows under "Not itemized". Totals are unaffected.`);
  }
  if (sized.length < n) {
    notes.push(`${n - sized.length} book${n - sized.length === 1 ? " has" : "s have"} no page count and ${n - sized.length === 1 ? "is" : "are"} left out of the per-page figures.`);
  }
  if (!componentsReconcile) {
    notes.push("The components do not add up to the total. Treat the breakdown as approximate and check the per-action data.");
  }

  return {
    generatedAt: now,
    query,
    books: n,
    headline: {
      perBookUsd: round4(avgPerBook),
      perPageUsd: round4(pooledPerPage),
      avgPages: n ? round2(books.reduce((a, b) => a + b.pages, 0) / n) : 0,
      totalUsd: round4(totalUsd),
      totalPages,
      perBookSparks: round2(sparksFromUsd(avgPerBook, sparks)),
      perPageSparks: round2(sparksFromUsd(pooledPerPage, sparks)),
    },
    perBook,
    perPage,
    pages,
    perBookSparks: perBookSparksStat,
    chargedSparks,
    components: componentRows,
    split: { imageUsd: round4(imageUsd), textUsd: round4(textUsd), unsplitUsd: round4(unsplitUsd) },
    within: {
      failedUsd: round4(failedUsd),
      failedShare: totalUsd > 0 ? Math.round((failedUsd / totalUsd) * 10000) / 10000 : 0,
      absorbedUsd: round4(absorbedUsd),
      absorbedShare: totalUsd > 0 ? Math.round((absorbedUsd / totalUsd) * 10000) / 10000 : 0,
    },
    sparks: sparkRef,
    grant,
    quality: {
      requested: meta.requested,
      matched: n,
      noSpendExcluded: meta.noSpendExcluded,
      booksWithoutPages: n - sized.length,
      booksWithUnpriced: withUnpriced,
      booksNotItemized: notItemized,
      itemizedNow: meta.itemizedNow,
      componentsReconcile,
      oldestAt: created.length ? Math.min(...created) : null,
      newestAt: created.length ? Math.max(...created) : null,
      capped: meta.capped,
      notes,
    },
  };
}
