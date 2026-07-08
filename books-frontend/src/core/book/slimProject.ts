/**
 * Payload slimming for backend render/generation requests.
 *
 * The backend render pipeline (and the interactive `/ai/*` endpoints) only ever
 * read the ACTIVE version of each artifact — plus an explicit branch point
 * (`fromNodeId`) when one is given — and never the sibling history, the Final
 * Design overlay, the analysis or the share state. Sending the whole project
 * (with 40-deep version trees per page, the design layer, etc.) needlessly
 * bloats every request and, for job documents persisted in Firestore, pushes
 * toward the 1 MB per-document limit.
 *
 * These helpers produce a minimal, correctness-preserving snapshot: version
 * trees are reduced to their cursor lineage (+ requested branch points), the
 * design/analysis/share layers are dropped, and only the illustration trees the
 * request actually targets are kept. The client keeps its full in-memory project
 * and folds returned renders into the complete trees (single writer), so nothing
 * is lost by slimming the wire payload.
 */
import type { Project } from "../types";
import { keepLineages } from "../versioning";

/** A render target: an anchor id or spread id, with an optional branch node. */
export interface RenderTarget {
  id: string;
  nodeId?: string;
}

export interface SlimOptions {
  /** Keep the screenplay (cursor lineage). Needed by illustration rendering. */
  keepScreenplay?: boolean;
  /**
   * Keep anchor image version trees (reduced to cursor lineage). Required for
   * image rendering (anchors are fed in as references). When false, anchors keep
   * their text fields but drop all image versions (text-only endpoints).
   */
  keepAnchorVersions?: boolean;
  /** Extra branch nodes to retain per anchor (implies keepAnchorVersions). */
  anchorTargets?: RenderTarget[];
  /**
   * Illustration trees to retain, by spread id (+ optional branch node). Only
   * these are kept (each reduced to cursor + branch lineage); all others are
   * dropped. Omit to drop every illustration tree.
   */
  illustrationTargets?: RenderTarget[];
}

/**
 * Return a minimal snapshot of `project` for a backend request. See file header.
 * Always preserves the fields the backend reads: id (quotas), config, and the
 * requested artifacts; always drops design/analysis/share.
 */
export function slimProjectForRender(project: Project, opts: SlimOptions): Project {
  const keepAnchorVersions = opts.keepAnchorVersions || (opts.anchorTargets?.length ?? 0) > 0;
  const anchorNodeById = new Map<string, string[]>();
  for (const t of opts.anchorTargets ?? []) {
    if (t.nodeId) anchorNodeById.set(t.id, [...(anchorNodeById.get(t.id) ?? []), t.nodeId]);
  }

  const anchors = project.anchors?.map((a) => {
    if (!a.versions) return a;
    if (!keepAnchorVersions) {
      const { versions: _drop, ...rest } = a;
      void _drop;
      return rest;
    }
    return { ...a, versions: keepLineages(a.versions, anchorNodeById.get(a.id) ?? []) };
  });

  let illustrations: Project["illustrations"];
  if (opts.illustrationTargets?.length) {
    illustrations = {};
    for (const t of opts.illustrationTargets) {
      const tree = project.illustrations?.[t.id];
      if (tree) illustrations[t.id] = keepLineages(tree, t.nodeId ? [t.nodeId] : []);
    }
  }

  const screenplay =
    opts.keepScreenplay && project.screenplay
      ? keepLineages(project.screenplay, [])
      : undefined;

  return {
    id: project.id,
    title: project.title,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    stage: project.stage,
    furthestStage: project.furthestStage,
    config: project.config,
    ...(anchors ? { anchors } : {}),
    ...(screenplay ? { screenplay } : {}),
    ...(illustrations ? { illustrations } : {}),
  };
}
