/**
 * Reading side of the "Cost per book" report: pick the books, make sure each one
 * carries a per-action cost breakdown, hand them to the pure builder.
 *
 * Why the books' own counters and not the finance stream: the mirror's
 * `cost.providerUsd` is incremented by every metered action (`recordProjectRun`),
 * with no scan cap and no time window, so "the last 800 books" is an 800-document
 * read rather than a read of up to 50 000 finance events. The report states its
 * own reconciliation against that counter, so a drift between the two shows.
 *
 * Books metered before `cost.byAction` existed are itemized here, on demand, from
 * their `actionRuns` (which are kept forever) and written back — a bounded amount
 * per request, so the first few reports tidy the history and later ones are
 * instant. The itemization never touches `providerUsd`: totals do not change, only
 * their explanation.
 */
import { getFirestore } from "firebase-admin/firestore";
import {
  MAX_BOOK_COST_COUNT,
  type BookCostQuery,
  type BookCostReport,
} from "../../books-frontend/src/core/analytics/bookCost";
import type { SparksConfig } from "../../books-frontend/src/core/config/sparks";
import { buildBookCostReport, hasSpend, orderClock, selectsBook } from "./bookCostReport";
import {
  COST_BREAKDOWN_VERSION,
  normalizeMirror,
  PROJECTS_COLLECTION,
  projectDocKey,
  type ProjectMirror,
} from "./projects";
import { ensureAdmin } from "./storage";
import type { ActionRunDoc } from "./actionRun";

/** Documents read per Firestore page while looking for the newest N matches. */
const PAGE = 400;
/** Safety cap on books examined for one report. */
const SCAN_CAP = 6000;
/** Books itemized (and written back) per report request. */
const ITEMIZE_CAP = 150;
/** Parallel itemizations. */
const ITEMIZE_PARALLEL = 8;
/** A single book with more runs than this is left alone rather than read in full. */
const RUNS_PER_BOOK_CAP = 2000;

function db() {
  ensureAdmin();
  return getFirestore();
}

interface Selected {
  mirrors: ProjectMirror[];
  noSpendExcluded: number;
  capped: boolean;
}

/**
 * The newest `count` books that pass the filters, by creation (or last activity).
 * Pages through the collection in order and stops as soon as the sample is full,
 * so a plain "last 100" reads ~100 documents and a narrow filter reads more.
 */
async function selectBooks(
  query: BookCostQuery,
  excludeUids: ReadonlySet<string> | undefined,
  now: number,
): Promise<Selected> {
  const field = query.order === "created" ? "createdAt" : "lastActionAt";
  const count = Math.min(Math.max(Math.floor(query.count), 1), MAX_BOOK_COST_COUNT);
  let base: FirebaseFirestore.Query = db().collection(PROJECTS_COLLECTION);
  if (query.range) base = base.where(field, ">=", query.range.from).where(field, "<=", query.range.to);
  base = base.orderBy(field, "desc");

  const picked: ProjectMirror[] = [];
  let scanned = 0;
  let noSpend = 0;
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  let exhausted = false;

  while (picked.length < count && scanned < SCAN_CAP) {
    let page = base.limit(PAGE);
    if (cursor) page = page.startAfter(cursor);
    const snap = await page.get();
    if (snap.empty) {
      exhausted = true;
      break;
    }
    for (const doc of snap.docs) {
      scanned += 1;
      const m = normalizeMirror(doc.data() as ProjectMirror);
      if (query.cohort !== "all" && !hasSpend(m)) noSpend += 1;
      if (selectsBook(m, { query, excludeUids, now })) {
        picked.push(m);
        if (picked.length >= count) break;
      }
    }
    cursor = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE) {
      exhausted = true;
      break;
    }
  }
  // "Capped" only when the cap, not the end of the history, stopped the search.
  const capped = picked.length < count && !exhausted && scanned >= SCAN_CAP;
  picked.sort((a, b) => orderClock(b, query.order) - orderClock(a, query.order));
  return { mirrors: picked, noSpendExcluded: noSpend, capped };
}

/**
 * Derive one older book's breakdown from its runs and the finance stream, and
 * write it onto the mirror. Returns false when it could not be done safely.
 */
async function itemizeOne(m: ProjectMirror): Promise<boolean> {
  try {
    const runsSnap = await db()
      .collection("actionRuns")
      .where("projectId", "==", m.projectId)
      .limit(RUNS_PER_BOOK_CAP + 1)
      .get();
    // A book with more runs than we will read cannot be itemized completely;
    // an incomplete map written as "complete" would be a wrong answer, so leave it.
    if (runsSnap.size > RUNS_PER_BOOK_CAP) return false;

    const byAction: Record<string, number> = {};
    let failedUsd = 0;
    let unpricedRuns = 0;
    for (const d of runsSnap.docs) {
      const run = d.data() as ActionRunDoc;
      if (run.uid !== m.uid) continue; // project ids are only unique within a user
      const usd = run.costUsd?.total ?? 0;
      if (usd > 0) byAction[run.action] = (byAction[run.action] ?? 0) + usd;
      if (run.outcome !== "ok" && usd > 0) failedUsd += usd;
      if (run.costUsd?.unpriced) unpricedRuns += 1;
    }

    // Print preparation is only in the finance stream (it is a fulfilment cost).
    let printPrepUsd = 0;
    const fin = await db()
      .collection("financeEvents")
      .where("projectId", "==", m.projectId)
      .limit(500)
      .get();
    for (const d of fin.docs) {
      const e = d.data() as { kind?: string; uid?: string; amountUsd?: number };
      if (e.kind === "printPrepCost" && e.uid === m.uid && typeof e.amountUsd === "number") {
        printPrepUsd += -e.amountUsd;
      }
    }

    const patch: Record<string, unknown> = {
      "cost.byAction": byAction,
      "cost.failedUsd": failedUsd,
      "cost.unpricedRuns": unpricedRuns,
      "cost.breakdownVersion": COST_BREAKDOWN_VERSION,
    };
    if (printPrepUsd > 0) patch["cost.printPrepUsd"] = printPrepUsd;
    await db().doc(`${PROJECTS_COLLECTION}/${projectDocKey(m.uid, m.projectId)}`).update(patch);

    m.cost = {
      ...m.cost,
      byAction,
      failedUsd,
      unpricedRuns,
      ...(printPrepUsd > 0 ? { printPrepUsd } : {}),
      breakdownVersion: COST_BREAKDOWN_VERSION,
    };
    return true;
  } catch (err) {
    console.warn("[bookCosts] could not itemize a book", m.projectId, err);
    return false;
  }
}

/**
 * Itemize the sample's older books, a bounded number per call. Mutates the
 * mirrors in place; returns how many were done.
 */
export async function ensureCostBreakdowns(mirrors: ProjectMirror[]): Promise<number> {
  const todo = mirrors.filter((m) => (m.cost?.breakdownVersion ?? 0) < COST_BREAKDOWN_VERSION).slice(0, ITEMIZE_CAP);
  let done = 0;
  for (let i = 0; i < todo.length; i += ITEMIZE_PARALLEL) {
    const results = await Promise.all(todo.slice(i, i + ITEMIZE_PARALLEL).map(itemizeOne));
    done += results.filter(Boolean).length;
  }
  return done;
}

export async function computeBookCosts(args: {
  query: BookCostQuery;
  sparks: SparksConfig;
  excludeUids?: ReadonlySet<string>;
}): Promise<BookCostReport> {
  const now = Date.now();
  const count = Math.min(Math.max(Math.floor(args.query.count), 1), MAX_BOOK_COST_COUNT);
  const query: BookCostQuery = { ...args.query, count };
  const { mirrors, noSpendExcluded, capped } = await selectBooks(query, args.excludeUids, now);
  const itemizedNow = await ensureCostBreakdowns(mirrors);
  return buildBookCostReport(mirrors, query, args.sparks, { requested: count, noSpendExcluded, itemizedNow, capped }, now);
}
