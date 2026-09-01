"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { StoryRevisionDecision } from "../../../core/story/revision";
import {
  applyStoryRevisionToCurrent,
  buildStoryMergePlan,
  storyRevisionDecisionContext,
  storyTextHash,
} from "../../../core/story/revision";
import { useProjectsStore } from "../../../state/projectsStore";
import {
  finishStoryRevision,
  saveStoryRevisionDecisions,
  startStoryRevision,
  subscribeStoryRevisions,
  type StoryRevisionWithId,
} from "../../../platform/storyRevisions";
import { notify } from "../../lib/notify";
import { useStudio } from "../StudioContext";

const OPEN_STATUSES = new Set(["pending", "running", "ready", "error"]);

export function useStoryRevision() {
  const project = useProjectsStore((state) => state.current());
  const { updateStory, endStoryHistoryGesture } = useStudio();
  const [revisions, setRevisions] = useState<StoryRevisionWithId[]>([]);
  const [starting, setStarting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!project?.id) {
      setRevisions([]);
      return;
    }
    return subscribeStoryRevisions(project.id, setRevisions);
  }, [project?.id]);

  const rawRevision = useMemo(
    () => {
      const latest = revisions[0];
      return latest && OPEN_STATUSES.has(latest.status) ? latest : null;
    },
    [revisions],
  );

  const revision = useMemo(() => {
    if (
      !rawRevision?.proposal ||
      rawRevision.status !== "ready" ||
      !project
    ) {
      return rawRevision;
    }
    const plan = buildStoryMergePlan(
      rawRevision.baseStory,
      project.config.storyText,
      rawRevision.proposal,
    );
    const decisions = { ...(rawRevision.decisions ?? {}) };
    for (const change of plan.changes) {
      if (
        change.conflict &&
        decisions[change.id] &&
        rawRevision.decisionContexts?.[change.id] !==
          storyRevisionDecisionContext(change)
      ) {
        delete decisions[change.id];
      }
    }
    return { ...rawRevision, decisions };
  }, [project, rawRevision]);

  const start = useCallback(
    async (instruction: string) => {
      if (!project) return;
      setStarting(true);
      try {
        await startStoryRevision(project, instruction);
      } catch (err) {
        notify.error("Couldn’t refine the story", (err as Error).message);
        throw err;
      } finally {
        setStarting(false);
      }
    },
    [project],
  );

  const decide = useCallback(
    async (changeId: string, decision: StoryRevisionDecision) => {
      if (!revision?.proposal || revision.status !== "ready") return;
      const previous = revision.decisions?.[changeId];
      const previousContext = revision.decisionContexts?.[changeId];
      const mergeChange = project
        ? buildStoryMergePlan(
            revision.baseStory,
            project.config.storyText,
            revision.proposal,
          ).changes.find((change) => change.id === changeId)
        : undefined;
      const context =
        mergeChange?.conflict
          ? storyRevisionDecisionContext(mergeChange)
          : undefined;
      setRevisions((items) =>
        items.map((item) =>
          item.id === revision.id
            ? {
                ...item,
                decisions: { ...(item.decisions ?? {}), [changeId]: decision },
                ...(context
                  ? {
                      decisionContexts: {
                        ...(item.decisionContexts ?? {}),
                        [changeId]: context,
                      },
                    }
                  : {}),
              }
            : item,
        ),
      );
      try {
        await saveStoryRevisionDecisions(
          revision.id,
          { [changeId]: decision },
          context ? { [changeId]: context } : undefined,
        );
      } catch (err) {
        setRevisions((items) =>
          items.map((item) => {
            if (item.id !== revision.id) return item;
            const decisions = { ...(item.decisions ?? {}) };
            const decisionContexts = { ...(item.decisionContexts ?? {}) };
            if (previous) decisions[changeId] = previous;
            else delete decisions[changeId];
            if (previousContext) decisionContexts[changeId] = previousContext;
            else delete decisionContexts[changeId];
            return { ...item, decisions, decisionContexts };
          }),
        );
        notify.error("Review wasn’t saved", (err as Error).message);
      }
    },
    [project, revision],
  );

  const finish = useCallback(
    async (mode: "all" | "selected" | "discard") => {
      if (!revision?.proposal || revision.status !== "ready" || !project) return;
      setSaving(true);
      try {
        const live = useProjectsStore.getState().current();
        if (!live || live.id !== project.id) return;
        const currentStory = live.config.storyText;
        const plan = buildStoryMergePlan(
          revision.baseStory,
          currentStory,
          revision.proposal,
        );
        const decisions: Record<string, StoryRevisionDecision> = {};
        for (const change of revision.proposal.changes) {
          const mergeChange = plan.changes.find((item) => item.id === change.id);
          if (
            mode === "all" &&
            mergeChange?.conflict &&
            !revision.decisions?.[change.id]
          ) {
            throw new Error(
              "Choose “Keep mine” or “Use suggestion” for each overlapping edit first.",
            );
          }
          decisions[change.id] =
            mode === "all"
              ? mergeChange?.conflict
                ? revision.decisions![change.id]
                : "accepted"
              : mode === "discard"
                ? "rejected"
                : revision.decisions?.[change.id] ?? "rejected";
        }
        await saveStoryRevisionDecisions(revision.id, decisions);

        if (mode === "discard") {
          await finishStoryRevision(revision.id, "discarded");
          notify.info("Revision discarded", "Your manuscript was left unchanged.");
          return;
        }

        const nextStory = applyStoryRevisionToCurrent(
          revision.baseStory,
          currentStory,
          revision.proposal,
          decisions,
        );
        if (currentStory !== nextStory) {
          endStoryHistoryGesture();
          await updateStory({ storyText: nextStory });
        }
        await finishStoryRevision(revision.id, "applied", storyTextHash(nextStory));
        notify.success(
          mode === "all" ? "All changes kept" : "Selected changes kept",
          "The manuscript has been updated.",
        );
      } catch (err) {
        notify.error("Revision wasn’t applied", (err as Error).message);
      } finally {
        setSaving(false);
      }
    },
    [endStoryHistoryGesture, project, revision, updateStory],
  );

  return {
    revision,
    starting,
    saving,
    start,
    decide,
    keepAll: () => finish("all"),
    keepSelected: () => finish("selected"),
    discardAll: () => finish("discard"),
  };
}
