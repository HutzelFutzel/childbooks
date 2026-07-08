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
  /**
   * Monotonic per-tree sequence number, assigned at creation. Unlike
   * `createdAt` (a wall clock that can collide or regress across devices), `seq`
   * strictly increases, so it is the authoritative ordering key. Optional for
   * back-compat with trees persisted before it existed (fall back to createdAt).
   */
  seq?: number;
}

export interface VersionTree<T> {
  nodes: Record<string, VersionNode<T>>;
  rootId: string;
  /** The currently selected / active node. */
  cursorId: string;
  /**
   * The next monotonic sequence number to assign. Optional for back-compat;
   * {@link nextSeqOf} derives a safe value when it is missing.
   */
  nextSeq?: number;
}

/** Next sequence number for a tree, tolerant of legacy trees without `nextSeq`. */
function nextSeqOf<T>(tree: VersionTree<T>): number {
  if (typeof tree.nextSeq === "number") return tree.nextSeq;
  // Legacy tree: derive from the highest seq (or node count) so new nodes still
  // sort after every existing one.
  const maxSeq = Object.values(tree.nodes).reduce(
    (m, n) => Math.max(m, n.seq ?? 0),
    0,
  );
  return Math.max(maxSeq + 1, Object.keys(tree.nodes).length);
}

/** Authoritative ordering key for a node: its `seq`, or `createdAt` for legacy. */
export function nodeOrder<T>(n: VersionNode<T>): number {
  return n.seq ?? n.createdAt;
}

/** Stable comparator (oldest first) by seq/createdAt, tiebroken by id. */
function byOrder<T>(a: VersionNode<T>, b: VersionNode<T>): number {
  const d = nodeOrder(a) - nodeOrder(b);
  return d !== 0 ? d : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Default cap on retained versions per artifact (anchor / illustration). Chosen
 * generously so real editing sessions effectively never lose history, while
 * still bounding the persisted document so it can't grow without limit and blow
 * Firestore's 1 MB per-document ceiling. The root→cursor lineage is always kept
 * regardless of this cap (see {@link pruneVersionTree}).
 */
export const DEFAULT_MAX_VERSIONS = 40;

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
    seq: 0,
  };
  return { nodes: { [id]: node }, rootId: id, cursorId: id, nextSeq: 1 };
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
  const seq = nextSeqOf(tree);
  const node: VersionNode<T> = {
    id,
    parentId,
    content,
    prompt: options?.prompt,
    label: options?.label,
    createdAt: Date.now(),
    seq,
  };
  return {
    ...tree,
    nodes: { ...tree.nodes, [id]: node },
    cursorId: id,
    nextSeq: seq + 1,
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

/**
 * Reduce a tree to only the node lineages needed by a consumer: the root→cursor
 * path plus the root→id path for each requested extra id (e.g. a `fromNodeId` a
 * render will branch from). Sibling branches are dropped. Because every lineage
 * shares the root, the result is always a valid, connected tree. Used to strip
 * version HISTORY out of payloads sent to the backend (which only ever reads the
 * active version and any explicit branch point). Pure.
 */
export function keepLineages<T>(
  tree: VersionTree<T>,
  extraIds: string[] = [],
): VersionTree<T> {
  const keep = new Set<string>();
  const addPath = (id: string) => {
    for (const n of pathToNode(tree, id)) keep.add(n.id);
  };
  addPath(tree.cursorId);
  for (const id of extraIds) if (tree.nodes[id]) addPath(id);
  if (keep.size >= Object.keys(tree.nodes).length) return tree;
  const nodes: Record<string, VersionNode<T>> = {};
  for (const id of keep) nodes[id] = tree.nodes[id];
  return { ...tree, nodes };
}

export function childrenOf<T>(tree: VersionTree<T>, id: string): VersionNode<T>[] {
  return Object.values(tree.nodes)
    .filter((n) => n.parentId === id)
    .sort(byOrder);
}

export function allVersions<T>(tree: VersionTree<T>): VersionNode<T>[] {
  return Object.values(tree.nodes).sort(byOrder);
}

/** Ids on the path from root to the cursor (the versions that must never be dropped). */
function protectedIds<T>(tree: VersionTree<T>): Set<string> {
  return new Set(pathToNode(tree, tree.cursorId).map((n) => n.id));
}

/**
 * Re-link a set of kept nodes into a valid tree after some nodes were removed:
 * every kept node whose parent is gone is re-pointed at its nearest surviving
 * ancestor (or becomes a root, parent = null). Pure; returns the new node map.
 */
function relink<T>(
  original: Record<string, VersionNode<T>>,
  keep: Set<string>,
): Record<string, VersionNode<T>> {
  const nearestKeptAncestor = (startParentId: string | null): string | null => {
    let p = startParentId;
    const guard = new Set<string>();
    while (p && !guard.has(p)) {
      guard.add(p);
      if (keep.has(p)) return p;
      p = original[p]?.parentId ?? null;
    }
    return null;
  };
  const nodes: Record<string, VersionNode<T>> = {};
  for (const id of keep) {
    const node = original[id];
    if (!node) continue;
    const parentId = node.parentId && keep.has(node.parentId)
      ? node.parentId
      : nearestKeptAncestor(node.parentId);
    nodes[id] = { ...node, parentId };
  }
  return nodes;
}

/**
 * The blob-bearing payloads of the versions that would be removed by pruning to
 * `maxVersions`, WITHOUT mutating the tree — so a caller can decide whether to
 * garbage-collect their blobs. Returns [] when nothing would be pruned.
 */
export function versionsPrunedBy<T>(
  tree: VersionTree<T>,
  maxVersions: number,
): VersionNode<T>[] {
  const all = allVersions(tree);
  if (all.length <= maxVersions) return [];
  const keep = keepSet(tree, all, maxVersions);
  return all.filter((n) => !keep.has(n.id));
}

/** The set of node ids to retain when pruning to `maxVersions`. */
function keepSet<T>(
  tree: VersionTree<T>,
  all: VersionNode<T>[],
  maxVersions: number,
): Set<string> {
  const keep = protectedIds(tree); // root→cursor path is always retained
  // Then keep the most-recent nodes (by seq) up to the cap.
  const recent = [...all].sort((a, b) => nodeOrder(b) - nodeOrder(a));
  for (const n of recent) {
    if (keep.size >= maxVersions) break;
    keep.add(n.id);
  }
  return keep;
}

/**
 * Bound a tree's history to at most `maxVersions` nodes. The root→cursor path is
 * always kept (so the active version and its lineage survive); beyond that the
 * most recent versions are retained and older ones dropped. The result is always
 * a valid, connected tree (orphaned children are re-linked to their nearest
 * surviving ancestor). Pure.
 */
export function pruneVersionTree<T>(
  tree: VersionTree<T>,
  maxVersions: number,
): VersionTree<T> {
  const all = allVersions(tree);
  if (maxVersions <= 0 || all.length <= maxVersions) return tree;
  const keep = keepSet(tree, all, maxVersions);
  const nodes = relink(tree.nodes, keep);
  // The root may have been dropped; recompute it as the (single) parentless node
  // on the cursor's lineage.
  const rootId = keep.has(tree.rootId)
    ? tree.rootId
    : (pathToNode({ ...tree, nodes }, tree.cursorId)[0]?.id ?? tree.cursorId);
  return { ...tree, nodes, rootId };
}

/**
 * Delete a single version node, keeping the tree valid. Children of the removed
 * node are re-parented to its parent (or promoted toward the root). The cursor,
 * if it pointed at the removed node, moves to the parent (or nearest survivor).
 * Deleting the last remaining node is refused (returns the tree unchanged) —
 * callers that want to drop everything should remove the whole tree instead.
 * Pure; returns the new tree.
 */
export function deleteVersion<T>(tree: VersionTree<T>, id: string): VersionTree<T> {
  if (!tree.nodes[id]) return tree;
  if (Object.keys(tree.nodes).length <= 1) return tree; // never orphan the tree
  const removed = tree.nodes[id];
  const keep = new Set(Object.keys(tree.nodes).filter((n) => n !== id));

  // Choose the new root: the old root if it survives, else the removed root's
  // earliest surviving child (promoted), else any survivor.
  let rootId = tree.rootId;
  if (id === tree.rootId) {
    const firstChild = childrenOf(tree, id)[0];
    rootId = firstChild?.id ?? [...keep][0];
  }

  const nodes = relink(tree.nodes, keep);
  // A valid tree has exactly one root. Removing the root can leave several
  // parentless survivors (the old root's other children) — re-attach them under
  // the promoted root so the structure stays single-rooted.
  for (const nid of Object.keys(nodes)) {
    if (nid !== rootId && nodes[nid].parentId === null) {
      nodes[nid] = { ...nodes[nid], parentId: rootId };
    }
  }

  let cursorId = tree.cursorId;
  if (cursorId === id) {
    cursorId = removed.parentId && keep.has(removed.parentId) ? removed.parentId : rootId;
  }
  return { ...tree, nodes, rootId, cursorId };
}
