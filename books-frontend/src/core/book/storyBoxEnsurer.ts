/**
 * The way core asks the editor to show a page's words.
 *
 * A page with words but no text box needs one added from the book's layout, and
 * that is page design, which lives in the editor and pulls in fonts and
 * presets the server cannot load. So core calls through this seam and the
 * editor plugs the real work in (`ui/design/designInit` registers it as soon as
 * it loads, which the project store does for every signed-in session). Where
 * nothing is plugged in (the server, which never writes pages), the project
 * comes back unchanged.
 */
import type { Project } from "../types";

export type StoryBoxEnsurer = (project: Project, pageId: string) => Project;

let ensurer: StoryBoxEnsurer | null = null;

export function registerStoryBoxEnsurer(fn: StoryBoxEnsurer | null): void {
  ensurer = fn;
}

/** Give the page a text box for its words if it has words and no box; otherwise return the same project. */
export function ensureStoryBoxFor(project: Project, pageId: string): Project {
  return ensurer ? ensurer(project, pageId) : project;
}
