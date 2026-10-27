/**
 * Working new people into a story that is already written, without a review step.
 *
 * The parent asked for these people, so the guide does it and says so; the usual review of a story edit
 * (accept or reject each change) is for edits the parent did not ask for in so many words. What keeps it
 * safe instead:
 *
 *  - the story is only replaced if it is still the one the edit was written for, and the people are still
 *    in the book (an Undo in between leaves the story alone);
 *  - the edit is the same minimal revision the story editor uses, so it keeps the rest of the text;
 *  - afterwards the story is checked for the names, and the answer says honestly if it still lacks one.
 */
import {
  applyStoryRevisionToCurrent,
  storyTextHash,
  type StoryRevisionDecision,
} from "../core/story/revision";
import { addPeopleInstruction, missingFromStory, stampDraftCurrent, type MentionedPerson } from "../core/guide/people";
import { resolvePerson } from "../core/guide/agent/resolve";
import {
  finishStoryRevision,
  saveStoryRevisionDecisions,
  startStoryRevision,
  subscribeStoryRevisions,
  type StoryRevisionWithId,
} from "../platform/storyRevisions";
import { useProjectsStore } from "./projectsStore";

export type AutoRevisionResult =
  | { status: "applied"; stillMissing: string[] }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string };

const WAIT_MS = 150_000;

function waitFor(projectId: string, revisionId: string): Promise<StoryRevisionWithId | null> {
  return new Promise((resolve) => {
    let done = false;
    let unsubscribe: (() => void) | undefined;
    const finish = (value: StoryRevisionWithId | null): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsubscribe?.();
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), WAIT_MS);
    try {
      unsubscribe = subscribeStoryRevisions(projectId, (revisions) => {
        const job = revisions.find((item) => item.id === revisionId);
        if (job && (job.status === "ready" || job.status === "error" || job.status === "discarded")) finish(job);
      });
    } catch {
      finish(null);
    }
  });
}

/**
 * `wasCurrent` is whether the story was up to date before the people were added, which decides whether it
 * is up to date now that it speaks of them.
 */
export async function reviseStoryForPeople(
  projectId: string,
  wasCurrent: boolean,
  added: readonly MentionedPerson[],
  names: readonly string[],
): Promise<AutoRevisionResult> {
  const current = useProjectsStore.getState().current();
  if (!current || current.id !== projectId) return { status: "skipped", reason: "the book changed" };
  const baseStory = current.config.storyText;
  if (!baseStory.trim()) return { status: "skipped", reason: "no story yet" };

  let revisionId: string;
  try {
    revisionId = await startStoryRevision(current, addPeopleInstruction(added, names), undefined, { quiet: true });
  } catch (error) {
    return { status: "failed", reason: error instanceof Error ? error.message : "the story could not be revised" };
  }
  const job = await waitFor(current.id, revisionId);
  if (!job || job.status !== "ready" || !job.proposal) {
    return { status: "failed", reason: job?.error || "the story edit did not finish" };
  }

  const live = useProjectsStore.getState().current();
  if (!live || live.id !== current.id) return { status: "skipped", reason: "the book changed" };
  // Undo or an edit in between: the story this was written for is not the story on screen, or the people left.
  const stillThere = names.every((name) => resolvePerson(live, name).kind !== "none");
  if (live.config.storyText !== baseStory || !stillThere) {
    await finishStoryRevision(revisionId, "discarded").catch(() => undefined);
    return { status: "skipped", reason: "the story or the people changed meanwhile" };
  }

  const decisions: Record<string, StoryRevisionDecision> = {};
  for (const change of job.proposal.changes) decisions[change.id] = "accepted";
  const next = applyStoryRevisionToCurrent(job.baseStory, live.config.storyText, job.proposal, decisions);
  try {
    await saveStoryRevisionDecisions(revisionId, decisions);
  } catch {
    // The decisions are bookkeeping for the review screen; the story itself is what matters here.
  }
  if (next === live.config.storyText) {
    await finishStoryRevision(revisionId, "applied", storyTextHash(next)).catch(() => undefined);
    return { status: "applied", stillMissing: missingFromStory(live, names) };
  }
  await useProjectsStore.getState().patchCurrent((book) => {
    const written = { ...book, config: { ...book.config, storyText: next } };
    return wasCurrent ? stampDraftCurrent(written) : written;
  });
  await finishStoryRevision(revisionId, "applied", storyTextHash(next)).catch(() => undefined);
  const written = useProjectsStore.getState().current();
  return { status: "applied", stillMissing: written ? missingFromStory(written, names) : [...names] };
}
