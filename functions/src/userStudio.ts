/**
 * One account, end to end — the per-user counterpart to the Studio flows page.
 *
 * The flows page answers "which studio works better" across everyone. This answers
 * "what did THIS person do, and where did it stop", which is the question behind
 * almost every support conversation and every "why did this book die" hunch. It is
 * built from the same sources the aggregate reads — project mirrors, the turn log,
 * the event log, action runs, auth events — so the two cannot disagree about a
 * person who appears in both.
 *
 * Two things are deliberately conservative:
 *
 *   - **The reader's own words are opt-in.** A timeline that interleaves what
 *     someone typed with who they are is a much more personal artifact than any
 *     aggregate here, so `text` is only filled when the caller passes
 *     `revealWords`, and the route that does so holds the same permission as an
 *     email reveal and writes an audit entry. Everything else on the timeline is
 *     system-written and carries no prose from the reader.
 *   - **Every source is capped and says so.** A heavy user hits a read cap; a
 *     report that silently returned the newest slice as though it were the whole
 *     history would read as "this person did little". `truncated` is the honest
 *     answer.
 */
import { getFirestore } from "firebase-admin/firestore";
import { ensureAdmin } from "./storage";
import {
  listProjectMirrors,
  projectDocKey,
  summarizeUsers,
  type ProjectMilestone,
  type ProjectMirror,
} from "./projects";
import { listUserActionRuns } from "./actionRun";
import { flowArm } from "../../books-frontend/src/core/guide/flow";
import type {
  StudioTimelineEntry,
  UserStudioBook,
  UserStudioReport,
} from "../../books-frontend/src/core/analytics/types";

const MAX_TURNS = 500;
const MAX_EVENTS = 1000;
const MAX_RUNS = 1000;
const MAX_AUTH_EVENTS = 200;
const MAX_TIMELINE = 400;
const DAY_MS = 24 * 60 * 60 * 1000;

/** In the order a book passes them; the last one a book carries is where it stopped. */
const MILESTONE_ORDER: ProjectMilestone[] = [
  "created",
  "setupLocked",
  "storyDrafted",
  "pagesPlanned",
  "castStarted",
  "pagesStarted",
  "coverDone",
  "finished",
  "previewed",
  "checkoutStarted",
  "ordered",
];

const MILESTONE_LABEL: Record<ProjectMilestone, string> = {
  created: "Book started",
  setupLocked: "Setup locked in",
  storyDrafted: "Story written",
  pagesPlanned: "Pages planned",
  castStarted: "Cast drawing started",
  pagesStarted: "Page drawing started",
  coverDone: "Cover done",
  finished: "Book finished",
  previewed: "Opened the order screen",
  checkoutStarted: "Started checkout",
  ordered: "Ordered",
};

const EVENT_LABEL: Record<string, string> = {
  tap: "Tapped an option",
  askAnswer: "Answered a question",
  agentConfirm: "Confirmed an action",
  agentCancel: "Declined an action",
  skill: "Ran a skill from a button",
  skip: "Skipped a question",
  retry: "Re-sent a failed message",
  undo: "Undid a change",
  redo: "Redid a change",
  entry: "Chose how to begin",
  audience: "Chose a reading age",
  storyStart: "Started the story",
  quoteShown: "Was shown a price",
  paidConfirm: "Paid for a draw",
  orderOpened: "Opened the order screen",
  error: "Saw an error",
};

const asNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const asList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

const nonEmpty = (value: unknown): boolean => Array.isArray(value) && value.length > 0;

function describeDetail(detail: unknown): string | undefined {
  if (!detail || typeof detail !== "object") return undefined;
  const parts = Object.entries(detail as Record<string, unknown>)
    .filter(([, v]) => typeof v === "string" || typeof v === "number" || typeof v === "boolean")
    .map(([k, v]) => `${k} ${String(v)}`);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

export async function buildUserStudioReport(args: {
  uid: string;
  /** Include the reader's own messages. See the module comment before passing true. */
  revealWords: boolean;
  /** On the admin exclusion list. Carried through so the UI can say so. */
  excluded: boolean;
}): Promise<UserStudioReport> {
  ensureAdmin();
  const { uid } = args;
  const db = getFirestore();

  const [mirrors, turnSnap, eventSnap, runs, authSnap] = await Promise.all([
    listProjectMirrors({ uid, limit: 1000 }),
    db.collection(`users/${uid}/guideTurns`).orderBy("createdAt", "desc").limit(MAX_TURNS).get(),
    db.collection(`users/${uid}/guideEvents`).orderBy("createdAt", "desc").limit(MAX_EVENTS).get(),
    listUserActionRuns(uid, MAX_RUNS),
    db.collection("analyticsEvents").where("uid", "==", uid).limit(MAX_AUTH_EVENTS).get(),
  ]);

  const truncated =
    turnSnap.size >= MAX_TURNS ||
    eventSnap.size >= MAX_EVENTS ||
    runs.length >= MAX_RUNS ||
    authSnap.size >= MAX_AUTH_EVENTS;

  const timeline: StudioTimelineEntry[] = [];
  const turnsByBook = new Map<string, number>();
  const eventsByBook = new Map<string, number>();
  const lastComponent = new Map<string, { at: number; component: string }>();
  const byKind: Record<string, number> = {};
  let admittedFailures = 0;
  let refusals = 0;

  for (const doc of turnSnap.docs) {
    const d = doc.data() as Record<string, unknown>;
    const at = asNumber(d.createdAt);
    const projectId = typeof d.projectId === "string" ? d.projectId : null;
    if (at === null) continue;
    if (projectId) {
      const key = projectDocKey(uid, projectId);
      turnsByBook.set(key, (turnsByBook.get(key) ?? 0) + 1);
      const component = typeof d.componentId === "string" ? d.componentId : "";
      const prev = lastComponent.get(key);
      if (component && (!prev || at >= prev.at)) lastComponent.set(key, { at, component });
    }

    const outcome = d.outcome as
      | { applied?: unknown; unchanged?: unknown; rejected?: unknown; admittedFailure?: unknown }
      | undefined;
    const admitted = outcome?.admittedFailure === true;
    const refused = nonEmpty(d.refused) || nonEmpty(outcome?.rejected);
    if (admitted) admittedFailures += 1;
    if (refused) refusals += 1;

    const confidence = asNumber(d.confidence);
    const applied = asList(outcome?.applied);
    const detail = [
      typeof d.intent === "string" ? d.intent : null,
      confidence !== null ? `confidence ${confidence.toFixed(2)}` : null,
      outcome ? (applied.length > 0 ? `applied ${applied.join(", ")}` : "applied nothing") : "no outcome reported",
      nonEmpty(d.commands) ? `skills ${(d.commands as { id?: string }[]).map((c) => c.id).filter(Boolean).join(", ")}` : null,
      typeof d.componentId === "string" ? `at ${d.componentId}` : null,
    ]
      .filter(Boolean)
      .join(" · ");

    timeline.push({
      at,
      kind: "turn",
      projectId,
      label: admitted ? "Said something we didn't understand" : "Said something",
      detail,
      ...(args.revealWords && typeof d.message === "string" ? { text: d.message.slice(0, 600) } : {}),
      ...(admitted ? { flag: "bad" as const } : refused ? { flag: "warn" as const } : {}),
    });
  }

  for (const doc of eventSnap.docs) {
    const d = doc.data() as Record<string, unknown>;
    const at = asNumber(d.createdAt);
    const kind = typeof d.kind === "string" ? d.kind : "unknown";
    if (at === null) continue;
    const projectId = typeof d.projectId === "string" ? d.projectId : null;
    byKind[kind] = (byKind[kind] ?? 0) + 1;
    if (projectId) {
      const key = projectDocKey(uid, projectId);
      eventsByBook.set(key, (eventsByBook.get(key) ?? 0) + 1);
    }
    timeline.push({
      at,
      kind: "event",
      projectId,
      label: EVENT_LABEL[kind] ?? kind,
      ...(describeDetail(d.detail) ? { detail: describeDetail(d.detail) } : {}),
      ...(kind === "error" ? { flag: "bad" as const } : {}),
    });
  }

  for (const run of runs) {
    timeline.push({
      at: run.at,
      kind: "run",
      projectId: run.projectId ?? null,
      label: `Ran ${run.action}${run.tier ? ` (${run.tier})` : ""}`,
      detail: `${run.outcome} · $${run.costUsd.total.toFixed(3)} · ${run.sparks.charged} sparks`,
      ...(run.outcome !== "ok" ? { flag: "bad" as const } : {}),
    });
  }

  for (const doc of authSnap.docs) {
    const d = doc.data() as Record<string, unknown>;
    const at = asNumber(d.at);
    if (at === null) continue;
    const type = d.type === "signup" ? "signup" : "login";
    timeline.push({
      at,
      kind: type,
      projectId: null,
      label: type === "signup" ? "Signed up" : "Signed in",
      detail: [typeof d.source === "string" ? d.source : null, typeof d.device === "string" ? d.device : null]
        .filter(Boolean)
        .join(" · ") || undefined,
    });
  }

  const books: UserStudioBook[] = mirrors.map((m: ProjectMirror) => {
    const key = projectDocKey(uid, m.projectId);
    const milestones: Record<string, number> = {};
    for (const [name, at] of Object.entries(m.milestones ?? {})) {
      if (typeof at === "number" && at > 0) {
        milestones[name] = at;
        timeline.push({
          at,
          kind: "milestone",
          projectId: m.projectId,
          label: MILESTONE_LABEL[name as ProjectMilestone] ?? name,
        });
      }
    }
    const stopped = [...MILESTONE_ORDER].reverse().find((name) => milestones[name]);
    return {
      key,
      projectId: m.projectId,
      title: m.derived.title ?? null,
      arm: flowArm(m.authoring),
      createdAt: m.createdAt,
      lastActionAt: m.lastActionAt,
      milestones,
      pages: m.derived.pageCount,
      cast: m.derived.anchors?.total ?? 0,
      images: m.counters.imagesGenerated,
      runs: m.counters.runs,
      failures: m.counters.failures,
      sparksCharged: m.sparks?.charged ?? 0,
      costUsd: Math.round((m.cost?.providerUsd ?? 0) * 10000) / 10000,
      turns: turnsByBook.get(key) ?? 0,
      events: eventsByBook.get(key) ?? 0,
      lastComponent: lastComponent.get(key)?.component ?? null,
      stoppedAfter: stopped ?? null,
    };
  });

  timeline.sort((a, b) => b.at - a.at);

  const stamps = timeline.map((entry) => entry.at);
  const firstSeenAt = stamps.length > 0 ? Math.min(...stamps) : null;
  const lastActiveAt = stamps.length > 0 ? Math.max(...stamps) : null;
  const rollup = summarizeUsers(mirrors)[0];

  return {
    uid,
    generatedAt: Date.now(),
    excluded: args.excluded,
    arm: rollup?.arm ?? "unknown",
    flows: rollup?.flows ?? [],
    wordsRevealed: args.revealWords,
    totals: {
      books: books.length,
      turns: turnSnap.size,
      events: eventSnap.size,
      runs: runs.length,
      admittedFailures,
      refusals,
      firstSeenAt,
      lastActiveAt,
      daysIdle: lastActiveAt === null ? null : Math.max(0, Math.floor((Date.now() - lastActiveAt) / DAY_MS)),
    },
    byKind,
    books,
    timeline: timeline.slice(0, MAX_TIMELINE),
    truncated: truncated || timeline.length > MAX_TIMELINE,
  };
}
