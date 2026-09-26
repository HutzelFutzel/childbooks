"use client";

/**
 * The Chat's background work, driven from the book.
 *
 * Every effect here is idempotent and reads the live project, so running it on
 * every render is safe: a reload, a second tab or a job finishing elsewhere
 * converges on the same state instead of starting anything twice.
 */
import { useEffect, useRef } from "react";
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
  // who is in the story, then the page plan.
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
  }, [loaded, locked, storyText, projectId, setExtractionError]);

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
  useEffect(() => {
    if (!loaded || locked) return;
    void ensurePlan(projectId).catch(() => {});
  }, [
    loaded,
    locked,
    projectId,
    hardcover,
    analysisAt,
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
  useEffect(() => {
    if (!loaded || !drawPhase || drawPhase === "done") return;
    if (followed.current !== drawPhase) {
      followed.current = drawPhase;
      setView(drawPhase === "cast" ? "cast" : "pages");
    }
    void continueDrawBook().catch((err) => useChatStudio.setState({ error: describeError(err) }));
  }, [loaded, drawPhase, drawJob, project, journey.activeUnitIds, setView]);

  // Unprompted lines: each is said once, and only when it is news.
  useEffect(() => {
    if (!loaded) return;
    const cast = namedCast(briefOf(project.config));
    const firstDrawn = cast.find((m) => currentPortrait(project, m.id));
    if (firstDrawn && !said("firstPortrait")) {
      const portrait = currentPortrait(project, firstDrawn.id)!;
      say(
        [{ key: "firstPortrait", priority: "result", vars: { names: firstDrawn.name.trim() } }],
        {
          receipt: {
            parts: [],
            thumb: { blobId: portrait.blobId, unitId: firstDrawn.id, view: "cast" },
          },
        },
      );
      return;
    }
    const well = journey.chatWell;
    if (well?.kind === "portraits" && !said("drawThem")) {
      say([{ key: "drawThem", priority: "result" }]);
      return;
    }
    if (well?.kind === "account" && !said("accountFirst")) {
      say([{ key: "accountFirst", priority: "blocking" }]);
      return;
    }
    const hc = journey.hardcover;
    if (journey.phase === "story" && hc && (hc.case === "spread" || hc.case === "short")) {
      const mark = `hc:${hc.case}:${hc.pages}`;
      if (!said(mark)) {
        say(
          [
            hc.case === "spread"
              ? { key: "hardcoverSpread", priority: "result", vars: { count: hc.pages } }
              : { key: "hardcoverShort", priority: "result", vars: { min: hc.hardcoverMin, count: hc.softcoverPages ?? hc.pages } },
          ],
          { marks: [mark] },
        );
        return;
      }
    }
    if (well?.kind === "pageFix" && !said(`fix:${well.unitId}`)) {
      say([{ key: "pageAttention", priority: "blocking", vars: { n: well.page } }], { marks: [`fix:${well.unitId}`] });
      return;
    }
    if (journey.phase === "order" && !said("printReady")) {
      say([
        { key: "pagesDone", priority: "result" },
        { key: "printReady", priority: "question" },
      ]);
    }
  }, [loaded, project, journey.chatWell, journey.phase, journey.hardcover, say, said]);
}

function liveProject(projectId: string): Project | null {
  const project = useProjectsStore.getState().current();
  return project?.id === projectId ? project : null;
}
