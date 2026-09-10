/**
 * Decide a book look from uploaded character drawings, and optionally stash
 * the result so Style can open on a conflict picker without extracting twice.
 */
import type { ArtStyleSelection, Project } from "../../core/types";
import {
  collectSourceArtGroups,
  derivedStyleSelection,
} from "../../core/book/sourceArt";
import type { ExtractArtStyleResult } from "../../core/pipeline/styleExtract";
import { extractArtStyleRemote } from "../../platform/aiClient";

export interface ArtworkLookOption {
  id: string;
  name: string;
  stylePrompt: string;
  thumbBlobId?: string;
}

export type ArtworkLookDecision =
  | { status: "resolved"; style: ArtStyleSelection }
  | { status: "conflict"; options: ArtworkLookOption[] }
  | { status: "failed"; message: string };

const FAILED_MESSAGE = "We couldn’t read a look from the uploaded artwork.";

let pending: { projectId: string; decision: ArtworkLookDecision } | null = null;

export function stashArtworkLook(projectId: string, decision: ArtworkLookDecision): void {
  pending = { projectId, decision };
}

export function peekArtworkLook(projectId: string): ArtworkLookDecision | null {
  return pending?.projectId === projectId ? pending.decision : null;
}

export function clearArtworkLook(projectId: string): void {
  if (pending?.projectId === projectId) pending = null;
}

export function decideFromExtract(
  project: Project,
  result: ExtractArtStyleResult,
): ArtworkLookDecision {
  const groups = collectSourceArtGroups(project);
  const extractedNames = result.characters.map((character) => character.name).filter(Boolean);
  const fallbackNames = extractedNames.length > 0 ? extractedNames : groups.map((group) => group.name);

  if (result.compatible && result.stylePrompt.trim()) {
    return {
      status: "resolved",
      style: derivedStyleSelection({
        stylePrompt: result.stylePrompt,
        derivedFromNames: fallbackNames,
      }),
    };
  }

  const thumbs = new Map(groups.map((group) => [group.id, group.images[0]?.blobId] as const));
  const options = result.characters.map((character) => ({
    ...character,
    thumbBlobId: thumbs.get(character.id),
  }));
  if (options.length < 2) {
    const prompt = options[0]?.stylePrompt || result.stylePrompt;
    if (!prompt.trim()) return { status: "failed", message: FAILED_MESSAGE };
    return {
      status: "resolved",
      style: derivedStyleSelection({
        stylePrompt: prompt,
        derivedFromNames: fallbackNames,
      }),
    };
  }
  return { status: "conflict", options };
}

export async function decideArtworkLook(
  project: Project,
  signal?: AbortSignal,
): Promise<ArtworkLookDecision> {
  try {
    const result = await extractArtStyleRemote(project, signal);
    return decideFromExtract(project, result);
  } catch (err) {
    if (signal?.aborted) {
      return { status: "failed", message: FAILED_MESSAGE };
    }
    return {
      status: "failed",
      message: err instanceof Error ? err.message : FAILED_MESSAGE,
    };
  }
}
