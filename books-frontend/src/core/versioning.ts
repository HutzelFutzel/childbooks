/**
 * Generic version tree for AI artifacts (anchors, screenplays, etc.).
 *
 * Every generation or edit creates a new node whose parent is the node it was
 * derived from. This makes iterate / revert / branch-from-any-node trivial:
 *   - iterate: add a child of the current node, move the cursor to it
 *   - revert:  move the cursor back to an ancestor (history preserved)
 *   - branch:  add a child to any node, even one that already has children
 *
 * Pure data + pure functions so it is easy to persist and test.
 */

export interface VersionNode<T> {
  id: string;
  parentId: string | null;
  /** The artifact payload at this version. */
  content: T;
  /** The prompt / instruction that produced this version (if any). */
  prompt?: string;
  /** Free-form label, e.g. "make the dragon smile". */
  label?: string;
  createdAt: number;
}

export interface VersionTree<T> {
  nodes: Record<string, VersionNode<T>>;
  rootId: string;
  /** The currently selected / active node. */
  cursorId: string;
}

function genId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createVersionTree<T>(
  initial: T,
  meta?: { prompt?: string; label?: string },
): VersionTree<T> {
  const id = genId();
  const node: VersionNode<T> = {
    id,
    parentId: null,
    content: initial,
    prompt: meta?.prompt,
    label: meta?.label,
    createdAt: Date.now(),
  };
  return { nodes: { [id]: node }, rootId: id, cursorId: id };
}

export function getNode<T>(tree: VersionTree<T>, id: string): VersionNode<T> | undefined {
  return tree.nodes[id];
}

export function getCursor<T>(tree: VersionTree<T>): VersionNode<T> {
  return tree.nodes[tree.cursorId];
}

/** Add a child of `parentId` and make it the active node. Returns a new tree. */
export function addVersion<T>(
  tree: VersionTree<T>,
  content: T,
  options?: { parentId?: string; prompt?: string; label?: string },
): VersionTree<T> {
  const parentId = options?.parentId ?? tree.cursorId;
  const id = genId();
  const node: VersionNode<T> = {
    id,
    parentId,
    content,
    prompt: options?.prompt,
    label: options?.label,
    createdAt: Date.now(),
  };
  return {
    ...tree,
    nodes: { ...tree.nodes, [id]: node },
    cursorId: id,
  };
}

/** Move the active cursor to an existing node (revert / branch selection). */
export function selectVersion<T>(tree: VersionTree<T>, id: string): VersionTree<T> {
  if (!tree.nodes[id]) return tree;
  return { ...tree, cursorId: id };
}

/**
 * Replace the content of an existing node in place (no new version).
 * Useful for manual edits to the active version. Returns a new tree.
 */
export function updateNodeContent<T>(
  tree: VersionTree<T>,
  id: string,
  content: T,
): VersionTree<T> {
  const node = tree.nodes[id];
  if (!node) return tree;
  return {
    ...tree,
    nodes: { ...tree.nodes, [id]: { ...node, content } },
  };
}

/** Path from root to the given node (inclusive), oldest first. */
export function pathToNode<T>(tree: VersionTree<T>, id: string): VersionNode<T>[] {
  const path: VersionNode<T>[] = [];
  let current: VersionNode<T> | undefined = tree.nodes[id];
  while (current) {
    path.unshift(current);
    current = current.parentId ? tree.nodes[current.parentId] : undefined;
  }
  return path;
}

export function childrenOf<T>(tree: VersionTree<T>, id: string): VersionNode<T>[] {
  return Object.values(tree.nodes)
    .filter((n) => n.parentId === id)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function allVersions<T>(tree: VersionTree<T>): VersionNode<T>[] {
  return Object.values(tree.nodes).sort((a, b) => a.createdAt - b.createdAt);
}
