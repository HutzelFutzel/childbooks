/**
 * Decide a book-wide visual style from character drawings.
 *
 * This is presentation-neutral: Chat and Steps share the same extraction and
 * decision rules while rendering their own conflict/failure UI.
 */
import type { ArtStyleSelection, Project, SourceArtRef } from "../types";
import {
  collectSourceArtGroups,
  derivedStyleSelection,
} from "../book/sourceArt";
import type { ExtractArtStyleResult } from "../pipeline/styleExtract";
import { extractArtStyleRemote } from "../../platform/aiClient";

export interface ArtworkLookOption {
  id: string;
  name: string;
  stylePrompt: string;
  thumbBlobId?: string;
  referenceArt?: SourceArtRef[];
}

export type ArtworkLookDecision =
  | { status: "resolved"; style: ArtStyleSelection }
  | { status: "conflict"; options: ArtworkLookOption[] }
  | { status: "failed"; message: string };

const FAILED_MESSAGE = "We couldn’t read a look from the uploaded artwork.";

export function decideFromExtract(
  project: Project,
  result: ExtractArtStyleResult,
): ArtworkLookDecision {
  const groups = collectSourceArtGroups(project);
  const extractedNames = result.characters
    .map((character) => character.name)
    .filter(Boolean);
  const fallbackNames =
    extractedNames.length > 0
      ? extractedNames
      : groups.map((group) => group.name);
  const stagedStyleArt = project.authoringState?.styleSourceArt ?? [];
  const referenceArt = (
    stagedStyleArt.length > 0 ? stagedStyleArt : groups[0]?.images ?? []
  ).slice(0, 1);

  if (result.compatible && result.stylePrompt.trim()) {
    return {
      status: "resolved",
      style: derivedStyleSelection({
        stylePrompt: result.stylePrompt,
        derivedFromNames: fallbackNames,
        referenceArt,
      }),
    };
  }

  const thumbs = new Map(
    groups.map((group) => [group.id, group.images[0]?.blobId] as const),
  );
  const refs = new Map(groups.map((group) => [group.id, group.images] as const));
  const options = result.characters.map((character) => ({
    ...character,
    thumbBlobId: thumbs.get(character.id),
    referenceArt: refs.get(character.id)?.slice(0, 1),
  }));
  if (options.length < 2) {
    const prompt = options[0]?.stylePrompt || result.stylePrompt;
    if (!prompt.trim()) return { status: "failed", message: FAILED_MESSAGE };
    return {
      status: "resolved",
      style: derivedStyleSelection({
        stylePrompt: prompt,
        derivedFromNames: fallbackNames,
        referenceArt,
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
    return {
      status: "failed",
      message:
        !signal?.aborted && err instanceof Error ? err.message : FAILED_MESSAGE,
    };
  }
}
