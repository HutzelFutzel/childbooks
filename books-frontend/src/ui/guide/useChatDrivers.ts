"use client";

/**
 * The Chat's background work, driven from the book.
 *
 * Every effect here is idempotent and reads the live project, so running it on
 * every render is safe: a reload, a second tab or a job finishing elsewhere
 * converges on the same state instead of starting anything twice.
 */
import { useEffect, useRef, useState } from "react";
import { authoringOf } from "../../core/guide/projectState";
import { STORY_SETTLE_MS } from "../../core/guide/storyChange";
import { autoAssignStyleSource } from "../../core/guide/styleSource";
import { currentPortrait } from "../../core/guide/portrait";
import { briefOf, namedCast } from "../../core/story/brief";
import type { Project } from "../../core/types";
import { ownWordsStatus, withAnalysisCharacters } from "../../core/guide/ownWords";
import { continueDrawBook } from "../../state/chatGeneration";
import { advanceStoryPipeline, ensurePlan, needsExtraction } from "../../state/chatPipeline";
import { useChatStudio } from "../../state/chatStudio";
import { useJobsStore } from "../../state/jobsStore";
import { useProjectsStore } from "../../state/projectsStore";
import { describeError } from "../../core/errors";
import type { ReceiptThumb } from "../../core/guide/session";
import type { GuideLineCandidate } from "../../core/guide/speech";
import type { ChatJourney } from "./useChatJourney";

export function useChatDrivers(project: Project, journey: ChatJourney): void {
  const loaded = useChatStudio((s) => s.loaded);
  const say = useChatStudio((s) => s.say);
  const said = useChatStudio((s) => s.said);
  const setExtractionError = useChatStudio((s) => s.setExtractionError);
  const projectId = project.id;
  const storyText = project.config.storyText;
  const locked = journey.locked;
  const anchorKey = (project.anchors ?? [])
    .filter((anchor) => anchor.include && anchor.type === "character")
    .map((anchor) => anchor.name)
    .join("|");

  useEffect(() => {
    if (!loaded || !anchorKey) return;
    const current = liveProject(projectId);
    if (!current) return;
    void useProjectsStore.getState().patchCurrent((live) => withAnalysisCharacters(live, live.anchors ?? []));
  }, [loaded, projectId, anchorKey]);

  const stagedStyleSource = project.authoringState?.styleSourceArt?.[0]?.blobId ?? "";
  const castKey = namedCast(briefOf(project.config))
    .map((member) => `${member.id}:${member.name}`)
    .join("|");
  useEffect(() => {
    if (!loaded || !stagedStyleSource) return;
    void useProjectsStore.getState().patchCurrent(autoAssignStyleSource);
  }, [loaded, stagedStyleSource, castKey]);

  // A burst of typing is one pause, then one run: extraction (own words), then
  // who is in the story, then the page plan. Own words wait for "My story is
  // ready"; the tap itself starts the run, and this picks it up after a reload.
  const readyAt = authoringOf(project).manuscriptReadyAt;
  const runId = useRef(0);
  useEffect(() => {
    if (!loaded || locked || !storyText.trim()) return;
    setExtractionError(null);
    const id = ++runId.current;
    const timer = setTimeout(async () => {
      const current = liveProject(projectId);
      if (!current) return;
      if (id !== runId.current) return;
      await advanceStoryPipeline(projectId);
    }, STORY_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [loaded, locked, storyText, readyAt, projectId, setExtractionError]);

  // Extraction results and cast corrections do not change storyText. Resume
  // analysis immediately when either one clears the own-words gate.
  const extraction = authoringOf(project).extraction;
  const own = ownWordsStatus(project);
  const recoveryKey = `${extraction?.storyHash ?? ""}:${own.unresolved.join("|")}:${castKey}`;
  useEffect(() => {
    if (!loaded || locked || !storyText.trim()) return;
    const current = liveProject(projectId);
    if (!current || needsExtraction(current)) return;
    void advanceStoryPipeline(projectId, { extract: false });
  }, [loaded, locked, storyText, projectId, recoveryKey]);

  // Layout and hardcover can change pagination. Physical trim cannot (and
  // choosing it must stay non-generative).
  const hardcover = authoringOf(project).hardcover;
  const bookSetup = authoringOf(project).bookSetup;
  const analysisAt = project.analysis?.generatedAt;
  const planNotesAt = authoringOf(project).planNotesAt;
  useEffect(() => {
    if (!loaded || locked) return;
    void ensurePlan(projectId).catch(() => {});
  }, [
    loaded,
    locked,
    projectId,
    hardcover,
    analysisAt,
    planNotesAt,
    project.config.layoutId,
    bookSetup?.formatConfirmedAt,
    bookSetup?.layoutConfirmedAt,
    journey.planRunning,
  ]);

  // Follow Draw the book: the pane moves with the job, and the run ends with it.
  const drawPhase = authoringOf(project).drawBook?.phase;
  const drawJobId = authoringOf(project).drawBook?.jobId;
  const drawJob = useJobsStore((s) => (drawJobId ? s.jobStatus[drawJobId] : undefined));
  const setView = useChatStudio((s) => s.setView);
  const followed = useRef<string | null>(null);
  // While a run is open, look again on a clock, not only when something changes.
  // A server that goes silent changes nothing, and silence is exactly what the
  // run has to notice (a job that never appeared, one that stopped responding).
  const drawing = loaded && Boolean(drawPhase) && drawPhase !== "done";
  const [pulse, setPulse] = useState(0);
  useEffect(() => {
    if (!drawing) return;
    const timer = setInterval(() => setPulse((n) => n + 1), 15_000);
    return () => clearInterval(timer);
  }, [drawing]);
  useEffect(() => {
    if (!loaded || !drawPhase || drawPhase === "done") return;
    if (followed.current !== drawPhase) {
      followed.current = drawPhase;
      setView(drawPhase === "cast" ? "cast" : "pages");
    }
    void continueDrawBook().catch((err) => useChatStudio.setState({ error: describeError(err) }));
  }, [loaded, drawPhase, drawJob, project, journey.activeUnitIds, setView, pulse]);

  // News the book reports on its own: each is said once. The lines that ask
  // for a well's buttons are said with the well (`useWellConversation`).
  const floor = useChatStudio((s) => s.floor);
  // Portraits finished before this visit are the away summary's news.
  const openedAt = useRef(Date.now());
  useEffect(() => {
    if (!loaded || floor > 0) return;
    const announced = portraitAnnouncement(project, journey, openedAt.current, said);
    if (announced) {
      say(announced.lines, { unprompted: true, marks: announced.marks, receipt: { parts: [], thumbs: announced.thumbs } });
      // The pictures that just arrived are what the book shows: the line above
      // points at them, so the pane is on the people, not wherever it was.
      // Never away from a story the reader is writing or reviewing.
      const chat = useChatStudio.getState();
      if (!chat.storyFocus && chat.view !== "cast") chat.setView("cast");
      return;
    }
    const hc = journey.hardcover;
    if (journey.phase === "story" && hc?.case === "spread") {
      const mark = `hc:${hc.case}:${hc.pages}`;
      if (!said(mark)) {
        say([{ key: "hardcoverSpread", priority: "result", vars: { count: hc.pages } }], { marks: [mark], unprompted: true });
      }
    }
  }, [loaded, floor, project, journey, say, said]);
}

/** More than this many, and "everyone" reads better than a list of names. */
const NAMED_AT_MOST = 3;

/**
 * One line per batch, once none of the characters is still drawing: every
 * portrait that arrived, named together with its thumbnail, and any that
 * didn't come out. Each portrait version is announced once.
 */
function portraitAnnouncement(
  project: Project,
  journey: ChatJourney,
  since: number,
  said: (mark: string) => boolean,
): { lines: GuideLineCandidate[]; marks: string[]; thumbs: ReceiptThumb[] } | null {
  const cast = namedCast(briefOf(project.config));
  if (cast.some((m) => journey.activeUnitIds.has(m.id))) return null;
  const fresh = cast.flatMap((member) => {
    const portrait = currentPortrait(project, member.id);
    return portrait && portrait.createdAt >= since && !said(`portrait:${portrait.blobId}`)
      ? [{ member, portrait }]
      : [];
  });
  if (fresh.length === 0) return null;
  const names = fresh.map(({ member }) => member.name.trim());
  const everyone = fresh.length === cast.length && fresh.length > NAMED_AT_MOST;
  const failed = cast
    .filter((m) => journey.failedUnits[m.id] && !currentPortrait(project, m.id))
    .map((m) => m.name.trim());
  const lines: GuideLineCandidate[] = [
    {
      key: everyone ? "portraitsAllReady" : fresh.length === 1 ? "firstPortrait" : "portraitsReady",
      priority: "result",
      vars: { names },
    },
    ...(failed.length > 0
      ? [{ key: "portraitsFailed" as const, priority: "result" as const, vars: { names: failed } }]
      : []),
  ];
  return {
    lines,
    marks: fresh.map(({ portrait }) => `portrait:${portrait.blobId}`),
    thumbs: fresh.map(({ member, portrait }) => ({ blobId: portrait.blobId, unitId: member.id, view: "cast" as const })),
  };
}

function liveProject(projectId: string): Project | null {
  const project = useProjectsStore.getState().current();
  return project?.id === projectId ? project : null;
}
