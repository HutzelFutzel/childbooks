/**
 * Keep a book's version history from outgrowing the one document it is stored in.
 *
 * The whole book is a single Firestore document, capped at 1 MiB. Two things
 * filled it: every picture version carried its full drawing prompt twice (on the
 * version and inside its content, ~3 KB each, the bulk of a version), and the
 * screenplay, revised in a straight line, was never pruned because the active
 * version's ancestry is protected from pruning.
 *
 * Nothing reads the prompt of a version that is not on screen, so only the
 * current version of each picture keeps it, once. The screenplay keeps its first
 * and most recent versions. Pure, and returns the same object when there is
 * nothing to drop, so it is cheap to run before every save.
 */
import type { Project } from "../types";
import { pruneToRecent, type VersionTree } from "../versioning";

/** Screenplay versions kept: the first, the current one, and the latest others. */
export const MAX_SCREENPLAY_VERSIONS = 12;

function compactArtTree<T extends object>(tree: VersionTree<T>): VersionTree<T> {
  let nodes: VersionTree<T>["nodes"] | null = null;
  for (const [id, node] of Object.entries(tree.nodes)) {
    const content = node.content as T & { prompt?: string };
    const current = id === tree.cursorId;
    const dropNodePrompt = node.prompt !== undefined && (!current || node.prompt === content.prompt);
    const dropContentPrompt = !current && content.prompt !== undefined;
    if (!dropNodePrompt && !dropContentPrompt) continue;
    nodes ??= { ...tree.nodes };
    const { prompt: _nodePrompt, ...rest } = node;
    void _nodePrompt;
    let nextContent: T = node.content;
    if (dropContentPrompt) {
      const { prompt: _contentPrompt, ...contentRest } = content;
      void _contentPrompt;
      nextContent = contentRest as T;
    }
    nodes[id] = { ...(dropNodePrompt ? rest : node), content: nextContent };
  }
  return nodes ? { ...tree, nodes } : tree;
}

export function compactProjectHistory(project: Project): Project {
  let next = project;

  if (project.screenplay) {
    const screenplay = pruneToRecent(project.screenplay, MAX_SCREENPLAY_VERSIONS);
    if (screenplay !== project.screenplay) next = { ...next, screenplay };
  }

  if (project.illustrations) {
    let illustrations: NonNullable<Project["illustrations"]> | null = null;
    for (const [id, tree] of Object.entries(project.illustrations)) {
      const compacted = compactArtTree(tree);
      if (compacted === tree) continue;
      illustrations ??= { ...project.illustrations };
      illustrations[id] = compacted;
    }
    if (illustrations) next = { ...next, illustrations };
  }

  if (project.anchors) {
    let changed = false;
    const anchors = project.anchors.map((anchor) => {
      if (!anchor.versions) return anchor;
      const versions = compactArtTree(anchor.versions);
      if (versions === anchor.versions) return anchor;
      changed = true;
      return { ...anchor, versions };
    });
    if (changed) next = { ...next, anchors };
  }

  return next;
}
