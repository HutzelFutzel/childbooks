/**
 * The Chat studio's paid actions, each one quote and one tap.
 *
 * Selecting a subject or an instruction never spends Sparks. The scoped button
 * names what will be drawn and shows the estimate; the tap confirms exactly
 * that stored quote. The one exception is the portraits: the style tap, or a
 * look tap once the book has a style, shows their price first and starts them
 * if the quote is within it (`portraitAutoStart.ts`); otherwise the portraits
 * button stays. The worker holds every unit to
 * the quote's number and consumes each unit once, and every job id here is
 * derived from the quote, so a reload, a double tap or a return URL lands on
 * the job that already exists instead of charging twice.
 *
 * Writes the book only through `projectsStore`; results are folded in by
 * `jobsStore` reconciliation, which drops anything made for an older version.
 */
import { gainedCast } from "../core/book/pageCast";
import { changesTheScene } from "../core/pipeline/editScope";
import type { GenerationQuote, GenerationQuoteUnit } from "../core/billing/generationQuote";
import { quoteIsCurrent } from "../core/billing/generationQuote";
import {
  COVER_BACK_ID,
  COVER_FRONT_ID,
  SPINE_ID,
  type Project,
} from "../core/types";
import { estimateJobRange, formatDurationRange, type LatencyStats } from "../core/config/latencyStats";
import { CUSTOMER_IMAGE_TIER } from "../core/config/modelConfig";
import { JOB_TASK_CONCURRENCY } from "../core/jobs/types";
import { unitIsDone } from "../core/book/pageCompletion";
import { briefOf, namedCast } from "../core/story/brief";
import { type RedrawMode } from "../core/guide/redrawMode";
import {
  currentPortrait,
  portraitInputs,
  portraitsToDraw,
  withPortraitAnchorReferences,
} from "../core/guide/portrait";
import { applyAutomaticBookFrame, type NormRect } from "../core/design";
import { pickRandomActiveMaskId, type ImageMasksConfig } from "../core/config/imageMasks";
import { getCursor } from "../core/versioning";
import { authoringOf, withAuthoring } from "../core/guide/projectState";
import { anchorsToPrepare } from "../core/book/anchorFreshness";
import { illustrationUnits } from "../core/book/units";
import type { ImageActionId } from "../core/ai/actions";
import {
  createAnchorsJob,
  createBookJob,
  createPortraitJob,
  createRefreshJob,
  fetchJob,
  fetchJobTasks,
} from "../platform/jobs";
import type { BookTask } from "../core/jobs/types";
import { effectiveAnchorIds } from "../core/book/anchorRefs";
import { spreadsById } from "../core/book/units";
import { requestGenerationQuoteRemote } from "../platform/aiClient";
import { getResolvedModels } from "./ai";
import { useProjectsStore } from "./projectsStore";
import { useAppConfigStore } from "./appConfigStore";
import { coverLetteringAllowed, coverLinesOf } from "../core/book/coverLines";
import { useJobsStore } from "./jobsStore";
import { staleIllustrationSpreadIds } from "./ai";
import { clientReferenceLimits } from "./referenceLimits";
import {
  plannedAnchorReferences,
  plannedIllustrationReferences,
  plannedPortraitReferences,
} from "../core/billing/referencePlan";

export function illustrationActionFor(id: string): ImageActionId {
  return id === COVER_FRONT_ID || id === COVER_BACK_ID || id === SPINE_ID
    ? "coverIllustration"
    : "pageIllustration";
}

// --- What each action would draw -------------------------------------------

// Every unit carries the reference images it plans to send, so it is priced
// from renders that sent about as many (`referencePlan`).

export function portraitUnits(project: Project, castIds: readonly string[]): GenerationQuoteUnit[] {
  const limits = clientReferenceLimits("portrait");
  return castIds.map((id) => ({
    id,
    action: "portrait",
    kind: "fresh",
    refs: plannedPortraitReferences(project, id, limits),
  }));
}

/**
 * Everything Draw the book authorizes: the reference sheets not already
 * current, the covers and every inside page not already done. Portraits already
 * paid for are not included again — they are not units of this batch.
 */
export function drawBookUnits(project: Project): GenerationQuoteUnit[] {
  const prepared = withPortraitAnchorReferences(project);
  const toPrepare = anchorsToPrepare(prepared);
  const anchorLimits = clientReferenceLimits("anchorImage");
  const anchors = toPrepare.map<GenerationQuoteUnit>((anchor) => ({
    id: anchor.id,
    action: "anchorImage",
    kind: "fresh",
    refs: plannedAnchorReferences(prepared, anchor.id, {}, anchorLimits),
  }));
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
    .map<GenerationQuoteUnit>((unit) => {
      const action = illustrationActionFor(unit.id);
      return {
        id: unit.id,
        action,
        kind: "fresh",
        refs: plannedIllustrationReferences(prepared, unit.id, { sheetsComing: redrawn }, clientReferenceLimits(action)),
      };
    });
  return [...anchors, ...pages];
}

/**
 * How long drawing these units usually takes, for the line said when it
 * starts. Sheets and pages run one after the other; each wave is the worker's
 * own batch size. "a few minutes" when there is nothing to time.
 */
export function bookDrawDuration(units: readonly { action: string }[], stats: LatencyStats): string {
  const sheets = units.filter((unit) => unit.action === "anchorImage").length;
  const pictures = units.length - sheets;
  if (sheets + pictures === 0) return "a few minutes";
  const parts = [
    sheets > 0 ? estimateJobRange(stats, "anchorImage", CUSTOMER_IMAGE_TIER, sheets, JOB_TASK_CONCURRENCY) : null,
    pictures > 0 ? estimateJobRange(stats, "pageIllustration", CUSTOMER_IMAGE_TIER, pictures, JOB_TASK_CONCURRENCY) : null,
  ].filter((range): range is NonNullable<typeof range> => range != null);
  return formatDurationRange({
    minMs: parts.reduce((sum, range) => sum + range.minMs, 0),
    maxMs: parts.reduce((sum, range) => sum + range.maxMs, 0),
  }).replace(/^~/, "");
}

/** One failed page or cover drawn again as it was asked for. */
export function pageRetryUnits(project: Project, unitId: string): GenerationQuoteUnit[] {
  const action = illustrationActionFor(unitId);
  return [
    { id: unitId, action, kind: "fresh", refs: plannedIllustrationReferences(project, unitId, {}, clientReferenceLimits(action)) },
  ];
}

/** The book job's tasks for exactly the units a quote covers. */
export function bookTasksFor(quote: GenerationQuote): BookTask[] {
  return quote.units.map<BookTask>((unit) =>
    unit.action === "anchorImage"
      ? { id: unit.id, kind: "anchors", status: "pending" }
      : { id: unit.id, kind: "refresh", status: "pending", options: {} },
  );
}

/**
 * What one picture change draws. A portrait or page that is already drawn is
 * edited ("edit": the current picture goes in and only the change is made); a
 * new picture ("new") is drawn from scratch. A portrait that can't be edited
 * (the model can't take a picture in) is drawn anew from the description.
 */
export function redrawUnits(
  project: Project,
  unitId: string,
  action: ImageActionId,
  mode: RedrawMode = "edit",
): GenerationQuoteUnit[] {
  const limits = clientReferenceLimits(action);
  if (action === "portrait") {
    if (mode === "edit" && limits.referenceEditing) {
      return [{ id: unitId, action, kind: "edit", refs: plannedPortraitReferences(project, unitId, limits, { edit: true }) }];
    }
    return [{ id: unitId, action, kind: "fresh", refs: plannedPortraitReferences(project, unitId, limits) }];
  }
  if (mode === "new") {
    return [{ id: unitId, action, kind: "fresh", refs: plannedIllustrationReferences(project, unitId, {}, limits) }];
  }
  return [
    {
      id: unitId,
      action,
      kind: "edit",
      refs: plannedIllustrationReferences(project, unitId, { useReference: true }, limits),
    },
  ];
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

/**
 * Lock in one checked shape before the first picture, so the choice survives
 * a closed tab. Pages already framed by the reader are left as they are.
 * Transparent cutouts stay unframed.
 */
function withChosenBookFrame(project: Project, masks: ImageMasksConfig): Project {
  const design = project.design;
  if (!design) return project;
  const maskId = design.defaultImageMaskId ?? pickRandomActiveMaskId(masks);
  if (!maskId) return project;
  const transparent = new Set<string>();
  for (const [id, tree] of Object.entries(project.illustrations ?? {})) {
    const art = getCursor(tree).content;
    if (art.generation?.applied.background === "transparent") transparent.add(id);
  }
  const next = applyAutomaticBookFrame(design, maskId, { transparentPageIds: transparent });
  if (next === design) return project;
  return { ...project, design: next };
}

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
  // Nor while someone's portrait is still being drawn, redraws of a current one included.
  const drawing = useJobsStore.getState().activeUnitIds;
  if (namedCast(briefOf(before.config)).some((member) => drawing.has(member.id))) return false;
  const languages = useAppConfigStore.getState().bookLanguages;
  const masks = useAppConfigStore.getState().imageMasks;
  await store.patchCurrent((live) => {
    const seeded = withChosenBookFrame(withPortraitAnchorReferences(live), masks);
    const cover = authoringOf(live).cover;
    // Decided once, when the book is drawn, so a later redraw paints the same way.
    const painted =
      cover?.painted ??
      (coverLetteringAllowed(live.config.contentLocale, languages) && Boolean(coverLinesOf(live).title));
    return withAuthoring(
      { ...seeded, stage: "studio", furthestStage: "studio" },
      {
        lockedAt: authoringOf(live).lockedAt ?? Date.now(),
        drawBook: bookRun(quote),
        cover: { ...cover, ...(painted ? { painted: true } : {}) },
      },
    );
  });
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
  try {
    await createBookJob(project, getResolvedModels(quote.tier), bookTasksFor(quote), quote.tier, {
      quoteId: quote.id,
      idempotencyKey: bookJobId(quote.id),
      notify: true,
    });
  } catch (err) {
    // The run was already recorded; without a job it would wait for one forever.
    // End it with the reason, so the well offers a fresh price right away.
    const jobId = bookJobId(quote.id);
    await useProjectsStore
      .getState()
      .patchCurrent((live) => {
        const current = authoringOf(live).drawBook;
        if (!current || current.jobId !== jobId) return live;
        return withAuthoring(live, { drawBook: { ...current, phase: "done", error: NEVER_STARTED_ERROR } });
      })
      .catch(() => undefined);
    throw err;
  }
}

/** How long a started run waits for its job document before it is declared lost. */
const JOB_APPEAR_MS = 2 * 60_000;

const NEVER_STARTED_ERROR = "Drawing didn't start. Nothing was charged, so you can simply try again.";
const STALLED_BOOK_ERROR = "Drawing stopped responding. Nothing was charged for what is missing, so you can try again.";

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
  let job = jobs.jobStatus[run.jobId];
  // The listener can miss the terminal write. A quiet book (nothing still
  // drawing) is exactly when that miss leaves the run looking unfinished.
  const idle = jobs.activeUnitIds.size === 0;
  const stalled = Boolean(job?.stalled);
  if (!job || (idle && job.status !== "done" && job.status !== "error")) {
    const fresh = await fetchJob(run.jobId).catch(() => null);
    if (fresh) job = { ...fresh, ...(stalled ? { stalled: true } : {}) };
  }
  const jobId = run.jobId;
  const patch = (next: { phase: "cast" | "pages" | "done"; error?: string }) =>
    useProjectsStore.getState().patchCurrent((live) => {
      const current = authoringOf(live).drawBook;
      if (!current || current.jobId !== jobId) return live;
      return withAuthoring(live, { drawBook: { ...current, ...next } });
    });
  if (!job) {
    // The job document never appeared (the request that creates it failed or
    // was lost). Waiting longer will not conjure it: end the run so the reader
    // is offered a fresh price instead of an endless spinner.
    if (Date.now() - run.startedAt > JOB_APPEAR_MS) await patch({ phase: "done", error: NEVER_STARTED_ERROR });
    return;
  }
  if (job.status === "done" || job.status === "error") {
    const refused = jobs.refusedJobs.find((r) => r.id === run.jobId);
    const error = refused?.error ?? (job.status === "error" ? job.error : undefined);
    await patch({ phase: "done", ...(error ? { error } : {}) });
    return;
  }
  // Open, but the server has gone quiet past every bound it keeps: it is not
  // going to deliver the rest. End the run; what is missing can be asked for
  // again, and nothing missing was charged.
  if (job.stalled) {
    await patch({ phase: "done", error: STALLED_BOOK_ERROR });
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

/**
 * A run that has really ended can still look open here (the listener missed the
 * last write). Reconcile it first, so a finished book never refuses a redraw.
 */
async function projectOnceSettled(project: Project): Promise<Project> {
  const run = authoringOf(project).drawBook;
  if (!run?.jobId || (run.phase !== "cast" && run.phase !== "pages")) return project;
  await continueDrawBook().catch(() => undefined);
  const live = useProjectsStore.getState().current();
  return live && live.id === project.id ? live : project;
}

// --- Scoped redraws ---------------------------------------------------------

/**
 * Change one picture as the reader asked, against its own quote. The quote says
 * how: an "edit" unit changes the picture that is there (the current portrait,
 * page or cover goes in with the sentence); a "fresh" unit draws it anew.
 */
export async function startRedraw(
  quote: GenerationQuote,
  edit: string | Record<string, string>,
  region?: NormRect,
): Promise<boolean> {
  const current = useProjectsStore.getState().current();
  const unit = quote.units[0];
  if (!current || !unit || current.id !== quote.projectId) return false;
  const project = await projectOnceSettled(current);
  assertNotDrawing(project);
  // One sentence for one picture; a map when several people were changed together.
  const instructionFor = (id: string): string => (typeof edit === "string" ? edit : edit[id] ?? "").trim();
  if (unit.action === "portrait") {
    const cast = namedCast(briefOf(project.config));
    const items = quote.units.flatMap((each) => {
      const member = each.action === "portrait" ? cast.find((m) => m.id === each.id) : undefined;
      if (!member) return [];
      const current = currentPortrait(project, member.id);
      const instruction = instructionFor(member.id);
      const change = each.kind === "edit" && instruction && current
        ? { edit: { instruction, blobId: current.blobId, mimeType: current.mimeType } }
        : {};
      return [{ id: member.id, status: "pending" as const, inputs: portraitInputs(project, member), ...change }];
    });
    if (items.length === 0) return false;
    await createPortraitJob(project, items, quote.tier, { quoteId: quote.id, idempotencyKey: `redraw-${quote.id}` });
    return true;
  }
  // One page, or several pages changed by the same sentence: one job, one price.
  await createRefreshJob(
    project,
    getResolvedModels(quote.tier),
    quote.units
      .filter((each) => each.action !== "portrait")
      .map((each) => ({
        id: each.id,
        status: "pending" as const,
        options:
          each.kind === "edit"
            ? {
                edit: instructionFor(each.id),
                useReference: true,
                // Somebody added to the page is a new picture of it, not an edit that can stay in place; so
                // is a change between subjects ("the same size as Amanda"), which no one subject can do alone.
                ...(changesTheScene(instructionFor(each.id), project.anchors)
                  ? { wholePage: true }
                  : gainedCast(project, each.id)
                    ? {}
                    : { inPlaceOnly: true }),
                // Only for one picture changed on its own: a spot means nothing across several.
                ...(region && quote.units.length === 1 ? { region } : {}),
              }
            : {},
      })),
    quote.tier,
    { quoteId: quote.id, idempotencyKey: `redraw-${quote.id}` },
  );
  return true;
}

/** Retry the failed pages only, against a fresh quote naming just them. */
export async function startPageRetry(quote: GenerationQuote): Promise<boolean> {
  const current = useProjectsStore.getState().current();
  if (!current || current.id !== quote.projectId) return false;
  const project = await projectOnceSettled(current);
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
  project: Project,
  unitIds: readonly string[],
): GenerationQuoteUnit[] {
  const prepared = withPortraitAnchorReferences(project);
  const limits = clientReferenceLimits("anchorImage");
  return unitIds.map((id) => ({
    id,
    action: "anchorImage" as const,
    kind: "fresh" as const,
    refs: plannedAnchorReferences(prepared, id, {}, limits),
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
