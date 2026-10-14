/**
 * What runs behind the Chat while the reader reads.
 *
 * Own-words extraction, story analysis and the page plan each rerun only on a
 * real change to the story (someone added or removed, an age changed, what
 * happens changed), only while the story step is still current, and only once
 * a burst of typing has settled. A result commits only against the story it
 * was made from; the previous result stays visible until it is replaced.
 * Starting the pages locks all of it.
 */
import { resolveAudienceProfile } from "../core/config/audience";
import { describeError } from "../core/errors";
import { hardcoverCheck, pageTargetFor, type HardcoverCheck } from "../core/guide/hardcover";
import { journeyEntry } from "../core/guide/journey";
import {
  manuscriptHash,
  ownWordsStatus,
  sanitizeManuscriptCast,
  storyHandedOver,
  withAnalysisCharacters,
  withManuscriptCast,
} from "../core/guide/ownWords";
import { authoringOf, withAuthoring } from "../core/guide/projectState";
import { isRealStoryChange } from "../core/guide/storyChange";
import { guideCopy } from "../core/guide/copy";
import { withInventedTitle, withManuscriptHeading } from "../ui/guide/bookTitle";
import { readManuscript, withoutHeading } from "../core/story/manuscriptShape";
import type { Project } from "../core/types";
import { analyzeStoryRemote, guideExtractCastRemote } from "../platform/aiClient";
import { createScreenplayJob } from "../platform/jobs";
import { useGuidePreference } from "../ui/guide/guidePreference";
import { useAppConfigStore } from "./appConfigStore";
import { useChatStudio } from "./chatStudio";
import { useJobsStore } from "./jobsStore";
import { useProjectsStore } from "./projectsStore";

function live(projectId: string): Project | null {
  const project = useProjectsStore.getState().current();
  return project?.id === projectId ? project : null;
}

/** A story to read: written, not locked, and (for own words) handed over. */
function storyOpen(project: Project): boolean {
  return (
    !authoringOf(project).lockedAt &&
    Boolean(project.config.storyText.trim()) &&
    journeyEntry(project) !== null &&
    storyHandedOver(project)
  );
}

// --- Own words ----------------------------------------------------------------

let extractionToken = 0;

export function needsExtraction(project: Project): boolean {
  if (!storyOpen(project) || journeyEntry(project) !== "own") return false;
  const extraction = authoringOf(project).extraction;
  if (!extraction) return true;
  if (extraction.storyHash === manuscriptHash(project.config.storyText)) return false;
  return true;
}

/** Read names and stated ages from the manuscript, without rewriting it. */
export async function runExtraction(projectId: string): Promise<void> {
  const project = live(projectId);
  if (!project || !needsExtraction(project)) return;
  const token = ++extractionToken;
  const story = project.config.storyText;
  const chat = useChatStudio.getState();
  chat.setExtractionError(null);
  chat.setExtractionRunning(true);
  try {
    const raw = await guideExtractCastRemote({
      projectId,
      story: withoutHeading(story),
      guidePreference: useGuidePreference.getState().preference,
    });
    if (token !== extractionToken) return;
    const current = live(projectId);
    if (!current || !storyOpen(current)) return;
    if (isRealStoryChange(story, current.config.storyText)) return;
    const found = sanitizeManuscriptCast(raw, current.config.storyText);
    const firstRead = !authoringOf(current).extraction;
    await useProjectsStore
      .getState()
      .patchCurrent((p) => (p.id === projectId ? withManuscriptCast(p, found, p.config.storyText) : p));
    if (firstRead && found.unclear.length > 0) {
      useChatStudio.getState().say([{ key: "castFix", priority: "blocking" }], { unprompted: true });
    }
  } catch (err) {
    // Extraction is advisory, but an invisible failure strands the own-words
    // journey because analysis waits for a current extraction. Keep the story
    // intact and put retry/manual recovery in the composer well.
    useChatStudio.getState().setExtractionError(describeError(err));
  } finally {
    if (token === extractionToken) useChatStudio.getState().setExtractionRunning(false);
  }
}

// --- Analysis -----------------------------------------------------------------

let analysisToken = 0;

export function needsAnalysis(project: Project): boolean {
  if (!storyOpen(project)) return false;
  if (authoringOf(project).storyRun?.status === "running") return false;
  if (journeyEntry(project) === "own") {
    const own = ownWordsStatus(project);
    if (!own.read || own.unresolved.length > 0) return false;
  }
  const analysis = project.analysis;
  if (!analysis) return true;
  return isRealStoryChange(analysis.sourceStoryText ?? "", project.config.storyText);
}

/** Who is in the story, from the text on screen. An older run is dropped. */
export async function runAnalysis(projectId: string): Promise<boolean> {
  const project = live(projectId);
  if (!project || !needsAnalysis(project)) return false;
  const token = ++analysisToken;
  const story = project.config.storyText;
  const result = await analyzeStoryRemote(project);
  if (token !== analysisToken) return false;
  const current = live(projectId);
  if (!current || !storyOpen(current) || isRealStoryChange(story, current.config.storyText)) return false;
  await useProjectsStore.getState().setAnalysis(
    { summary: result.summary, generatedAt: Date.now(), model: result.model, sourceStoryText: story },
    result.anchors,
    result.embeddings,
  );
  // A reader's own story may open with its title lines; they go on the cover
  // as written, and the analysis only adds subtitle ideas to choose from.
  const own = journeyEntry(project) === "own";
  const heading = own ? readManuscript(story).heading : null;
  await useProjectsStore.getState().patchCurrent((project) => {
    if (project.id !== projectId) return project;
    const cast = withAnalysisCharacters(project, result.anchors);
    const titled = heading ? withManuscriptHeading(cast, heading) : withInventedTitle(cast, result.title ?? "");
    if (!own || !result.subtitles?.length) return titled;
    return withAuthoring(titled, { cover: { ...authoringOf(titled).cover, subtitleIdeas: result.subtitles.slice(0, 3) } });
  });
  const mark = `cast:${manuscriptHash(story)}`;
  const chat = useChatStudio.getState();
  if (!chat.said(mark)) {
    const people = result.anchors.filter((anchor) => anchor.include && anchor.type === "character").map((anchor) => anchor.name);
    const places = result.anchors.filter((anchor) => anchor.include && anchor.type === "place").map((anchor) => anchor.name);
    const wording = useAppConfigStore.getState().guide.wording;
    const parts = [
      people.length > 0 ? { value: guideCopy(wording, "foundCast", { names: people }) } : null,
      places.length > 0 ? { value: guideCopy(wording, "foundPlaces", { names: places }) } : null,
    ].filter((part): part is { value: string } => Boolean(part));
    if (parts.length > 0) {
      chat.say([], { marks: [mark, "foundCast"], receipt: { parts }, unprompted: true });
    }
  }
  return true;
}

/**
 * Continue every story-dependent stage that is currently unblocked.
 *
 * This is called after the manuscript settles and after recovery/cast edits,
 * so the pipeline does not depend on another storyText change to make progress.
 */
export async function advanceStoryPipeline(
  projectId: string,
  options: { extract?: boolean; retryPlan?: boolean } = {},
): Promise<void> {
  const chat = useChatStudio.getState();
  chat.setExtractionError(null);
  try {
    const before = live(projectId);
    if (!before) return;
    if (options.extract !== false && needsExtraction(before)) {
      await runExtraction(projectId);
      if (useChatStudio.getState().extractionError) return;
    }
    const current = live(projectId);
    if (
      current &&
      needsAnalysis(current) &&
      !useChatStudio.getState().analysisRunning
    ) {
      chat.setAnalysisRunning(true);
      try {
        await runAnalysis(projectId);
      } finally {
        chat.setAnalysisRunning(false);
      }
    }
    await ensurePlan(projectId, { retry: options.retryPlan });
  } catch (err) {
    chat.setAnalysisRunning(false);
    chat.setExtractionError(describeError(err));
  }
}

// --- Hardcover and the page plan ----------------------------------------------

export function hardcoverFor(project: Project): HardcoverCheck | null {
  if (!project.config.storyText.trim()) return null;
  const profile = resolveAudienceProfile(project.config.ageRangeId, useAppConfigStore.getState().audience);
  return hardcoverCheck(project.config, profile.density, authoringOf(project).hardcover);
}

function planBasis(project: Project, check: HardcoverCheck): string {
  // Physical trim does not affect pagination or the screenplay prompt. Keeping
  // it out means choosing a format remains an instant, non-generative decision.
  const notesAt = authoringOf(project).planNotesAt;
  return [
    project.analysis?.generatedAt ?? 0,
    check.pages,
    check.case,
    project.config.layoutId,
    ...(notesAt ? [`notes${notesAt}`] : []),
  ].join("|");
}

/** Whether the visible screenplay matches the currently reviewed book setup. */
export function planIsCurrent(project: Project): boolean {
  if (!project.screenplay) return false;
  const setup = authoringOf(project).bookSetup;
  if (!setup?.formatConfirmedAt || !setup.layoutConfirmedAt) return false;
  const check = hardcoverFor(project);
  return Boolean(check && authoringOf(project).planBasis === planBasis(project, check));
}

export function planRunning(project: Project): boolean {
  const jobs = useJobsStore.getState();
  const job = jobs.screenplayJob;
  const requested = authoringOf(project).planRequestedFor;
  if (requested) {
    if (job?.id === requested) return job.status === "pending" || job.status === "running";
    if (!jobs.jobsLoaded) return true;
  }
  return job?.status === "pending" || job?.status === "running";
}

/**
 * Start the page plan once the cast matches this draft, aiming at the page
 * count the hardcover check settled on. A later real change reruns it; the
 * previous plan stays until the new one replaces it.
 */
export async function ensurePlan(
  projectId: string,
  options: { retry?: boolean } = {},
): Promise<void> {
  const project = live(projectId);
  if (!project || !storyOpen(project) || !project.analysis || needsAnalysis(project)) return;
  const setup = authoringOf(project).bookSetup;
  if (!setup?.formatConfirmedAt || !setup.layoutConfirmedAt) return;
  const job = useJobsStore.getState().screenplayJob;
  const requested = authoringOf(project).planRequestedFor;
  if (requested && job?.id === requested && job.status === "error") {
    // The rerun failed: keep the plan on screen and stop waiting for it. The
    // next real change asks again.
    if (!options.retry) return;
    await useProjectsStore.getState().patchCurrent((p) =>
      withAuthoring(p, { planRequestedFor: undefined }),
    );
  }
  if (planRunning(project)) return;
  const check = hardcoverFor(project);
  if (!check) return;
  const target = pageTargetFor(check);
  const same = project.config.pageTarget;
  if (!same || same.pages !== target.pages || same.case !== target.case || same.wordsPerPage !== target.wordsPerPage) {
    await useProjectsStore.getState().updateConfig({ pageTarget: target });
  }
  const current = live(projectId);
  if (!current) return;
  const basis = planBasis(current, check);
  if (!current.screenplay) {
    const screenplayJob = useJobsStore.getState().screenplayJob;
    if (authoringOf(current).planBasis === basis && screenplayJob) {
      if (screenplayJob.status === "error") {
        await useJobsStore.getState().startScreenplay(current, options.retry);
      }
      return;
    }
    await useProjectsStore.getState().patchCurrent((p) => withAuthoring(p, { planBasis: basis }));
    await useJobsStore.getState().startScreenplay(live(projectId) ?? current);
    return;
  }
  if (authoringOf(current).planBasis === basis) {
    if (options.retry && job?.status === "error") {
      const retryId = await createScreenplayJob(current, { retry: true });
      await useProjectsStore
        .getState()
        .patchCurrent((p) => withAuthoring(p, { planRequestedFor: retryId }));
    }
    return;
  }
  if (!authoringOf(current).planBasis) {
    // A plan made elsewhere (Steps, or before this existed) is adopted as it is.
    await useProjectsStore.getState().patchCurrent((p) => withAuthoring(p, { planBasis: basis }));
    return;
  }
  const key = `${current.analysis!.generatedAt}-${basis.replace(/[^a-zA-Z0-9]/g, "")}`;
  const jobId = await createScreenplayJob(current, { key });
  await useProjectsStore.getState().patchCurrent((p) => withAuthoring(p, { planBasis: basis, planRequestedFor: jobId }));
}
