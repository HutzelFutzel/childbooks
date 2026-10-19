/**
 * Server-side reads of a user's saved project.
 *
 * Projects are one JSON KV doc each: `users/{uid}/store/project%3A{id}`, written
 * by the client's sync. What's stored can trail the editor by a sync interval,
 * so callers use it for facts that only move forward (which slots have art) or
 * that are checked against a fingerprint, never as the editor's live state.
 */
import { getFirestore } from "firebase-admin/firestore";
import { ensureAdmin } from "./storage";
import type { Project } from "../../books-frontend/src/core/types";

export function storedProjectRef(uid: string, projectId: string) {
  return getFirestore().doc(`users/${uid}/store/${encodeURIComponent(`project:${projectId}`)}`);
}

/** The saved project, or null when it doesn't exist or can't be parsed. */
export async function readStoredProject(uid: string, projectId: string): Promise<Project | null> {
  ensureAdmin();
  const snap = await storedProjectRef(uid, projectId).get();
  const raw = (snap.data() as { json?: string } | undefined)?.json;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Project;
  } catch {
    return null;
  }
}
