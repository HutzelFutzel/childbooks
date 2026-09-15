/**
 * The wizard against the guide, on real books.
 *
 * Phase 8 of the guided-studio migration is a decision, not a feature: keep
 * ramping the new flow, or fix something first. This is the evidence for it, and
 * the whole design follows from one thing — the numbers here will be used to
 * argue for a change that is hard to reverse, so every way they could flatter one
 * side has to be closed off deliberately rather than left to whoever reads them.
 *
 * Three of those, in order of how easily they would have gone unnoticed:
 *
 *   1. **Mixed books are excluded.** A book worked on in both flows carries one's
 *      draft and the other's illustrations. Counting it in either arm imports the
 *      other flow's output as evidence for this one, and mixed books are
 *      disproportionately the ones an admin opened *specifically to compare* — so
 *      the contamination would land hardest on exactly the books being studied.
 *      `flowArm` reports them as `mixed`, and they are reported as their own row so
 *      the exclusion is visible instead of just quietly shrinking the sample.
 *
 *   2. **Completion is a rate, not a duration.** "Time to first draft" measured
 *      only over books that reached a draft rewards a flow that loses people
 *      early: the survivors are faster because the strugglers are gone. So every
 *      duration is published beside the count that produced it, and the funnel
 *      shows how many books of each arm reached each stage.
 *
 *   3. **The arms are not comparable by default.** An admin-only rollout means
 *      the guide arm is admins and the wizard arm is customers, which is a
 *      difference in who, not in what. Nothing here can fix that; what it can do
 *      is say so, which {@link FlowComparison.caveats} does.
 *
 * Everything about how a book was made is measured by reusing `summarizeProjects`
 * per arm rather than recomputing anything, so this page cannot disagree with the
 * Projects tab. Only what is genuinely new lives here: the grouping, the turn log
 * aggregation (which exists for the guide alone), and the caveats.
 *
 * Retired with the comparison (see docs/LEGACY-GUIDE.md).
 */
import { getFirestore } from "firebase-admin/firestore";
import { ensureAdmin } from "./storage";
import {
  listProjectMirrors,
  projectFinanceIndex,
  summarizeProjects,
  type ProjectMirror,
} from "./projects";
import { emptyStat, rate, summarize } from "./stats";
import { flowArm, isComparable, type FlowArm } from "../../books-frontend/src/core/guide/flow";
import { GUIDE_COMPONENT_IDS } from "../../books-frontend/src/core/guide/components";
// The wire shapes live in core, where the client reads them from too, so this
// module owns the aggregation and not the contract.
import type {
  FlowArmReport,
  FlowComparison,
  FlowTurnStats,
} from "../../books-frontend/src/core/analytics/types";

export type { FlowArmReport, FlowComparison, FlowTurnStats };

/**
 * Below this, the interpreter is telling us it was guessing.
 *
 * A threshold rather than an average confidence, because the average is dominated
 * by the easy turns ("Maya, she's five") and moves barely at all when the hard
 * ones get worse. The share of turns the model was unsure about is the number that
 * actually changes when a prompt regresses.
 */
const AMBIGUOUS_BELOW = 0.6;

/** Cap on turn-log documents read per report, so one chatty book can't stall it. */
const MAX_TURNS = 20_000;

function emptyTurnStats(): FlowTurnStats {
  return {
    turns: 0,
    books: 0,
    perBook: emptyStat(),
    latencyMs: emptyStat(),
    ambiguityRate: 0,
    skipRate: 0,
    byIntent: {},
    lastComponent: {},
    byComponent: {},
    truncated: false,
  };
}

/**
 * Aggregate the guide's turn log across users.
 *
 * A `collectionGroup` read, because the log is a per-user subcollection —
 * deliberately, so it lives inside the user tree that erasure deletes wholesale.
 * The cost of that choice is paid here rather than by weakening the privacy shape.
 *
 * Reads only what it needs to count. The `message` and `reply` fields are the
 * reader's own words and the point of the log for debugging a complaint, but they
 * have no place in an aggregate — so nothing here touches them, and none of them
 * can end up in the response.
 */
export async function summarizeGuideTurns(fromMs: number, toMs: number): Promise<FlowTurnStats> {
  ensureAdmin();
  const snap = await getFirestore()
    .collectionGroup("guideTurns")
    .where("createdAt", ">=", fromMs)
    .where("createdAt", "<=", toMs)
    .orderBy("createdAt", "asc")
    .limit(MAX_TURNS + 1)
    .get();

  const stats = emptyTurnStats();
  stats.truncated = snap.size > MAX_TURNS;
  const docs = stats.truncated ? snap.docs.slice(0, MAX_TURNS) : snap.docs;

  const perBook = new Map<string, number>();
  /** Book → the last component it was heard from, by `createdAt`. */
  const lastSeen = new Map<string, { at: number; component: string }>();
  const latencies: number[] = [];
  let ambiguous = 0;
  let skipped = 0;

  for (const doc of docs) {
    const d = doc.data() as Record<string, unknown>;
    // Scoped per user: project ids are minted client-side and are only unique
    // within a user's own space, so a bare projectId would merge two people's
    // books and undercount both.
    const uid = doc.ref.parent.parent?.id ?? "";
    const projectId = typeof d.projectId === "string" ? d.projectId : "";
    if (!uid || !projectId) continue;
    const book = `${uid}__${projectId}`;

    stats.turns += 1;
    perBook.set(book, (perBook.get(book) ?? 0) + 1);

    const intent = typeof d.intent === "string" ? d.intent : "unknown";
    stats.byIntent[intent] = (stats.byIntent[intent] ?? 0) + 1;

    const component = typeof d.componentId === "string" ? d.componentId : "";
    if (component) {
      stats.byComponent[component] = (stats.byComponent[component] ?? 0) + 1;
      const at = typeof d.createdAt === "number" ? d.createdAt : 0;
      const prev = lastSeen.get(book);
      if (!prev || at >= prev.at) lastSeen.set(book, { at, component });
    }

    // Absent confidence is not counted as confident: a turn the log couldn't
    // describe should not improve the score.
    if (typeof d.confidence === "number" && d.confidence < AMBIGUOUS_BELOW) ambiguous += 1;
    if (d.skipped === true) skipped += 1;
    if (typeof d.latencyMs === "number" && d.latencyMs >= 0) latencies.push(d.latencyMs);
  }

  for (const { component } of lastSeen.values()) {
    stats.lastComponent[component] = (stats.lastComponent[component] ?? 0) + 1;
  }

  stats.books = perBook.size;
  stats.perBook = summarize([...perBook.values()]);
  stats.latencyMs = summarize(latencies);
  stats.ambiguityRate = rate(ambiguous, stats.turns);
  stats.skipRate = rate(skipped, stats.turns);
  return stats;
}

/** Books of an arm that reached a milestone, as a share. */
function milestoneRate(rows: ProjectMirror[], milestone: string): number {
  const reached = rows.filter((m) => Boolean(m.milestones?.[milestone as never])).length;
  return rate(reached, rows.length);
}

/**
 * What the reader of this page needs to know before believing it.
 *
 * Derived from the loaded data rather than written as static help text, so it
 * cannot claim the sample is healthy when it isn't. Each one names the specific
 * wrong conclusion it prevents — "be careful" tells nobody anything.
 */
function caveatsFor(
  byArm: Map<FlowArm, ProjectMirror[]>,
  turns: FlowTurnStats,
  truncated: boolean,
): string[] {
  const out: string[] = [];
  const guide = byArm.get("guide") ?? [];
  const legacy = byArm.get("legacy") ?? [];
  const mixed = byArm.get("mixed") ?? [];
  const unknown = byArm.get("unknown") ?? [];

  const SMALL = 30;
  if (guide.length < SMALL || legacy.length < SMALL) {
    out.push(
      `Small sample: ${guide.length} guided and ${legacy.length} wizard books. Differences below ` +
        `roughly a factor of two are unlikely to mean anything at this size.`,
    );
  }

  // The one that would otherwise be read as a result about the flow when it is a
  // result about the people. Detected structurally: an arm concentrated in a
  // handful of accounts is a staff arm.
  const users = (rows: ProjectMirror[]) => new Set(rows.map((m) => m.uid)).size;
  const guideUsers = users(guide);
  if (guide.length > 0 && guideUsers <= 3) {
    out.push(
      `The guided arm is ${guideUsers} account${guideUsers === 1 ? "" : "s"}. While the rollout is ` +
        `admin-only these are staff books, so a difference here is a difference in who is ` +
        `writing, not in which studio is better.`,
    );
  }

  if (mixed.length > 0) {
    out.push(
      `${mixed.length} book${mixed.length === 1 ? " was" : "s were"} worked on in both flows and ` +
        `${mixed.length === 1 ? "is" : "are"} excluded from both arms — each carries one flow's ` +
        `writing and the other's pictures, so neither can be credited with it.`,
    );
  }

  if (unknown.length > 0) {
    out.push(
      `${unknown.length} book${unknown.length === 1 ? "" : "s"} have no flow recorded, either ` +
        `because they predate this measurement or because the reader never settled on one flow ` +
        `long enough to be counted. They are excluded, which shrinks the sample rather than ` +
        `biasing it.`,
    );
  }

  const drafted = guide.filter((m) => m.milestones?.storyDrafted).length;
  if (guide.length > 0 && drafted < guide.length / 2) {
    out.push(
      `Only ${drafted} of ${guide.length} guided books reached a draft, so the guided timings ` +
        `describe a minority of them. Compare the completion rates before the durations.`,
    );
  }

  if (turns.truncated || truncated) {
    out.push(
      `The window is larger than one report can read in full, so these are the first records in ` +
        `it rather than all of them. Narrow the dates before comparing.`,
    );
  }

  return out;
}

/**
 * Build the comparison for a window.
 *
 * The window is on activity, matching `/admin/projects`, so this reads as "books
 * worked on in this period" — which is what you want when a rollout is ramping and
 * "books created in this period" would drop every book that started before it.
 */
export async function flowComparison(args: {
  fromMs: number;
  toMs: number;
  limit?: number;
  allocateSubscriptions?: boolean;
}): Promise<FlowComparison> {
  ensureAdmin();
  const limit = Math.min(Math.max(args.limit ?? 1000, 1), 1000);
  const [mirrors, finance] = await Promise.all([
    listProjectMirrors({ fromMs: args.fromMs, toMs: args.toMs, limit }),
    projectFinanceIndex({
      fromMs: args.fromMs,
      toMs: args.toMs,
      allocateSubscriptions: args.allocateSubscriptions,
    }),
  ]);

  const byArm = new Map<FlowArm, ProjectMirror[]>();
  for (const mirror of mirrors) {
    const arm = flowArm(mirror.authoring);
    const bucket = byArm.get(arm) ?? [];
    bucket.push(mirror);
    byArm.set(arm, bucket);
  }

  // Fixed order, and every arm present even when empty: an arm that vanishes when
  // it has no books makes the table's columns move between reports, and "zero
  // guided books this week" is itself the answer to a question someone asked.
  const ORDER: FlowArm[] = ["guide", "legacy", "mixed", "unknown"];
  const arms: FlowArmReport[] = ORDER.map((arm) => {
    const rows = byArm.get(arm) ?? [];
    return {
      arm,
      comparable: isComparable(arm),
      books: rows.length,
      stats: summarizeProjects(rows, finance.byProject),
      previewRate: milestoneRate(rows, "previewed"),
      orderRate: milestoneRate(rows, "ordered"),
    };
  });

  const turns = await summarizeGuideTurns(args.fromMs, args.toMs);
  const truncated = mirrors.length >= limit;

  return {
    window: { fromMs: args.fromMs, toMs: args.toMs },
    arms,
    turns,
    caveats: caveatsFor(byArm, turns, truncated),
    excluded: {
      mixed: (byArm.get("mixed") ?? []).length,
      unknown: (byArm.get("unknown") ?? []).length,
    },
    truncated,
  };
}

/** The guide components, in playlist-independent catalog order, for the UI. */
export const FLOW_COMPONENT_IDS: readonly string[] = GUIDE_COMPONENT_IDS;
