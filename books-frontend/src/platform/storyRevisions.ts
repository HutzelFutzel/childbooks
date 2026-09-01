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

export async function startStoryRevision(
  project: Project,
  instruction: string,
  selection?: StoryRevisionSelection,
): Promise<string> {
  const res = await backendFetch("/ai/story-revisions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ project, instruction, selection }),
  });
  if (!res.ok) {
    let body: {
      error?: { message?: string; code?: string; balance?: number; needed?: number };
    } = {};
    try {
      body = await res.json();
    } catch {
      // Fall through to the generic request error.
    }
    if (res.status === 402 && body.error?.code === "insufficient_sparks") {
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
