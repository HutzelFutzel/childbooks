/**
 * Best-effort: read uploaded drawings and stamp who is in them onto the
 * matching story person and Cast character.
 */
import { applyArtworkLooks, hasSourceArt } from "../core/book/sourceArt";
import { extractArtLookRemote } from "./aiClient";
import { useProjectsStore } from "../state/projectsStore";

export async function refreshArtworkLooks(): Promise<void> {
  const store = useProjectsStore.getState();
  const project = store.current();
  if (!project || !hasSourceArt(project)) return;
  const result = await extractArtLookRemote(project);
  await store.patchCurrent((current) => applyArtworkLooks(current, result.characters));
}
