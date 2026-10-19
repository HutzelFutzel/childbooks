/**
 * Decide a book-wide visual style from character drawings.
 */
import type { ArtStyleSelection, Project, SourceArtRef } from "../types";
import {
  collectSourceArtGroups,
  derivedStyleSelection,
  firstStyleArtwork,
} from "../book/sourceArt";
import type { CustomStyleRef } from "../config/customArtStyles";
import type { ExtractArtStyleResult } from "../pipeline/styleExtract";

export interface ArtworkLookOption {
  id: string;
  name: string;
  stylePrompt: string;
  thumbBlobId?: string;
  referenceArt?: SourceArtRef[];
  /** The saved custom style the backend made for this character's drawings. */
  customStyle?: CustomStyleRef;
}

export type ArtworkLookDecision =
  | { status: "resolved"; style: ArtStyleSelection }
  | { status: "conflict"; options: ArtworkLookOption[] }
  | { status: "failed"; message: string };

export const ARTWORK_LOOK_FAILED_MESSAGE = "We couldn’t read a look from the uploaded artwork.";

export function decideFromExtract(
  project: Project,
  result: ExtractArtStyleResult,
): ArtworkLookDecision {
  const groups = collectSourceArtGroups(project);
  const extractedNames = result.characters
    .map((character) => character.name)
    .filter(Boolean);
  const first = firstStyleArtwork(project, groups);
  const fallbackNames = first?.name
    ? [first.name]
    : extractedNames.length > 0
      ? [extractedNames[0]!]
      : groups[0]
        ? [groups[0].name]
        : [];
  const referenceArt = first ? [first.ref] : [];

  if (result.compatible && result.stylePrompt.trim()) {
    return {
      status: "resolved",
      style: derivedStyleSelection({
        stylePrompt: result.stylePrompt,
        derivedFromNames: fallbackNames,
        referenceArt,
        customStyle: result.customStyle,
      }),
    };
  }

  const thumbs = new Map(
    groups.map((group) => [group.id, group.images[0]?.blobId] as const),
  );
  const refs = new Map(
    groups.map((group) => [
      group.id,
      group.images.slice().sort((a, b) => a.createdAt - b.createdAt),
    ] as const),
  );
  const options = result.characters.map((character) => ({
    ...character,
    thumbBlobId: thumbs.get(character.id),
    referenceArt: refs.get(character.id)?.slice(0, 1),
  }));
  if (options.length < 2) {
    const prompt = options[0]?.stylePrompt || result.stylePrompt;
    if (!prompt.trim()) return { status: "failed", message: ARTWORK_LOOK_FAILED_MESSAGE };
    return {
      status: "resolved",
      style: derivedStyleSelection({
        stylePrompt: prompt,
        derivedFromNames: fallbackNames,
        referenceArt,
        customStyle: options[0]?.customStyle ?? result.customStyle,
      }),
    };
  }
  return { status: "conflict", options };
}
