import {
  collection,
  onSnapshot,
  query,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { getFirebaseAuth, getFirebaseDb } from "../lib/firebase";
import type { Project } from "../core/types";
import type {
  StoryRevisionDecision,
  StoryRevisionJob,
  StoryRevisionSelection,
} from "../core/story/revision";
import { backendFetch } from "./backend";
import { useAuthStore } from "../state/authStore";
import { useSparksUiStore } from "../state/sparksUiStore";
import { slimProjectForRender } from "../core/book/slimProject";

export type StoryRevisionWithId = StoryRevisionJob & { id: string };

function uid(): string {
  const id = getFirebaseAuth().currentUser?.uid;
  if (!id) throw new Error("Sign in to refine this story.");
  return id;
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

export function subscribeStoryRevisions(
  projectId: string,
  cb: (revisions: StoryRevisionWithId[]) => void,
): Unsubscribe {
  const q = query(
    collection(getFirebaseDb(), `users/${uid()}/storyRevisions`),
    where("projectId", "==", projectId),
  );
  return onSnapshot(
    q,
    (snap) =>
      cb(
        snap.docs
          .map((doc) => ({ id: doc.id, ...(doc.data() as StoryRevisionJob) }))
          .sort((a, b) => b.updatedAt - a.updatedAt),
      ),
    (err) => console.error("[story-revisions] listener failed", err),
  );
}

const inflight = new Map<string, Promise<string>>();
/** A revision this tab just queued, so a second call for the same edit joins it instead of failing. */
const recent = new Map<string, { key: string; id: string; at: number }>();
let eagerArmed = false;
let eagerPromise: Promise<string> | null = null;

function revisionKey(projectId: string, instruction: string, selection?: StoryRevisionSelection): string {
  return `${projectId}\0${instruction.trim()}\0${selection?.start ?? ""}\0${selection?.end ?? ""}`;
}

function adoptEager(): void {
  eagerArmed = false;
}

/**
 * Queue a story edit before the interpreter has answered. Cancelled if that
 * answer says the message was not an edit.
 */
export function beginEagerStoryRevision(
  project: Project,
  instruction: string,
  selection?: StoryRevisionSelection,
): Promise<string> {
  eagerArmed = true;
  eagerPromise = startStoryRevision(project, instruction, selection, { eager: true }).catch((err) => {
    eagerArmed = false;
    throw err;
  });
  return eagerPromise;
}

export async function cancelEagerStoryRevision(): Promise<void> {
  if (!eagerArmed) return;
  eagerArmed = false;
  const id = await eagerPromise?.catch(() => "");
  eagerPromise = null;
  if (!id) return;
  await finishStoryRevision(id, "discarded").catch(() => {});
}

export async function startStoryRevision(
  project: Project,
  instruction: string,
  selection?: StoryRevisionSelection,
  options: { eager?: boolean; quiet?: boolean } = {},
): Promise<string> {
  const key = revisionKey(project.id, instruction, selection);
  const existing = inflight.get(key);
  if (existing) {
    if (!options.eager) adoptEager();
    return existing;
  }
  const run = requestStoryRevision(project, instruction, selection, key, options.quiet === true).then((id) => {
    if (!options.eager) adoptEager();
    return id;
  });
  inflight.set(key, run);
  void run.finally(() => {
    if (inflight.get(key) === run) inflight.delete(key);
  });
  return run;
}

async function requestStoryRevision(
  project: Project,
  instruction: string,
  selection: StoryRevisionSelection | undefined,
  key: string,
  quiet = false,
): Promise<string> {
  const joined = recent.get(project.id);
  if (joined && joined.key === key && Date.now() - joined.at < 60_000) return joined.id;
  const res = await backendFetch("/ai/story-revisions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      project: slimProjectForRender(project, {}),
      instruction,
      selection,
    }),
  });
  if (!res.ok) {
    let body: {
      error?: { message?: string; code?: string; balance?: number; needed?: number };
      revisionId?: string;
    } = {};
    try {
      body = await res.json();
    } catch {
      // Fall through to the generic request error.
    }
    // The interpreter's wording of an edit we already queued. Joining it keeps
    // that run; a later, different edit still has to wait for the review.
    if (res.status === 409 && body.revisionId && eagerArmed) {
      const same = recent.get(project.id);
      if (same && Date.now() - same.at < 60_000) return same.id;
    }
    // A step the guide takes on its own never opens a dialog over the chat: the caller says what happened.
    if (!quiet && res.status === 402 && body.error?.code === "insufficient_sparks") {
      const balance = body.error.balance ?? 0;
      const needed = body.error.needed ?? 0;
      if (useAuthStore.getState().accessLevel === "full") {
        useSparksUiStore.getState().openWallet(Math.max(0, needed - balance));
      } else {
        useAuthStore.getState().openAuthDialog();
      }
    }
    throw new Error(body.error?.message ?? "The story could not be revised.");
  }
  const body = (await res.json()) as { revisionId: string };
  recent.set(project.id, { key, id: body.revisionId, at: Date.now() });
  return body.revisionId;
}

export async function saveStoryRevisionDecisions(
  revisionId: string,
  decisions: Record<string, StoryRevisionDecision>,
  decisionContexts?: Record<string, string>,
): Promise<void> {
  const res = await backendFetch(`/ai/story-revisions/${encodeURIComponent(revisionId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decisions, decisionContexts }),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "The review could not be saved."));
}

export async function finishStoryRevision(
  revisionId: string,
  status: "applied" | "discarded",
  resultHash?: string,
): Promise<void> {
  const res = await backendFetch(`/ai/story-revisions/${encodeURIComponent(revisionId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status, resultHash }),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "The revision could not be finished."));
}
