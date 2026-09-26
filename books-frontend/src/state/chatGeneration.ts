/**
 * The Chat studio's paid actions, each one quote and one tap.
 *
 * Selecting a source, a style, a subject or an instruction never spends
 * Sparks. The scoped button names what will be drawn and shows the estimate;
 * the tap confirms exactly that stored quote. The worker holds every unit to
 * the quote's number and consumes each unit once, and every job id here is
 * derived from the quote, so a reload, a double tap or a return URL lands on
 * the job that already exists instead of charging twice.
 *
 * Writes the book only through `projectsStore`; results are folded in by
 * `jobsStore` reconciliation, which drops anything made for an older version.
 */
import type { GenerationQuote, GenerationQuoteUnit } from "../core/billing/generationQuote";
import { quoteIsCurrent } from "../core/billing/generationQuote";
import {
  COVER_BACK_ID,
  COVER_FRONT_ID,
  SPINE_ID,
  type Project,
} from "../core/types";
import { CUSTOMER_IMAGE_TIER } from "../core/config/modelConfig";
import { unitIsDone } from "../core/book/pageCompletion";
import { briefOf, namedCast } from "../core/story/brief";
import {
  portraitInputs,
  portraitsToDraw,
  withPortraitAnchorReferences,
} from "../core/guide/portrait";
import { authoringOf, withAuthoring } from "../core/guide/projectState";
import { anchorsToPrepare } from "../core/book/anchorFreshness";
import { illustrationUnits } from "../core/book/units";
import type { ImageActionId } from "../core/ai/actions";
import {
  createAnchorsJob,
  createBookJob,
  createPortraitJob,
  createRefreshJob,
  fetchJobTasks,
} from "../platform/jobs";
import type { BookTask } from "../core/jobs/types";
import { effectiveAnchorIds } from "../core/book/anchorRefs";
import { spreadsById } from "../core/book/units";
import { requestGenerationQuoteRemote } from "../platform/aiClient";
import { getResolvedModels } from "./ai";
import { useProjectsStore } from "./projectsStore";
import { useJobsStore } from "./jobsStore";
import { staleIllustrationSpreadIds } from "./ai";

export function illustrationActionFor(id: string): ImageActionId {
  return id === COVER_FRONT_ID || id === COVER_BACK_ID || id === SPINE_ID
    ? "coverIllustration"
    : "pageIllustration";
}

// --- What each action would draw -------------------------------------------

export function portraitUnits(castIds: readonly string[]): GenerationQuoteUnit[] {
  return castIds.map((id) => ({ id, action: "portrait", kind: "fresh" }));
}

/**
 * Everything Draw the book authorizes: the reference sheets not already
 * current, the covers and every inside page not already done. Portraits already
 * paid for are not included again — they are not units of this batch.
 */
export function drawBookUnits(project: Project): GenerationQuoteUnit[] {
  const prepared = withPortraitAnchorReferences(project);
  const toPrepare = anchorsToPrepare(prepared);
  const anchors = toPrepare
    .map<GenerationQuoteUnit>((anchor) => ({ id: anchor.id, action: "anchorImage", kind: "fresh" }));
  const redrawn = new Set(toPrepare.map((anchor) => anchor.id));
  const stalePages = new Set(staleIllustrationSpreadIds(prepared));
  const spreads = spreadsById(prepared);
  // A finished page showing someone whose sheet is redrawn here would be out of
  // date the moment the sheet lands, so it's part of the same run.
  const drawsRedrawn = (id: string) => {
    const spread = spreads.get(id);
    return Boolean(spread && effectiveAnchorIds(prepared.anchors, spread).some((a) => redrawn.has(a)));
  };
  const pages = illustrationUnits(project)
    .filter((unit) => !unitIsDone(project, unit) || stalePages.has(unit.id) || drawsRedrawn(unit.id))
    .map<GenerationQuoteUnit>((unit) => ({ id: unit.id, action: illustrationActionFor(unit.id), kind: "fresh" }));
  return [...anchors, ...pages];
}

/** The book job's tasks for exactly the units a quote covers. */
export function bookTasksFor(quote: GenerationQuote): BookTask[] {
  return quote.units.map<BookTask>((unit) =>
    unit.action === "anchorImage"
      ? { id: unit.id, kind: "anchors", status: "pending" }
      : { id: unit.id, kind: "refresh", status: "pending", options: {} },
  );
}

export function redrawUnits(unitId: string, action: ImageActionId): GenerationQuoteUnit[] {
  return [{ id: unitId, action, kind: action === "portrait" ? "fresh" : "edit" }];
}

// --- Quotes -----------------------------------------------------------------

export async function quoteFor(
  project: Project,
  purpose: GenerationQuote["purpose"],
  units: GenerationQuoteUnit[],
): Promise<GenerationQuote> {
  return requestGenerationQuoteRemote({
    projectId: project.id,
    purpose,
    tier: CUSTOMER_IMAGE_TIER,
    units,
  });
}

export function quoteStillCovers(quote: GenerationQuote | null, project: Project, units: GenerationQuoteUnit[]): boolean {
  return Boolean(quote && quoteIsCurrent(quote, { projectId: project.id, units }));
}

// --- Portraits --------------------------------------------------------------

/**
 * Start the portrait batch the reader confirmed. A person added after the
 * quote is not silently added; the quote must name exactly who is drawn.
 */
export async function startPortraits(quote: GenerationQuote): Promise<boolean> {
  const project = useProjectsStore.getState().current();
  if (!project || project.id !== quote.projectId) return false;
  const cast = namedCast(briefOf(project.config));
  const members = quote.units
    .map((unit) => cast.find((m) => m.id === unit.id))
    .filter((m): m is NonNullable<typeof m> => Boolean(m));
  if (members.length !== quote.units.length) return false;
  await createPortraitJob(
    project,
    members.map((member) => ({ id: member.id, status: "pending", inputs: portraitInputs(project, member) })),
    quote.tier,
    { quoteId: quote.id, idempotencyKey: `portraits-${quote.id}` },
  );
  return true;
}

// --- Draw the book ----------------------------------------------------------

/** The book job's id for a quote: a reload or double tap lands on the same job. */
export function bookJobId(quoteId: string): string {
  return `book-${quoteId}`;
}

/**
 * Lock the earlier steps and hand the whole book to the server: sheets, then
 * the covers and pages drawn from them, in one job that finishes whether or
 * not this tab stays open. Each character's sheet is seeded from the portrait
 * the reader approved.
 */
export async function startDrawBook(quote: GenerationQuote): Promise<boolean> {
  const store = useProjectsStore.getState();
  const before = store.current();
  if (!before || before.id !== quote.projectId) return false;
  // A stale tab or quote must not bypass the journey's portrait checkpoint.
  // Every later character sheet is seeded from a portrait the reader could see.
  if (portraitsToDraw(before).length > 0) return false;
  const cover = authoringOf(before).cover;
  await store.patchCurrent((live) => {
    const seeded = withPortraitAnchorReferences(live);
    return withAuthoring(
      { ...seeded, stage: "studio", furthestStage: "studio" },
      {
        lockedAt: authoringOf(live).lockedAt ?? Date.now(),
        drawBook: bookRun(quote),
      },
    );
  });
  if (cover?.subtitle) await store.setCoverSubtitle(before.id, cover.subtitle);
  await launchBookJob(quote);
  return true;
}

/** Redraw what an established book needs (changed people, missing or failed pictures). */
export async function startBookUpdate(
  quote: GenerationQuote,
): Promise<boolean> {
  const store = useProjectsStore.getState();
  const before = store.current();
  if (!before || before.id !== quote.projectId) return false;
  await store.patchCurrent((live) =>
    withAuthoring(withPortraitAnchorReferences(live), { drawBook: bookRun(quote) }),
  );
  await launchBookJob(quote);
  return true;
}

function bookRun(quote: GenerationQuote): NonNullable<ReturnType<typeof authoringOf>["drawBook"]> {
  return {
    quoteId: quote.id,
    startedAt: Date.now(),
    phase: quote.units.some((unit) => unit.action === "anchorImage") ? "cast" : "pages",
    jobId: bookJobId(quote.id),
  };
}

async function launchBookJob(quote: GenerationQuote): Promise<void> {
  const project = useProjectsStore.getState().current();
  if (!project || project.id !== quote.projectId) return;
  await createBookJob(project, getResolvedModels(quote.tier), bookTasksFor(quote), quote.tier, {
    quoteId: quote.id,
    idempotencyKey: bookJobId(quote.id),
    notify: true,
  });
}

/**
 * Follow the book job: the pane moves from the sheets to the pages once no
 * sheet is left to draw, and the run ends when the job does. A job refused
 * before it drew anything records why, so the well can offer a fresh price.
 */
export async function continueDrawBook(): Promise<void> {
  const project = useProjectsStore.getState().current();
  if (!project) return;
  const run = authoringOf(project).drawBook;
  if (!run?.quoteId || run.phase === "done") return;
  if (!run.jobId) return continueLegacyDrawBook();
  const jobs = useJobsStore.getState();
  const job = jobs.jobStatus[run.jobId];
  if (!job) return;
  const jobId = run.jobId;
  const patch = (next: { phase: "cast" | "pages" | "done"; error?: string }) =>
    useProjectsStore.getState().patchCurrent((live) => {
      const current = authoringOf(live).drawBook;
      if (!current || current.jobId !== jobId) return live;
      return withAuthoring(live, { drawBook: { ...current, ...next } });
    });
  if (job.status === "done" || job.status === "error") {
    const refused = jobs.refusedJobs.find((r) => r.id === run.jobId);
    await patch({ phase: "done", ...(refused ? { error: refused.error } : {}) });
    return;
  }
  if (run.phase === "cast") {
    const sheetsLeft = anchorsToPrepare(withPortraitAnchorReferences(project)).some((a) =>
      jobs.activeUnitIds.has(a.id),
    );
    if (!sheetsLeft && jobs.activeUnitIds.size > 0) await patch({ phase: "pages" });
  }
}

/** Runs started before the book job existed: one client-driven phase at a time. */
async function continueLegacyDrawBook(): Promise<void> {
  let project = useProjectsStore.getState().current();
  if (!project) return;
  const run = authoringOf(project).drawBook;
  if (!run?.quoteId || run.phase === "done") return;
  const tier = CUSTOMER_IMAGE_TIER;
  const models = getResolvedModels(tier);
  const active = useJobsStore.getState().activeUnitIds;

  if (run.phase === "cast") {
    const withPortraits = withPortraitAnchorReferences(project);
    if (withPortraits !== project) {
      await useProjectsStore.getState().patchCurrent((live) =>
        live.id === project!.id ? withPortraitAnchorReferences(live) : live,
      );
      project = withPortraits;
    }
    const pending = anchorsToPrepare(project);
    const failed = useJobsStore.getState().failedUnits;
    if (pending.some((a) => active.has(a.id))) return;
    if (pending.some((a) => failed[a.id])) return;
    const toStart = pending.filter((a) => !failed[a.id]);
    if (toStart.length > 0) {
      await createAnchorsJob(
        project,
        models,
        toStart.map((a) => ({ id: a.id, status: "pending" })),
        tier,
        { quoteId: run.quoteId, idempotencyKey: `book-${run.quoteId}-cast` },
      );
      return;
    }
    await useProjectsStore.getState().patchCurrent((live) =>
      withAuthoring(live, { drawBook: { ...run, phase: "pages" } }),
    );
    return continueLegacyDrawBook();
  }

  if (run.phase === "pages") {
    const stalePages = new Set(staleIllustrationSpreadIds(project));
    const units = illustrationUnits(project).filter(
      (unit) => !unitIsDone(project, unit) || stalePages.has(unit.id),
    );
    if (units.some((unit) => active.has(unit.id))) return;
    const jobId = `book-${run.quoteId}-pages`;
    const tasks = await fetchJobTasks(jobId).catch(() => []);
    if (tasks.length === 0 && units.length > 0) {
      await createRefreshJob(
        project,
        models,
        units.map((unit) => ({ id: unit.id, status: "pending", options: {} })),
        tier,
        { quoteId: run.quoteId, idempotencyKey: jobId },
      );
      return;
    }
    await useProjectsStore.getState().patchCurrent((live) =>
      withAuthoring(live, { drawBook: { ...run, phase: "done" } }),
    );
  }
}

/** Redraws wait for a running Draw the book: both would draw the same pages. */
function assertNotDrawing(project: Project): void {
  const run = authoringOf(project).drawBook;
  if (run?.jobId && (run.phase === "cast" || run.phase === "pages")) {
    throw new Error("The book is still being drawn. Try this again once it's done.");
  }
}

// --- Scoped redraws ---------------------------------------------------------

/** Redraw one page or cover with the reader's sentence, against its own quote. */
export async function startRedraw(quote: GenerationQuote, edit: string): Promise<boolean> {
  const project = useProjectsStore.getState().current();
  const unit = quote.units[0];
  if (!project || !unit || project.id !== quote.projectId) return false;
  assertNotDrawing(project);
  if (unit.action === "portrait") {
    const member = namedCast(briefOf(project.config)).find((m) => m.id === unit.id);
    if (!member) return false;
    await createPortraitJob(
      project,
      [{ id: member.id, status: "pending", inputs: portraitInputs(project, member) }],
      quote.tier,
      { quoteId: quote.id, idempotencyKey: `redraw-${quote.id}` },
    );
    return true;
  }
  await createRefreshJob(
    project,
    getResolvedModels(quote.tier),
    [{ id: unit.id, status: "pending", options: { edit: edit.trim(), useReference: true } }],
    quote.tier,
    { quoteId: quote.id, idempotencyKey: `redraw-${quote.id}` },
  );
  return true;
}

/** Retry the failed pages only, against a fresh quote naming just them. */
export async function startPageRetry(quote: GenerationQuote): Promise<boolean> {
  const project = useProjectsStore.getState().current();
  if (!project || project.id !== quote.projectId) return false;
  assertNotDrawing(project);
  await createRefreshJob(
    project,
    getResolvedModels(quote.tier),
    quote.units.map((unit) => ({ id: unit.id, status: "pending", options: {} })),
    quote.tier,
    { quoteId: quote.id, idempotencyKey: `retry-${quote.id}` },
  );
  return true;
}

export function anchorRetryUnits(
  unitIds: readonly string[],
): GenerationQuoteUnit[] {
  return unitIds.map((id) => ({
    id,
    action: "anchorImage" as const,
    kind: "fresh" as const,
  }));
}

/**
 * Retries the invisible consistency preparation behind character portraits.
 * The quote remains explicit because this work consumes Sparks, even though
 * the implementation artifact itself is not part of the reader-facing UI.
 */
export async function startAnchorRetry(
  quote: GenerationQuote,
): Promise<boolean> {
  const current = useProjectsStore.getState().current();
  if (!current) return false;
  assertNotDrawing(current);
  const project = withPortraitAnchorReferences(current);
  const unitIds = new Set(quote.units.map((unit) => unit.id));
  const anchors = (project.anchors ?? []).filter(
    (anchor) =>
      anchor.include &&
      unitIds.has(anchor.id) &&
      quote.units.some(
        (unit) => unit.id === anchor.id && unit.action === "anchorImage",
      ),
  );
  if (anchors.length === 0) return false;

  const models = getResolvedModels(quote.tier);
  await createAnchorsJob(
    project,
    models,
    anchors.map((anchor) => ({ id: anchor.id, status: "pending" })),
    quote.tier,
    {
      quoteId: quote.id,
      idempotencyKey: `book-prep:${quote.id}`,
    },
  );
  return true;
}
