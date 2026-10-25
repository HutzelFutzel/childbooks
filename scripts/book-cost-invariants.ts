/**
 * Book-cost invariants — the properties that make "what does a book cost" a number
 * you can size a free-Spark grant with, checked against the real report builder.
 *
 * Run by `yarn check:book-costs`, which bundles this with esbuild first.
 */
import { ALL_IMAGE_ACTION_IDS, ALL_TEXT_ACTION_IDS } from "../books-frontend/src/core/ai/actions";
import {
  BOOK_COST_COMPONENTS,
  componentOfAction,
  DEFAULT_BOOK_COST_QUERY,
  type BookCostQuery,
} from "../books-frontend/src/core/analytics/bookCost";
import { createDefaultSparksConfig, totalGrantSparks } from "../books-frontend/src/core/config/sparks";
import {
  buildBookCostReport,
  figuresFor,
  reachedTheEnd,
  selectsBook,
} from "../functions/src/bookCostReport";
import { mergeDerived } from "../functions/src/mirrorDerived";
import type { ProjectDerived, ProjectMirror } from "../functions/src/projects";

const failures: string[] = [];
const checks: string[] = [];
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) checks.push(name);
  else failures.push(`${name}${detail ? `: ${detail}` : ""}`);
}
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

const SPARKS = createDefaultSparksConfig();
const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

interface BookSpec {
  uid?: string;
  seq?: number;
  pages: number;
  providerUsd: number;
  byAction?: Record<string, number>;
  itemized?: boolean;
  printPrepUsd?: number;
  failedUsd?: number;
  unbilledUsd?: number;
  unpricedRuns?: number;
  imageUsd?: number;
  textUsd?: number;
  chargedSparks?: number;
  paidSparks?: number;
  milestones?: ProjectMirror["milestones"];
  createdAt?: number;
  lastActionAt?: number;
  runs?: number;
}

let counter = 0;
function book(s: BookSpec): ProjectMirror {
  counter += 1;
  return {
    projectId: `p${counter}`,
    uid: s.uid ?? `u${counter}`,
    seq: s.seq ?? 1,
    createdAt: s.createdAt ?? NOW - counter * DAY,
    firstActionAt: NOW - counter * DAY,
    lastActionAt: s.lastActionAt ?? NOW - counter * DAY,
    derived: {
      pageCount: s.pages,
      illustratedCount: s.pages,
      illustrationVersions: s.pages,
      screenplayVersions: 1,
      anchors: { total: 0, character: 0, place: 0, object: 0 },
    },
    milestones: s.milestones ?? {},
    counters: {
      runs: s.runs ?? 1,
      fresh: 1,
      edits: 0,
      variations: 0,
      restyles: 0,
      failures: 0,
      imagesGenerated: 0,
      qcCalls: 0,
      byAction: {},
      byTier: {},
      imagesByModel: {},
      imagesByAction: {},
    },
    models: { imageModels: [] },
    cost: {
      providerUsd: s.providerUsd,
      billedUsd: s.providerUsd,
      unbilledUsd: s.unbilledUsd ?? 0,
      ...(s.imageUsd !== undefined ? { imageUsd: s.imageUsd } : {}),
      ...(s.textUsd !== undefined ? { textUsd: s.textUsd } : {}),
      ...(s.byAction ? { byAction: s.byAction } : {}),
      ...(s.itemized ? { breakdownVersion: 1 } : {}),
      ...(s.printPrepUsd ? { printPrepUsd: s.printPrepUsd } : {}),
      ...(s.failedUsd ? { failedUsd: s.failedUsd } : {}),
      ...(s.unpricedRuns ? { unpricedRuns: s.unpricedRuns } : {}),
    },
    sparks: { charged: s.chargedSparks ?? 0, paid: s.paidSparks ?? 0, free: 0, byLotSource: {} },
    timing: {},
  };
}

const META = { requested: 100, noSpendExcluded: 0, itemizedNow: 0, capped: false };
const QUERY: BookCostQuery = { ...DEFAULT_BOOK_COST_QUERY };
const report = (books: ProjectMirror[], meta = META) => buildBookCostReport(books, QUERY, SPARKS, meta, NOW);

// ---- Every action lands somewhere, and nothing book-related is "other" ----------

{
  const notBook = new Set(["releaseNotes", "logAnalysis"]);
  const strays = [...ALL_TEXT_ACTION_IDS, ...ALL_IMAGE_ACTION_IDS].filter(
    (id) => !notBook.has(id) && componentOfAction(id) === "other",
  );
  check("every book-related AI action belongs to a named cost component", strays.length === 0, strays.join(", "));
  check("an unknown action id falls to 'other' rather than vanishing", componentOfAction("somethingNew") === "other");
  const ids = new Set<string>(BOOK_COST_COMPONENTS.map((c) => c.id));
  check(
    "every component an action can map to is declared in the component list",
    [...ALL_TEXT_ACTION_IDS, ...ALL_IMAGE_ACTION_IDS].every((id) => ids.has(componentOfAction(id))),
  );
}

// ---- Components add up to the total, however the book was itemized -------------

{
  const itemized = book({
    pages: 10,
    providerUsd: 1.0,
    itemized: true,
    byAction: { guideCompose: 0.05, guideInterpret: 0.03, storyDraft: 0.07, screenplay: 0.1, anchorImage: 0.15, pageIllustration: 0.55, coverIllustration: 0.05 },
  });
  const legacy = book({ pages: 8, providerUsd: 0.6 }); // no breakdown at all
  const partial = book({ pages: 5, providerUsd: 0.5, byAction: { pageIllustration: 0.2 } }); // itemized only partly
  const ordered = book({
    pages: 12,
    providerUsd: 0.9,
    itemized: true,
    byAction: { pageIllustration: 0.9 },
    printPrepUsd: 0.12,
    milestones: { ordered: NOW },
  });
  const r = report([itemized, legacy, partial, ordered]);
  const componentTotal = r.components.reduce((a, c) => a + c.totalUsd, 0);
  check("component totals add up to the headline total (itemized, legacy, partial and ordered books together)", near(componentTotal, r.headline.totalUsd, 1e-3), `${componentTotal} vs ${r.headline.totalUsd}`);
  check("components reconcile flag is true for consistent data", r.quality.componentsReconcile === true);
  check("a book with no breakdown shows its spend as 'not itemized', not as zero", r.components.find((c) => c.id === "unattributed")?.totalUsd !== undefined && near(r.components.find((c) => c.id === "unattributed")!.totalUsd, 0.6 + 0.3, 1e-3));
  check("print preparation is added on top of the book's AI total", near(r.headline.totalUsd, 1.0 + 0.6 + 0.5 + 0.9 + 0.12, 1e-3), String(r.headline.totalUsd));
  check("print preparation is its own component", near(r.components.find((c) => c.id === "printPrep")?.totalUsd ?? 0, 0.12, 1e-4));
  const perBookSum = r.components.reduce((a, c) => a + c.perBookUsd, 0);
  check("component per-book averages sum to the headline per-book cost", near(perBookSum, r.headline.perBookUsd, 2e-4), `${perBookSum} vs ${r.headline.perBookUsd}`);
  const perPageSum = r.components.reduce((a, c) => a + c.perPageUsd, 0);
  check("component per-page figures sum to the headline per-page cost", near(perPageSum, r.headline.perPageUsd, 3e-4), `${perPageSum} vs ${r.headline.perPageUsd}`);
  check("shares sum to 1", near(r.components.reduce((a, c) => a + c.share, 0), 1, 2e-3));
  check("booksNotItemized counts exactly the books without a breakdown marker", r.quality.booksNotItemized === 2);
  check("figuresFor never makes a component negative", [...figuresFor(partial).components.values()].every((v) => v >= 0));
}

{
  // The itemized data claims more than the book's own counter: say so.
  const over = book({ pages: 4, providerUsd: 0.2, itemized: true, byAction: { pageIllustration: 0.5 } });
  const r = report([over]);
  check("itemized data exceeding the book's counter is flagged, not hidden", r.quality.componentsReconcile === false);
}

// ---- Per page is pooled, not a mean of ratios ----------------------------------

{
  const tiny = book({ pages: 2, providerUsd: 0.4 });
  const big = book({ pages: 20, providerUsd: 1.0 });
  const r = report([tiny, big]);
  check("the headline cost per page is total cost ÷ total pages", near(r.headline.perPageUsd, 1.4 / 22, 1e-4), String(r.headline.perPageUsd));
  check("the per-book per-page mean is reported separately and differs on lopsided data", r.perPage.avg > r.headline.perPageUsd * 1.5);
  check("average cost per book is total ÷ books", near(r.headline.perBookUsd, 0.7, 1e-4));
  check("average pages per book is reported", near(r.headline.avgPages, 11, 1e-6));
}

{
  const noPages = book({ pages: 0, providerUsd: 0.3 });
  const sized = book({ pages: 10, providerUsd: 0.5 });
  const r = report([noPages, sized]);
  check("a book with no page count counts toward cost per book but not cost per page", near(r.headline.perBookUsd, 0.4, 1e-4) && near(r.headline.perPageUsd, 0.05, 1e-4));
  check("books without a page count are reported", r.quality.booksWithoutPages === 1);
}

// ---- Distribution ---------------------------------------------------------------

{
  const books = Array.from({ length: 100 }, (_, i) => book({ pages: 10, providerUsd: (i + 1) / 100 }));
  const r = report(books);
  check("percentiles of cost per book are ordered", r.perBook.min <= r.perBook.p25 && r.perBook.p25 <= r.perBook.median && r.perBook.median <= r.perBook.p75 && r.perBook.p75 <= r.perBook.p90 && r.perBook.p90 <= r.perBook.p95 && r.perBook.p95 <= r.perBook.max);
  check("median / p90 / p95 of 1..100 cents are 0.50 / 0.90 / 0.95", near(r.perBook.median, 0.5, 1e-4) && near(r.perBook.p90, 0.9, 1e-4) && near(r.perBook.p95, 0.95, 1e-4));
  check("fractions of a cent survive the rounding", near(report([book({ pages: 10, providerUsd: 0.00123 })]).perBook.avg, 0.0012, 1e-9));
}

// ---- What is inside the total, not on top of it ---------------------------------

{
  const r = report([book({ pages: 5, providerUsd: 1.0, failedUsd: 0.2, unbilledUsd: 0.3, imageUsd: 0.8, textUsd: 0.2 })]);
  check("failed spend is reported as part of the total, not added to it", near(r.headline.totalUsd, 1.0) && near(r.within.failedUsd, 0.2) && near(r.within.failedShare, 0.2));
  check("absorbed (quality-repair) spend is reported as part of the total", near(r.within.absorbedUsd, 0.3));
  check("image and text split adds to the book's AI total", near(r.split.imageUsd + r.split.textUsd + r.split.unsplitUsd, 1.0, 1e-4));
  const legacy = report([book({ pages: 5, providerUsd: 1.0 })]);
  check("a book with no image/text split reports it as unsplit rather than inventing one", near(legacy.split.unsplitUsd, 1.0));
  const withPrint = report([book({ pages: 5, providerUsd: 1.0, imageUsd: 1.0, textUsd: 0, printPrepUsd: 0.1 })]);
  check("print preparation counts as picture spend in the split", near(withPrint.split.imageUsd, 1.1, 1e-4));
}

{
  const r = report([book({ pages: 5, providerUsd: 1, unpricedRuns: 2 })]);
  check("books with an unpriced model are flagged (their cost is a floor)", r.quality.booksWithUnpriced === 1 && r.quality.notes.some((n) => /no price/.test(n)));
}

// ---- Sparks: a conversion of the cost, never the measurement --------------------

{
  const r = report([book({ pages: 10, providerUsd: 0.8, chargedSparks: 100 })]);
  const expected = (0.8 * SPARKS.markupMultiplier) / SPARKS.sparkValueUsd;
  check("a book's cost in Sparks is cost × markup ÷ peg", near(r.headline.perBookSparks, expected, 0.01), `${r.headline.perBookSparks} vs ${expected}`);
  check("a free Spark costs peg ÷ markup", near(r.sparks.costPerFreeSparkUsd, SPARKS.sparkValueUsd / SPARKS.markupMultiplier, 1e-4));
  check("realized cost per charged Spark is cost ÷ Sparks charged", r.sparks.realizedCostPerChargedSparkUsd !== null && near(r.sparks.realizedCostPerChargedSparkUsd, 0.008, 1e-4));
  check("realized cost per Spark is null when nothing was charged", report([book({ pages: 10, providerUsd: 0.8 })]).sparks.realizedCostPerChargedSparkUsd === null);
}

{
  const grant = totalGrantSparks(SPARKS);
  const grantUsd = (grant * SPARKS.sparkValueUsd) / SPARKS.markupMultiplier;
  const cheap = book({ pages: 10, providerUsd: grantUsd * 0.5 });
  const exact = book({ pages: 10, providerUsd: grantUsd });
  const dear = book({ pages: 10, providerUsd: grantUsd * 2 });
  const r = report([cheap, exact, dear]);
  check("grant coverage counts books at or under the grant's worth", near(r.grant.booksCoveredShare, 2 / 3, 1e-3), String(r.grant.booksCoveredShare));
  check("grant coverage is the grant divided by the average book", near(r.grant.averageBooksCovered, grantUsd / ((grantUsd * 3.5) / 3), 0.01));
  check("sparks needed to cover p90 is at least the median's", r.grant.sparksToCover.p90 >= r.grant.sparksToCover.p50);
}

// ---- Empty and degenerate samples never produce NaN -----------------------------

{
  const r = report([], { ...META, requested: 50 });
  const flat = JSON.stringify(r);
  check("an empty sample produces no NaN or Infinity", !/NaN|Infinity/.test(flat) && !flat.includes("null,\"p25\""));
  check("an empty sample says the history is shorter than asked", r.quality.notes.some((n) => /Only 0 books match/.test(n)));
  const zero = report([book({ pages: 0, providerUsd: 0, runs: 0 })]);
  check("a zero-cost, zero-page book does not divide by zero", !/NaN|Infinity/.test(JSON.stringify(zero)));
}

// ---- Who is in the sample -------------------------------------------------------

{
  const sel = (m: ProjectMirror, q: Partial<BookCostQuery>, excl?: string[]) =>
    selectsBook(m, { query: { ...DEFAULT_BOOK_COST_QUERY, ...q }, excludeUids: excl ? new Set(excl) : undefined, now: NOW });
  const idle = book({ pages: 5, providerUsd: 0.3, runs: 0 });
  idle.cost.providerUsd = 0;
  check("default cohort leaves out books that never made an AI call", !sel(idle, {}) && sel(idle, { cohort: "all" }));
  const started = book({ pages: 5, providerUsd: 0.3 });
  const done = book({ pages: 5, providerUsd: 0.3, milestones: { previewed: NOW } });
  check("the finished cohort needs a finished/previewed/ordered milestone", !sel(started, { cohort: "finished" }) && sel(done, { cohort: "finished" }) && reachedTheEnd(done));
  const free = book({ pages: 5, providerUsd: 0.3, paidSparks: 0 });
  const paid = book({ pages: 5, providerUsd: 0.3, paidSparks: 20 });
  check("funding filter separates books that touched a paid Spark", sel(free, { funding: "free" }) && !sel(paid, { funding: "free" }) && sel(paid, { funding: "paid" }) && !sel(free, { funding: "paid" }));
  check("first-book-only keeps only each account's first book", sel(book({ pages: 5, providerUsd: 0.3, seq: 1 }), { firstBookOnly: true }) && !sel(book({ pages: 5, providerUsd: 0.3, seq: 2 }), { firstBookOnly: true }));
  const fresh = book({ pages: 5, providerUsd: 0.3, lastActionAt: NOW - DAY });
  const settled = book({ pages: 5, providerUsd: 0.3, lastActionAt: NOW - 10 * DAY });
  check("settled-days leaves out books still being made", !sel(fresh, { settledDays: 3 }) && sel(settled, { settledDays: 3 }));
  const staff = book({ pages: 5, providerUsd: 0.3, uid: "staff" });
  check("staff accounts are excluded unless asked for", !sel(staff, {}, ["staff"]) && sel(staff, { excludeStaff: false }, ["staff"]));
}

// ---- A thin snapshot can't wipe what a fuller one established --------------------

{
  const existing: ProjectDerived = {
    pageCount: 14,
    illustratedCount: 9,
    illustrationVersions: 20,
    screenplayVersions: 3,
    anchors: { total: 2, character: 2, place: 0, object: 0 },
  };
  const slim: ProjectDerived = { ...existing, pageCount: 0, illustratedCount: 1, illustrationVersions: 1, screenplayVersions: 0 };
  const merged = mergeDerived(existing, slim, { screenplay: undefined });
  check("a text-only snapshot (no screenplay) keeps the stored page count", merged.pageCount === 14 && merged.screenplayVersions === 3);
  check("a render snapshot carrying one illustration does not shrink the illustrated count", merged.illustratedCount === 9 && merged.illustrationVersions === 20);
  const full = mergeDerived(existing, { ...slim, pageCount: 16, screenplayVersions: 4 }, { screenplay: {} as never });
  check("a snapshot WITH a screenplay may change the page count (a real edit)", full.pageCount === 16 && full.screenplayVersions === 4);
  check("the first snapshot is taken as it is", mergeDerived(undefined, slim, { screenplay: undefined }).pageCount === 0);
}

// ---- Report ----------------------------------------------------------------

for (const name of checks) console.log(`  ok   ${name}`);
for (const failure of failures) console.error(`  FAIL ${failure}`);
console.log(`\n${checks.length} passed, ${failures.length} failed.`);
process.exit(failures.length > 0 ? 1 : 0);
