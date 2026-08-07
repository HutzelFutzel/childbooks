/**
 * Server-owned **project mirror** — the admin-readable shadow of a user's book.
 *
 * The books themselves live in the user's private space as opaque JSON KV docs
 * (`users/{uid}/store/project%3A{id}`), written by the client. That shape is
 * perfect for the studio and useless for analysis: it can't be aggregated, and
 * anything the client writes can't be trusted for money. So the backend keeps a
 * small, server-written mirror at `projects/{uid}__{projectId}` carrying only
 * what it can vouch for:
 *
 *   - STRUCTURE derived from the project snapshot the render pipeline already
 *     receives (anchor counts, page count, art style, language) — authoritative,
 *     free, no client cooperation required.
 *   - COUNTERS accumulated at settle time (runs, images, retries, failures).
 *   - COST and SPARKS, which only the backend ever sees.
 *   - MILESTONES, so "where do books die?" is one query rather than a guess.
 *
 * Revenue deliberately does NOT live here: it's derived at read time from the
 * `financeEvents` stream (see {@link projectFinanceIndex}), which already
 * carries `projectId` on every print/ebook/Spark line. Mirroring it would mean
 * two sets of books that can drift.
 *
 * Every write is best-effort — bookkeeping must never break a render.
 */
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { ensureAdmin } from "./storage";
import { getSparksConfig } from "./appConfig";
import { spreadsById } from "../../books-frontend/src/core/book/units";
import { artStyleKey } from "../../books-frontend/src/core/prompts/style";
import type { Project } from "../../books-frontend/src/core/types";
import type { ImageTier } from "../../books-frontend/src/core/config/modelConfig";
import type { RunKind } from "./actionRun";
import {
  emptyStat,
  mergeTally,
  rate,
  summarize,
  topKey,
  type StatSummary,
} from "./stats";

const COLLECTION = "projects";

/** Which counter a run's intent increments. */
const KIND_COUNTER: Record<RunKind, "fresh" | "edits" | "variations" | "restyles"> = {
  fresh: "fresh",
  edit: "edits",
  variation: "variations",
  restyle: "restyles",
};

/**
 * Doc id for a project mirror. Project ids are minted client-side, so they are
 * only trustworthy WITHIN a user's space — the uid prefix makes the key unique
 * globally even if two users ever mint the same id.
 */
export function projectDocKey(uid: string, projectId: string): string {
  return `${uid}__${projectId}`;
}

function db() {
  ensureAdmin();
  return getFirestore();
}

/** Server-observed lifecycle milestones, in the order a book passes them. */
export type ProjectMilestone =
  | "created"
  | "storyDrafted"
  | "castStarted"
  | "pagesStarted"
  | "coverDone"
  | "ordered";

/** Structure the backend derived from a project snapshot it rendered against. */
export interface ProjectDerived {
  title?: string;
  ageRangeId?: string;
  readingModeId?: string;
  artStyleKey?: string;
  productSku?: string;
  /**
   * What the book is ABOUT, as catalog ids from the story brief.
   *
   * Kept because the print SKU says how a book is bound and nothing about its
   * subject, and "what do grandparents buy for a first birthday" is a question
   * about the subject. Ids only: `customTheme` and the free-text occasion can't be
   * aggregated, and putting a customer's own words in a cross-user analysis
   * collection is a cost with no matching benefit.
   */
  storyMode?: string;
  themeId?: string;
  settingId?: string;
  deviceId?: string;
  /** Illustration units (spreads/pages) in the current screenplay. */
  pageCount: number;
  /** Units that already have at least one illustration. */
  illustratedCount: number;
  /**
   * Illustration versions the user is still carrying, summed over every unit.
   * Illustrations are version trees, so this is the kept history — the gap to
   * `illustratedCount` is how much the user re-rolled and edited before settling.
   */
  illustrationVersions: number;
  /** Screenplay revisions — how much the story itself got rewritten. */
  screenplayVersions: number;
  anchors: { total: number; character: number; place: number; object: number };
}

export interface ProjectCounters {
  runs: number;
  /**
   * Runs by intent. Together with `failures` these partition `runs`, so
   * "how much of this book was rework" is a subtraction rather than a guess:
   *   - `fresh`      — first render of something
   *   - `edits`      — a re-render carrying an instruction ("make her smile")
   *   - `variations` — a re-roll with no instruction, i.e. plain regenerate
   *   - `restyles`   — art-style transfer of existing artwork
   */
  fresh: number;
  edits: number;
  variations: number;
  restyles: number;
  failures: number;
  imagesGenerated: number;
  /** Repair/retry calls we absorbed (the quality-control tax). */
  qcCalls: number;
  byAction: Record<string, number>;
  byTier: Record<string, number>;
  /**
   * Images produced per concrete `provider:model`. The flat `models.imageModels`
   * list only says a model was touched; this says how much of the book it drew,
   * which is what a model-quality or model-cost comparison actually needs.
   */
  imagesByModel: Record<string, number>;
  /**
   * Images produced per action. `imagesByAction.pageIllustration` divided by
   * `derived.illustratedCount` is the churn signal: how many renders it took to
   * land each page the user kept.
   */
  imagesByAction: Record<string, number>;
}

export interface ProjectMirror {
  projectId: string;
  uid: string;
  /** 1-based: this user's first book, second book, … */
  seq: number;
  createdAt: number;
  firstActionAt: number;
  lastActionAt: number;
  derived: ProjectDerived;
  /** Client-reported stage. Untrusted by construction — never used for money. */
  reported?: { stage: string; updatedAt: number };
  milestones: Partial<Record<ProjectMilestone, number>>;
  counters: ProjectCounters;
  models: { imageModels: string[] };
  cost: { providerUsd: number; billedUsd: number; unbilledUsd: number };
  sparks: { charged: number; paid: number; free: number; byLotSource: Record<string, number> };
  timing: { timeToFirstImageMs?: number; timeToOrderMs?: number };
}

/** Derive the structural facts from a project snapshot. Pure. */
export function deriveProjectStructure(project: Project): ProjectDerived {
  const anchors = project.anchors ?? [];
  const illustrations = project.illustrations ?? {};
  let pageCount = 0;
  try {
    pageCount = spreadsById(project).size;
  } catch {
    pageCount = 0; // a half-built screenplay must not break metering
  }
  const brief = project.config?.storyBrief;
  return {
    ...(project.title ? { title: project.title.slice(0, 200) } : {}),
    ...(project.config?.ageRangeId ? { ageRangeId: project.config.ageRangeId } : {}),
    ...(project.config?.readingModeId ? { readingModeId: project.config.readingModeId } : {}),
    ...(project.config?.productSku ? { productSku: project.config.productSku } : {}),
    ...(project.config?.artStyle ? { artStyleKey: artStyleKey(project.config.artStyle) } : {}),
    ...(brief?.mode ? { storyMode: brief.mode } : {}),
    ...(brief?.themeId ? { themeId: brief.themeId } : {}),
    ...(brief?.settingId ? { settingId: brief.settingId } : {}),
    ...(brief?.deviceId ? { deviceId: brief.deviceId } : {}),
    pageCount,
    illustratedCount: Object.keys(illustrations).length,
    illustrationVersions: Object.values(illustrations).reduce(
      (n, tree) => n + Object.keys(tree?.nodes ?? {}).length,
      0,
    ),
    screenplayVersions: Object.keys(project.screenplay?.nodes ?? {}).length,
    anchors: {
      total: anchors.length,
      character: anchors.filter((a) => a.type === "character").length,
      place: anchors.filter((a) => a.type === "place").length,
      object: anchors.filter((a) => a.type === "object").length,
    },
  };
}

/**
 * Ensure a mirror exists and return this project's sequence number for the
 * user. The counter lives on the user doc and is bumped inside the same
 * transaction that creates the mirror, so a project can never be assigned two
 * numbers even if several renders start at once.
 */
export async function ensureProjectMirror(
  uid: string,
  projectId: string,
  snapshot?: Project,
): Promise<number | undefined> {
  if (!uid || !projectId) return undefined;
  try {
    const ref = db().doc(`${COLLECTION}/${projectDocKey(uid, projectId)}`);
    const userRef = db().doc(`users/${uid}`);
    const now = Date.now();
    const derived = snapshot ? deriveProjectStructure(snapshot) : null;

    return await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) {
        const seq = snap.get("seq") as number | undefined;
        // Structure is refreshed on every render: a book grows pages and cast
        // as it goes, and the mirror should describe it as it is now.
        if (derived) {
          tx.set(ref, { derived, lastActionAt: now }, { merge: true });
        }
        return typeof seq === "number" ? seq : undefined;
      }
      const userSnap = await tx.get(userRef);
      const seq = ((userSnap.get("projectCounter") as number) ?? 0) + 1;
      tx.set(userRef, { projectCounter: seq, projectCount: seq }, { merge: true });
      tx.set(ref, {
        projectId,
        uid,
        seq,
        createdAt: snapshot?.createdAt ?? now,
        firstActionAt: now,
        lastActionAt: now,
        derived: derived ?? emptyDerived(),
        milestones: { created: snapshot?.createdAt ?? now },
        counters: emptyCounters(),
        models: { imageModels: [] },
        cost: { providerUsd: 0, billedUsd: 0, unbilledUsd: 0 },
        sparks: { charged: 0, paid: 0, free: 0, byLotSource: {} },
        timing: {},
      });
      return seq;
    });
  } catch {
    return undefined; // never block a render on bookkeeping
  }
}

function emptyDerived(): ProjectDerived {
  return {
    pageCount: 0,
    illustratedCount: 0,
    illustrationVersions: 0,
    screenplayVersions: 0,
    anchors: { total: 0, character: 0, place: 0, object: 0 },
  };
}

function emptyCounters(): ProjectCounters {
  return {
    runs: 0,
    fresh: 0,
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
  };
}

/** The milestone an action implies, so the funnel fills itself in. */
function milestoneForAction(action: string): ProjectMilestone | null {
  if (action === "anchorImage") return "castStarted";
  if (action === "pageIllustration") return "pagesStarted";
  if (action === "coverIllustration") return "coverDone";
  if (action === "storyDraft" || action === "screenplay") return "storyDrafted";
  return null;
}

export interface ProjectRunUpdate {
  uid: string;
  projectId: string;
  action: string;
  tier?: ImageTier;
  imageModel?: string;
  imagesGenerated: number;
  qcCalls: number;
  kind: RunKind;
  failed: boolean;
  costUsd: { total: number; billed: number; unbilled: number };
  sparks: { charged: number; paid: number; free: number; byLotSource: Record<string, number> };
  at: number;
}

/**
 * Fold one finished action run into its project's counters. Best-effort.
 *
 * Written as NESTED objects rather than dotted field paths: `set(..., merge)`
 * treats a key containing dots as a literal field name, so `"counters.runs"`
 * would create a field called "counters.runs" instead of incrementing the one
 * inside `counters`.
 */
export async function recordProjectRun(u: ProjectRunUpdate): Promise<void> {
  if (!u.uid || !u.projectId) return;
  try {
    const ref = db().doc(`${COLLECTION}/${projectDocKey(u.uid, u.projectId)}`);
    const milestone = milestoneForAction(u.action);
    const inc = FieldValue.increment;
    const byLotSource: Record<string, FirebaseFirestore.FieldValue> = {};
    for (const [source, amount] of Object.entries(u.sparks.byLotSource)) {
      if (typeof amount === "number" && amount !== 0) byLotSource[source] = inc(amount);
    }
    await ref.set(
      {
        lastActionAt: u.at,
        counters: {
          runs: inc(1),
          imagesGenerated: inc(u.imagesGenerated),
          qcCalls: inc(u.qcCalls),
          [KIND_COUNTER[u.kind]]: inc(1),
          ...(u.failed ? { failures: inc(1) } : {}),
          byAction: { [u.action]: inc(1) },
          ...(u.tier ? { byTier: { [u.tier]: inc(1) } } : {}),
          ...(u.imagesGenerated > 0
            ? {
                imagesByAction: { [u.action]: inc(u.imagesGenerated) },
                ...(u.imageModel
                  ? { imagesByModel: { [u.imageModel]: inc(u.imagesGenerated) } }
                  : {}),
              }
            : {}),
        },
        cost: {
          providerUsd: inc(u.costUsd.total),
          billedUsd: inc(u.costUsd.billed),
          unbilledUsd: inc(u.costUsd.unbilled),
        },
        sparks: {
          charged: inc(u.sparks.charged),
          paid: inc(u.sparks.paid),
          free: inc(u.sparks.free),
          ...(Object.keys(byLotSource).length > 0 ? { byLotSource } : {}),
        },
        ...(u.imageModel ? { models: { imageModels: FieldValue.arrayUnion(u.imageModel) } } : {}),
      },
      { merge: true },
    );
    if (milestone) await stampMilestone(u.uid, u.projectId, milestone, u.at);
    if (u.imagesGenerated > 0) await stampFirstImage(u.uid, u.projectId, u.at);
  } catch {
    // telemetry only
  }
}

/** Write a milestone timestamp once (first occurrence wins). */
export async function stampMilestone(
  uid: string,
  projectId: string,
  milestone: ProjectMilestone,
  at = Date.now(),
): Promise<void> {
  if (!uid || !projectId) return;
  try {
    const ref = db().doc(`${COLLECTION}/${projectDocKey(uid, projectId)}`);
    await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const existing = snap.get(`milestones.${milestone}`) as number | undefined;
      if (typeof existing === "number" && existing > 0) return;
      const patch: Record<string, unknown> = { milestones: { [milestone]: at } };
      if (milestone === "ordered") {
        const created = (snap.get("createdAt") as number) ?? at;
        patch.timing = { timeToOrderMs: Math.max(0, at - created) };
      }
      tx.set(ref, patch, { merge: true });
    });
  } catch {
    // telemetry only
  }
}

/** Record time-to-first-image once — the clearest activation signal we have. */
async function stampFirstImage(uid: string, projectId: string, at: number): Promise<void> {
  try {
    const ref = db().doc(`${COLLECTION}/${projectDocKey(uid, projectId)}`);
    await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const existing = snap.get("timing.timeToFirstImageMs") as number | undefined;
      if (typeof existing === "number") return;
      const created = (snap.get("createdAt") as number) ?? at;
      tx.set(ref, { timing: { timeToFirstImageMs: Math.max(0, at - created) } }, { merge: true });
    });
  } catch {
    // telemetry only
  }
}

/**
 * Client-reported stage/title for the parts of a book's life that involve no
 * AI call (finishing the wizard, opening checkout). Stored under `reported` so
 * it can never be mistaken for a server-derived fact.
 */
export async function touchProject(args: {
  uid: string;
  projectId: string;
  stage?: string;
  title?: string;
}): Promise<void> {
  const { uid, projectId } = args;
  if (!uid || !projectId) return;
  await ensureProjectMirror(uid, projectId);
  try {
    const ref = db().doc(`${COLLECTION}/${projectDocKey(uid, projectId)}`);
    await ref.set(
      {
        ...(args.stage ? { reported: { stage: args.stage.slice(0, 40), updatedAt: Date.now() } } : {}),
        ...(args.title ? { derived: { title: args.title.slice(0, 200) } } : {}),
      },
      { merge: true },
    );
  } catch {
    // telemetry only
  }
}

// ---- Read side ---------------------------------------------------------------

/** One project's money picture, derived from the finance stream. */
export interface ProjectPnl {
  /** Deferred pack/gift revenue recognized as this project consumed Sparks. */
  recognizedUsd: number;
  /** Print + ebook charged directly against this project. */
  directUsd: number;
  refundUsd: number;
  feesUsd: number;
  /** Provider spend attributed to this project. */
  providerUsd: number;
  /** Free Sparks consumed, valued at provider cost — the acquisition subsidy. */
  subsidyUsd: number;
  freeSparks: number;
  paidSparks: number;
  freeBySource: Record<string, number>;
  /** Modelled share of subscription revenue (only when allocation is on). */
  subscriptionAllocUsd: number;
  netUsd: number;
}

function emptyPnl(): ProjectPnl {
  return {
    recognizedUsd: 0,
    directUsd: 0,
    refundUsd: 0,
    feesUsd: 0,
    providerUsd: 0,
    subsidyUsd: 0,
    freeSparks: 0,
    paidSparks: 0,
    freeBySource: {},
    subscriptionAllocUsd: 0,
    netUsd: 0,
  };
}

const MAX_SCAN = 50_000;
const PAGE = 5_000;

export interface ProjectFinanceIndex {
  byProject: Map<string, ProjectPnl>;
  /** Subscription revenue that no project could claim (no spend that month). */
  unallocatedSubscriptionUsd: number;
  capped: boolean;
}

/**
 * Aggregate the finance stream into per-project P&L in ONE pass.
 *
 * Revenue recognition follows the Spark lot accounting: cash is collected when
 * a pack or gift is bought (booked then as `packRevenue`, with no project), and
 * RECOGNIZED here as the Sparks from that lot are consumed by a project. So a
 * project's `recognizedUsd` is the `paidUsd` of its spends — counting
 * `packRevenue` again per project would double count the same dollar.
 *
 * Subscriptions have no natural project, so they are allocated at READ time
 * (never written into the stream): a subscriber's monthly invoice is split
 * across the projects they spent Sparks on that month, pro-rata by Sparks.
 * Months where a subscriber generated nothing stay unallocated and are
 * reported separately rather than smeared across unrelated books.
 */
export async function projectFinanceIndex(args: {
  fromMs: number;
  toMs: number;
  /** Model subscription revenue into project P&L (default off — it's an estimate). */
  allocateSubscriptions?: boolean;
  uid?: string;
}): Promise<ProjectFinanceIndex> {
  ensureAdmin();
  const sparks = await getSparksConfig();
  const usdPerFreeSpark =
    sparks.markupMultiplier > 0 ? sparks.sparkValueUsd / sparks.markupMultiplier : 0;

  const byProject = new Map<string, ProjectPnl>();
  // uid → month → { subscriptionUsd, sparksByProject }
  const subs = new Map<string, Map<string, number>>();
  const spendByUserMonth = new Map<string, Map<string, Map<string, number>>>();
  let capped = false;

  const get = (key: string): ProjectPnl => {
    const hit = byProject.get(key) ?? emptyPnl();
    byProject.set(key, hit);
    return hit;
  };

  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  let scanned = 0;
  for (;;) {
    let q: FirebaseFirestore.Query = db().collection("financeEvents");
    // Pushed down when we're looking at one user (the books drawer, a uid
    // filter): without it a single-project P&L would page the whole stream.
    if (args.uid) q = q.where("uid", "==", args.uid);
    q = q
      .where("at", ">=", args.fromMs)
      .where("at", "<=", args.toMs)
      .orderBy("at", "asc")
      .limit(PAGE);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      scanned += 1;
      const d = doc.data() as Record<string, unknown>;
      const uid = (d.uid as string) ?? "";
      if (args.uid && uid !== args.uid) continue;
      const projectId = (d.projectId as string) ?? "";
      const kind = (d.kind as string) ?? "";
      const amountUsd = typeof d.amountUsd === "number" ? d.amountUsd : 0;
      const meta = (d.meta ?? {}) as Record<string, unknown>;
      const at = typeof d.at === "number" ? d.at : args.fromMs;
      const month = new Date(at).toISOString().slice(0, 7);

      if (kind === "subscriptionRevenue" && uid) {
        const perMonth = subs.get(uid) ?? new Map<string, number>();
        perMonth.set(month, (perMonth.get(month) ?? 0) + Math.max(0, amountUsd));
        subs.set(uid, perMonth);
        continue;
      }
      if (!projectId || !uid) continue;
      const key = projectDocKey(uid, projectId);
      const p = get(key);

      switch (kind) {
        case "providerCost":
          p.providerUsd += -amountUsd;
          break;
        case "sparkSpend": {
          const paidUsd = typeof meta.paidUsd === "number" ? meta.paidUsd : 0;
          const freeSparks = typeof meta.freeSparks === "number" ? meta.freeSparks : 0;
          const unfunded = typeof meta.unfundedSparks === "number" ? meta.unfundedSparks : 0;
          const paidSparks = typeof meta.paidSparks === "number" ? meta.paidSparks : 0;
          p.recognizedUsd += paidUsd;
          p.paidSparks += paidSparks;
          p.freeSparks += freeSparks + unfunded;
          p.subsidyUsd += (freeSparks + unfunded) * usdPerFreeSpark;
          const bySource = (meta.freeBySource ?? {}) as Record<string, number>;
          for (const [src, n] of Object.entries(bySource)) {
            if (typeof n === "number") p.freeBySource[src] = (p.freeBySource[src] ?? 0) + n;
          }
          // Sparks spent per project per month drive subscription allocation.
          const perMonth = spendByUserMonth.get(uid) ?? new Map<string, Map<string, number>>();
          const perProject = perMonth.get(month) ?? new Map<string, number>();
          const spent = Math.abs(typeof d.sparks === "number" ? d.sparks : 0);
          perProject.set(key, (perProject.get(key) ?? 0) + spent);
          perMonth.set(month, perProject);
          spendByUserMonth.set(uid, perMonth);
          break;
        }
        case "printRevenue":
        case "ebookRevenue":
          p.directUsd += amountUsd;
          break;
        case "refund":
          p.refundUsd += -amountUsd;
          break;
        case "stripeFee":
        case "taxRemitted":
        case "printCost":
          p.feesUsd += -amountUsd;
          break;
        default:
          break;
      }
    }
    cursor = snap.docs[snap.docs.length - 1];
    if (scanned >= MAX_SCAN) {
      capped = true;
      break;
    }
    if (snap.size < PAGE) break;
  }

  let unallocatedSubscriptionUsd = 0;
  for (const [uid, perMonth] of subs) {
    for (const [month, revenue] of perMonth) {
      const perProject = spendByUserMonth.get(uid)?.get(month);
      const total = [...(perProject?.values() ?? [])].reduce((a, b) => a + b, 0);
      if (!perProject || total <= 0) {
        unallocatedSubscriptionUsd += revenue;
        continue;
      }
      if (!args.allocateSubscriptions) {
        unallocatedSubscriptionUsd += revenue;
        continue;
      }
      for (const [key, sparksSpent] of perProject) {
        const p = get(key);
        p.subscriptionAllocUsd += (revenue * sparksSpent) / total;
      }
    }
  }

  const r2 = (n: number) => Math.round(n * 100) / 100;
  for (const p of byProject.values()) {
    p.recognizedUsd = r2(p.recognizedUsd);
    p.directUsd = r2(p.directUsd);
    p.refundUsd = r2(p.refundUsd);
    p.feesUsd = r2(p.feesUsd);
    p.providerUsd = r2(p.providerUsd);
    p.subsidyUsd = r2(p.subsidyUsd);
    p.subscriptionAllocUsd = r2(p.subscriptionAllocUsd);
    p.netUsd = r2(
      p.recognizedUsd +
        p.directUsd +
        p.subscriptionAllocUsd -
        p.refundUsd -
        p.feesUsd -
        p.providerUsd,
    );
  }

  return { byProject, unallocatedSubscriptionUsd: r2(unallocatedSubscriptionUsd), capped };
}

/**
 * Filters for the books report. Everything except uid and the activity window
 * is applied in memory: these are low-cardinality slices over a page of results,
 * and pushing them into Firestore would need a composite index each.
 */
export interface ProjectQuery {
  uid?: string;
  /** Window on `lastActionAt` — "books worked on during this period". */
  fromMs?: number;
  toMs?: number;
  limit?: number;
  /** Only books that reached this milestone… */
  milestoneReached?: ProjectMilestone;
  /** …and/or died before this one. */
  milestoneMissing?: ProjectMilestone;
  /** Books that used this `provider:model` for at least one image. */
  imageModel?: string;
  tier?: ImageTier;
  /**
   * Art style. `artStyleKey` is `preset` or `preset|customDescription`, so a
   * bare preset id matches its custom variants too.
   */
  artStyleKey?: string;
  productSku?: string;
  ageRangeId?: string;
  minPages?: number;
  maxPages?: number;
  minCast?: number;
  maxCast?: number;
  minImages?: number;
  maxImages?: number;
}

/** Fill in fields added after a mirror was first written. */
function normalizeMirror(m: ProjectMirror): ProjectMirror {
  return {
    ...m,
    derived: { ...emptyDerived(), ...(m.derived ?? {}) },
    counters: { ...emptyCounters(), ...(m.counters ?? {}) },
  };
}

/** The preset half of an art-style key, so custom variants group together. */
function stylePreset(key?: string): string | undefined {
  return key ? key.split("|")[0] : undefined;
}

function matchesQuery(m: ProjectMirror, q: ProjectQuery): boolean {
  const c = m.counters;
  const d = m.derived;
  const inRange = (v: number, min?: number, max?: number) =>
    (min === undefined || v >= min) && (max === undefined || v <= max);
  if (q.milestoneReached && !m.milestones?.[q.milestoneReached]) return false;
  if (q.milestoneMissing && m.milestones?.[q.milestoneMissing]) return false;
  if (q.imageModel && !(c.imagesByModel[q.imageModel] || m.models?.imageModels?.includes(q.imageModel)))
    return false;
  if (q.tier && !c.byTier[q.tier]) return false;
  if (q.artStyleKey && stylePreset(d.artStyleKey) !== stylePreset(q.artStyleKey)) return false;
  if (q.productSku && d.productSku !== q.productSku) return false;
  if (q.ageRangeId && d.ageRangeId !== q.ageRangeId) return false;
  if (!inRange(d.pageCount, q.minPages, q.maxPages)) return false;
  if (!inRange(d.anchors?.total ?? 0, q.minCast, q.maxCast)) return false;
  if (!inRange(c.imagesGenerated, q.minImages, q.maxImages)) return false;
  return true;
}

/** Read project mirrors, newest activity first. */
export async function listProjectMirrors(args: ProjectQuery): Promise<ProjectMirror[]> {
  ensureAdmin();
  const limit = Math.min(Math.max(args.limit ?? 200, 1), 1000);
  let q: FirebaseFirestore.Query = db().collection(COLLECTION);
  if (args.uid) q = q.where("uid", "==", args.uid);
  if (args.fromMs !== undefined) q = q.where("lastActionAt", ">=", args.fromMs);
  if (args.toMs !== undefined) q = q.where("lastActionAt", "<=", args.toMs);
  // Over-fetch so the in-memory filters still return a full page.
  const snap = await q
    .orderBy("lastActionAt", "desc")
    .limit(Math.min(limit * 5, 3000))
    .get();
  const rows = snap.docs
    .map((d) => normalizeMirror(d.data() as ProjectMirror))
    .filter((m) => matchesQuery(m, args));
  return rows.slice(0, limit);
}

export async function getProjectMirror(key: string): Promise<ProjectMirror | null> {
  ensureAdmin();
  const snap = await db().doc(`${COLLECTION}/${key}`).get();
  return snap.exists ? normalizeMirror(snap.data() as ProjectMirror) : null;
}

// ---- Behavioural aggregation -------------------------------------------------

/**
 * How a set of books was actually made. Every metric is a distribution because
 * the averages here are dragged around by a handful of power users — the median
 * book and the p90 book need very different things from us.
 */
export interface ProjectBehaviourStats {
  projects: number;
  users: number;
  /** Structure. */
  pages: StatSummary;
  cast: StatSummary;
  illustratedPages: StatSummary;
  illustrationVersions: StatSummary;
  screenplayVersions: StatSummary;
  /** Effort. */
  runs: StatSummary;
  images: StatSummary;
  fresh: StatSummary;
  edits: StatSummary;
  variations: StatSummary;
  restyles: StatSummary;
  failures: StatSummary;
  qcCalls: StatSummary;
  /** Renders spent per page the user kept — the rework signal. */
  attemptsPerPage: StatSummary;
  /** Money. */
  costUsd: StatSummary;
  sparksCharged: StatSummary;
  netUsd: StatSummary;
  /** Timing (ms). Only books that reached the event contribute. */
  timeToFirstImageMs: StatSummary;
  timeToOrderMs: StatSummary;
  /**
   * Share of all runs in the set, not an average of per-book shares — so one
   * book with 3 runs can't swing it as hard as one with 300.
   */
  rates: {
    editRate: number;
    variationRate: number;
    restyleRate: number;
    failureRate: number;
    /** QC calls per image kept: what quality control costs us per output. */
    qcPerImage: number;
  };
  /** Mix. */
  imagesByModel: Record<string, number>;
  imagesByAction: Record<string, number>;
  runsByAction: Record<string, number>;
  runsByTier: Record<string, number>;
  artStyles: Record<string, number>;
  /** How many books reached each milestone (the funnel). */
  milestones: Record<string, number>;
}

/** Roll a set of mirrors up into distributions. Pure. */
export function summarizeProjects(
  rows: ProjectMirror[],
  pnl?: Map<string, ProjectPnl>,
): ProjectBehaviourStats {
  const pick = <T>(fn: (m: ProjectMirror) => T) => rows.map(fn);
  const num = (fn: (m: ProjectMirror) => number) => summarize(pick(fn));
  const imagesByModel: Record<string, number> = {};
  const imagesByAction: Record<string, number> = {};
  const runsByAction: Record<string, number> = {};
  const runsByTier: Record<string, number> = {};
  const artStyles: Record<string, number> = {};
  const milestones: Record<string, number> = {};
  const uids = new Set<string>();
  let totalRuns = 0;
  let totalEdits = 0;
  let totalVariations = 0;
  let totalRestyles = 0;
  let totalFailures = 0;
  let totalQc = 0;
  let totalImages = 0;

  for (const m of rows) {
    uids.add(m.uid);
    mergeTally(imagesByModel, m.counters.imagesByModel);
    mergeTally(imagesByAction, m.counters.imagesByAction);
    mergeTally(runsByAction, m.counters.byAction);
    mergeTally(runsByTier, m.counters.byTier);
    const style = stylePreset(m.derived.artStyleKey);
    if (style) artStyles[style] = (artStyles[style] ?? 0) + 1;
    for (const [k, at] of Object.entries(m.milestones ?? {})) {
      if (at) milestones[k] = (milestones[k] ?? 0) + 1;
    }
    totalRuns += m.counters.runs;
    totalEdits += m.counters.edits;
    totalVariations += m.counters.variations;
    totalRestyles += m.counters.restyles;
    totalFailures += m.counters.failures;
    totalQc += m.counters.qcCalls;
    totalImages += m.counters.imagesGenerated;
  }

  // Only books with kept pages can have a meaningful attempts-per-page.
  const attempts = rows
    .filter((m) => m.derived.illustratedCount > 0)
    .map((m) => (m.counters.imagesByAction.pageIllustration ?? 0) / m.derived.illustratedCount);

  return {
    projects: rows.length,
    users: uids.size,
    pages: num((m) => m.derived.pageCount),
    cast: num((m) => m.derived.anchors?.total ?? 0),
    illustratedPages: num((m) => m.derived.illustratedCount),
    illustrationVersions: num((m) => m.derived.illustrationVersions),
    screenplayVersions: num((m) => m.derived.screenplayVersions),
    runs: num((m) => m.counters.runs),
    images: num((m) => m.counters.imagesGenerated),
    fresh: num((m) => m.counters.fresh),
    edits: num((m) => m.counters.edits),
    variations: num((m) => m.counters.variations),
    restyles: num((m) => m.counters.restyles),
    failures: num((m) => m.counters.failures),
    qcCalls: num((m) => m.counters.qcCalls),
    attemptsPerPage: attempts.length > 0 ? summarize(attempts) : emptyStat(),
    costUsd: num((m) => m.cost?.providerUsd ?? 0),
    sparksCharged: num((m) => m.sparks?.charged ?? 0),
    netUsd: pnl
      ? summarize(
          rows
            .map((m) => pnl.get(projectDocKey(m.uid, m.projectId)))
            .filter((p): p is ProjectPnl => Boolean(p))
            .map((p) => p.netUsd),
        )
      : emptyStat(),
    timeToFirstImageMs: summarize(
      rows
        .map((m) => m.timing?.timeToFirstImageMs)
        .filter((v): v is number => typeof v === "number"),
    ),
    timeToOrderMs: summarize(
      rows.map((m) => m.timing?.timeToOrderMs).filter((v): v is number => typeof v === "number"),
    ),
    rates: {
      editRate: rate(totalEdits, totalRuns),
      variationRate: rate(totalVariations, totalRuns),
      restyleRate: rate(totalRestyles, totalRuns),
      failureRate: rate(totalFailures, totalRuns),
      qcPerImage: rate(totalQc, totalImages),
    },
    imagesByModel,
    imagesByAction,
    runsByAction,
    runsByTier,
    artStyles,
    milestones,
  };
}

/**
 * Min/max over values that may be missing. `Math.min()` on an empty or partly
 * undefined list yields Infinity/NaN, which JSON turns into `null` and the
 * dashboard renders as a blank cell — so guard rather than trust the data.
 */
function extremum(values: (number | undefined)[], mode: "min" | "max"): number {
  const clean = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (clean.length === 0) return 0;
  return mode === "min" ? Math.min(...clean) : Math.max(...clean);
}

/** One row of the per-user behaviour table. */
export interface UserBehaviourRow {
  uid: string;
  projects: number;
  firstSeenAt: number;
  lastActionAt: number;
  /** Books that reached checkout. */
  ordered: number;
  /** Books that never produced a single image. */
  stalled: number;
  pages: number;
  cast: number;
  images: number;
  runs: number;
  edits: number;
  variations: number;
  restyles: number;
  failures: number;
  qcCalls: number;
  costUsd: number;
  netUsd: number;
  sparksCharged: number;
  sparksPaid: number;
  sparksFree: number;
  avgPagesPerBook: number;
  avgCastPerBook: number;
  avgImagesPerBook: number;
  editRate: number;
  variationRate: number;
  failureRate: number;
  medianTimeToFirstImageMs: number;
  topModel: string | null;
  topTier: string | null;
  topArtStyle: string | null;
}

/**
 * Group mirrors by user. Derived on read from the same rows the books table
 * shows, so the two views can never disagree — and so a filtered set ("books
 * that used the premium tier") yields the matching per-user cut for free.
 */
export function summarizeUsers(
  rows: ProjectMirror[],
  pnl?: Map<string, ProjectPnl>,
): UserBehaviourRow[] {
  const byUid = new Map<string, ProjectMirror[]>();
  for (const m of rows) {
    const list = byUid.get(m.uid);
    if (list) list.push(m);
    else byUid.set(m.uid, [m]);
  }

  const out: UserBehaviourRow[] = [];
  for (const [uid, mirrors] of byUid) {
    const sum = (fn: (m: ProjectMirror) => number) => mirrors.reduce((a, m) => a + fn(m), 0);
    const models: Record<string, number> = {};
    const tiers: Record<string, number> = {};
    const styles: Record<string, number> = {};
    for (const m of mirrors) {
      mergeTally(models, m.counters.imagesByModel);
      mergeTally(tiers, m.counters.byTier);
      const style = stylePreset(m.derived.artStyleKey);
      if (style) styles[style] = (styles[style] ?? 0) + 1;
    }
    const runs = sum((m) => m.counters.runs);
    const images = sum((m) => m.counters.imagesGenerated);
    const n = mirrors.length;
    const r2 = (v: number) => Math.round(v * 100) / 100;
    out.push({
      uid,
      projects: n,
      firstSeenAt: extremum(
        mirrors.map((m) => m.createdAt || m.firstActionAt),
        "min",
      ),
      lastActionAt: extremum(
        mirrors.map((m) => m.lastActionAt),
        "max",
      ),
      ordered: mirrors.filter((m) => m.milestones?.ordered).length,
      stalled: mirrors.filter((m) => m.counters.imagesGenerated === 0).length,
      pages: sum((m) => m.derived.pageCount),
      cast: sum((m) => m.derived.anchors?.total ?? 0),
      images,
      runs,
      edits: sum((m) => m.counters.edits),
      variations: sum((m) => m.counters.variations),
      restyles: sum((m) => m.counters.restyles),
      failures: sum((m) => m.counters.failures),
      qcCalls: sum((m) => m.counters.qcCalls),
      costUsd: r2(sum((m) => m.cost?.providerUsd ?? 0)),
      netUsd: pnl
        ? r2(sum((m) => pnl.get(projectDocKey(m.uid, m.projectId))?.netUsd ?? 0))
        : 0,
      sparksCharged: sum((m) => m.sparks?.charged ?? 0),
      sparksPaid: sum((m) => m.sparks?.paid ?? 0),
      sparksFree: sum((m) => m.sparks?.free ?? 0),
      avgPagesPerBook: r2(sum((m) => m.derived.pageCount) / n),
      avgCastPerBook: r2(sum((m) => m.derived.anchors?.total ?? 0) / n),
      avgImagesPerBook: r2(images / n),
      editRate: rate(sum((m) => m.counters.edits), runs),
      variationRate: rate(sum((m) => m.counters.variations), runs),
      failureRate: rate(sum((m) => m.counters.failures), runs),
      medianTimeToFirstImageMs: summarize(
        mirrors
          .map((m) => m.timing?.timeToFirstImageMs)
          .filter((v): v is number => typeof v === "number"),
      ).median,
      topModel: topKey(models),
      topTier: topKey(tiers),
      topArtStyle: topKey(styles),
    });
  }
  return out.sort((a, b) => b.lastActionAt - a.lastActionAt);
}
