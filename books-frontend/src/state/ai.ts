/**
 * Bridges UI/stores to the pure core pipelines: reads credentials from the
 * settings store and the selected models from the current project, runs the
 * analysis / image generation, and persists results via the projects store.
 */
import {
  buildIllustrationPrompt,
  chooseImageSize,
} from "../core/pipeline/illustration";
import {
  applyIllustrationRender,
  type IllustrationRunOptions,
} from "../core/pipeline/illustrationRun";
import {
  applyAnchorRender,
  type AnchorRunOptions,
} from "../core/pipeline/anchorRun";
import {
  anchorSignature,
  currentAnchorImage,
  currentReferenceUses,
} from "../core/pipeline/provenance";
import { effectiveAnchorIds } from "../core/book/anchorRefs";
import { containersOf, linkedAnchorsFor, relatedAnchorsFor } from "../core/book/anchorGraph";
import { spreadsById } from "../core/book/units";
import { reconcileScreenplaySpreadIds } from "../core/book/screenplayReconcile";
import { ProviderError } from "../core/errors";
import type { ResolvedModels } from "../core/models/registry";
import type { ProviderId } from "../core/config/options";
import type { ReferenceImage } from "../core/providers/types";
import type {
  Anchor,
  BakedCoverText,
  IllustrationImage,
  Project,
  ReferenceUse,
  ScreenplaySpread,
} from "../core/types";
import {
  addVersion,
  createVersionTree,
  getCursor,
} from "../core/versioning";
import type { BlobRef, ImageRenderRequest, JobTask } from "../core/jobs/types";
import {
  analyzeStoryRemote,
  anchorDescriptionRemote,
  anchorImageRemote,
  coverWrapRemote,
  illustrationRemote,
  screenplayRemote,
} from "../platform/aiClient";
import { COVER_BACK_ID, COVER_FRONT_ID } from "../core/types";
import { resolveImageModelClient, resolveModelsClient } from "../platform/aiResolve";
import { DEFAULT_IMAGE_TIER, type ImageTier } from "../core/config/modelConfig";
import { requireImageTier } from "./imageTierPrompt";
import { useProjectsStore } from "./projectsStore";
import { useSettingsStore } from "./settingsStore";
import { useAppConfigStore } from "./appConfigStore";

// Re-exported for existing UI imports (moved to the platform-agnostic core).
export { currentAnchorImage } from "../core/pipeline/provenance";
export {
  containedAnchorsFor,
  containersOf,
  relatedAnchorsFor,
  linkedAnchorsFor,
  relationOwner,
  relationNote,
  relationSentence,
  orderAnchorsByDependency,
} from "../core/book/anchorGraph";

/**
 * The provider keys live on the backend, so the client only verifies a provider
 * is configured + available and surfaces a friendly error otherwise.
 */
function requireKey(provider: "openai" | "google"): string {
  const available = useSettingsStore.getState().providerAvailable[provider];
  if (!available) {
    throw new ProviderError(
      "AI generation isn't available right now. It's being set up on the server.",
      { kind: "auth", retryable: false },
    );
  }
  return "";
}

/**
 * The config-resolved models for the configured + available providers. Used to
 * gate the UI and to stamp job payloads; the server re-resolves authoritatively.
 * Throws a friendly auth error when nothing usable is configured.
 */
export function getResolvedModels(tier: ImageTier = DEFAULT_IMAGE_TIER): ResolvedModels {
  const models = resolveModelsClient(tier);
  if (!models) {
    throw new ProviderError(
      "AI generation isn't available right now. It's being set up on the server.",
      { kind: "auth", retryable: false },
    );
  }
  return models;
}

/** Analyze the current project's story (server-side) and store the anchors. */
export async function analyzeCurrentStory(signal?: AbortSignal): Promise<void> {
  const project = useProjectsStore.getState().current();
  if (!project) throw new Error("No active project.");

  const { summary, anchors, model } = await analyzeStoryRemote(project, signal);

  await useProjectsStore.getState().setAnalysis(
    { summary, generatedAt: Date.now(), model },
    anchors,
  );
}

/**
 * Suggest (and store) a visual description for an anchor based on the story
 * (server-side), referencing other anchors so relationships are captured.
 */
export async function suggestAnchorDescription(
  anchorId: string,
  signal?: AbortSignal,
): Promise<string> {
  const project = useProjectsStore.getState().current();
  if (!project) throw new Error("No active project.");
  const anchor = project.anchors?.find((a) => a.id === anchorId);
  if (!anchor) throw new Error("Anchor not found.");
  if (!project.config.storyText.trim()) {
    throw new Error("Add your story text first.");
  }

  const description = await anchorDescriptionRemote(project, anchorId, signal);
  await useProjectsStore.getState().updateAnchor(anchorId, { description });
  return description;
}

export interface GenerateAnchorOptions {
  /** Extra revision instruction, e.g. "make her smile". */
  edit?: string;
  /** Branch from this existing version (defaults to the current cursor). */
  fromNodeId?: string;
  /** Use the source version's image as a reference for consistency. */
  useReference?: boolean;
  /** Quality tier to generate at (defaults to the user's preferred tier). */
  tier?: ImageTier;
  signal?: AbortSignal;
}

/**
 * Generate (or iterate on) an anchor image. The render runs server-side
 * (`/ai/anchor-image`); the returned render is folded into the anchor's version
 * tree here (single writer).
 */
export async function generateAnchorVersion(
  anchorId: string,
  options: GenerateAnchorOptions = {},
): Promise<void> {
  const project = useProjectsStore.getState().current();
  if (!project) throw new Error("No active project.");
  const anchor = project.anchors?.find((a) => a.id === anchorId);
  if (!anchor) throw new Error("Anchor not found.");
  const { tier, ...runOptions } = options;
  const resolvedTier = tier ?? requireImageTier();
  if (!resolvedTier) return;
  const render = await anchorImageRemote(
    project,
    anchorId,
    runOptions as AnchorRunOptions,
    resolvedTier,
  );
  const versions = applyAnchorRender(anchor.versions, render);
  await useProjectsStore.getState().updateAnchor(anchorId, { versions });
}

export interface GenerateScreenplayOptions {
  /** Refinement instruction applied to the current version. */
  edit?: string;
  signal?: AbortSignal;
}

/**
 * Generate or refine the screenplay. First run creates the version tree; a
 * refinement adds a child version (from the current cursor) and selects it.
 */
export async function generateScreenplayVersion(
  options: GenerateScreenplayOptions = {},
): Promise<void> {
  const project = useProjectsStore.getState().current();
  if (!project) throw new Error("No active project.");

  const tree = project.screenplay;
  const prevDoc = tree ? getCursor(tree).content : undefined;
  const previous = options.edit ? prevDoc : undefined;

  const generated = await screenplayRemote(project, options.edit, previous, options.signal);
  // Preserve spread identity across the regeneration so id-keyed illustrations
  // and page designs stay bound to their page (never orphaned by an edit).
  const doc = reconcileScreenplaySpreadIds(generated, prevDoc);

  const label = options.edit?.trim() || (tree ? "Regenerated" : "Initial");
  const versions = tree
    ? addVersion(tree, doc, { prompt: options.edit, label })
    : createVersionTree(doc, { label });

  await useProjectsStore.getState().setScreenplay(versions);
}

export interface GenerateIllustrationOptions {
  edit?: string;
  /** When intent resolution was ambiguous, the user-selected target anchor id. */
  intentTargetAnchorId?: string;
  fromNodeId?: string;
  /** Reuse the source version's image as a reference (keep composition). */
  useReference?: boolean;
  /** Inpainting mask (transparent hole = region to change). Forces composition ref. */
  mask?: ReferenceImage;
  /** Quality tier to generate at (defaults to the user's preferred tier). */
  tier?: ImageTier;
  signal?: AbortSignal;
}

/** Current illustration content for a spread, if any. */
export function currentIllustration(
  project: Project,
  spreadId: string,
): IllustrationImage | null {
  const tree = project.illustrations?.[spreadId];
  return tree ? getCursor(tree).content : null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Best-effort suggestions: other anchors whose exact name appears in this
 * anchor's description/guidance but are NOT yet explicitly linked. Used only to
 * offer one-click linking in the UI — never as an authoritative relation, so it
 * can't silently create the "random" relation/staleness cascades.
 */
export function suggestLinkedAnchors(anchor: Anchor, all: Anchor[]): Anchor[] {
  const haystack = `${anchor.description ?? ""} ${anchor.userGuidance ?? ""}`.toLowerCase();
  if (!haystack.trim()) return [];
  // Exclude anything already connected in EITHER direction (contains either
  // way, or relates either way), so a link created from the other anchor isn't
  // re-suggested here.
  const linked = new Set([
    ...(anchor.containedIds ?? []),
    ...containersOf(anchor, all).map((o) => o.id),
    ...relatedAnchorsFor(anchor, all).map((o) => o.id),
  ]);
  return all.filter((other) => {
    if (other.id === anchor.id || linked.has(other.id)) return false;
    const name = other.name?.trim();
    if (!name || name.length < 3) return false; // skip very short/common names
    return new RegExp(`\\b${escapeRegExp(name.toLowerCase())}\\b`).test(haystack);
  });
}

/**
 * Anchor ids whose generated image used a related anchor that has since changed
 * (different version or edited description), so the user can regenerate them.
 */
export function staleAnchorIds(project: Project): string[] {
  const anchors = project.anchors ?? [];
  const byId = new Map(anchors.map((a) => [a.id, a]));
  const stale: string[] = [];
  for (const a of anchors) {
    if (!a.versions) continue;
    const used = getCursor(a.versions).content.references ?? [];
    let isStale = used.some((u) => {
      const r = byId.get(u.anchorId);
      if (!r) return true;
      // Text-only uses (related anchors) don't care about image versions.
      if (!u.textOnly && (r.versions?.cursorId ?? undefined) !== u.versionId) return true;
      if (u.signature !== undefined && u.signature !== anchorSignature(r)) return true;
      return false;
    });
    // The link SET itself changed since the render (a relation was added or
    // removed) — the sheet no longer reflects the declared relationships.
    // Uses the SAME bidirectional definition the renderer records with
    // (`linkedAnchorsFor`), so an incoming relates edge created from the other
    // anchor doesn't read as a perpetual mismatch here.
    if (!isStale) {
      const currentLinks = new Set(linkedAnchorsFor(a, anchors).map((r) => r.id));
      const recorded = new Set(used.map((u) => u.anchorId).filter((id) => byId.has(id)));
      isStale =
        currentLinks.size !== recorded.size ||
        [...currentLinks].some((id) => !recorded.has(id));
    }
    if (isStale) stale.push(a.id);
  }
  return stale;
}

/** Compare recorded reference uses to current anchors; return the changed ones. */
function changedFromUses(uses: ReferenceUse[], byId: Map<string, Anchor>): Anchor[] {
  const out: Anchor[] = [];
  for (const u of uses) {
    const a = byId.get(u.anchorId);
    if (!a) continue; // deleted anchors can't be named; handled as "removed"
    const versionChanged =
      !u.textOnly && (a.versions?.cursorId ?? undefined) !== u.versionId;
    const textChanged = u.signature !== undefined && u.signature !== anchorSignature(a);
    if (versionChanged || textChanged) out.push(a);
  }
  return out;
}

/** Anchors used by a spread's current illustration whose design has since changed. */
export function changedAnchorsForSpread(project: Project, spreadId: string): Anchor[] {
  const byId = new Map((project.anchors ?? []).map((a) => [a.id, a]));
  const tree = project.illustrations?.[spreadId];
  if (!tree) return [];
  return changedFromUses(getCursor(tree).content.references ?? [], byId);
}

/** Linked anchors used to render this anchor's image whose design has since changed. */
export function changedAnchorsForAnchor(project: Project, anchorId: string): Anchor[] {
  const byId = new Map((project.anchors ?? []).map((a) => [a.id, a]));
  const anchor = byId.get(anchorId);
  if (!anchor?.versions) return [];
  return changedFromUses(getCursor(anchor.versions).content.references ?? [], byId);
}

/** Unique names of changed anchors across the given spreads (for friendly warnings). */
export function changedAnchorNamesForSpreads(
  project: Project,
  spreadIds: string[],
): string[] {
  const names = new Set<string>();
  for (const id of spreadIds) {
    for (const a of changedAnchorsForSpread(project, id)) names.add(a.name);
  }
  return [...names];
}

/**
 * Returns the ids of illustrated spreads whose recorded references no longer
 * match the anchors' current state: the selected image version changed, the
 * descriptive text changed, or the anchor was removed entirely.
 */
export function staleIllustrationSpreadIds(project: Project): string[] {
  const byId = new Map((project.anchors ?? []).map((a) => [a.id, a]));
  const units = spreadsById(project);
  const stale: string[] = [];
  for (const [spreadId, tree] of Object.entries(project.illustrations ?? {})) {
    const content = getCursor(tree).content;
    const used = content.references ?? [];
    let isStale = used.some((u) => {
      const a = byId.get(u.anchorId);
      if (!a) return true; // anchor was deleted
      if (!u.textOnly && (a.versions?.cursorId ?? undefined) !== u.versionId) return true;
      // Only compare signatures for records that carry one (back-compat).
      if (u.signature !== undefined && u.signature !== anchorSignature(a)) return true;
      return false;
    });
    // Anchors were toggled on/off the page since the render: the recorded
    // reference set no longer matches the page's current anchor set.
    if (!isStale) {
      const spread = units.get(spreadId);
      if (spread) {
        const current = new Set(
          effectiveAnchorIds(project.anchors, spread).filter((id) => byId.has(id)),
        );
        const recorded = new Set(used.map((u) => u.anchorId).filter((id) => byId.has(id)));
        isStale =
          current.size !== recorded.size || [...current].some((id) => !recorded.has(id));
      }
    }
    if (isStale) stale.push(spreadId);
  }
  return stale;
}

/** The baked-in cover text vs. the current form text, when they differ. */
export interface CoverTextDrift {
  /** What the current artwork actually shows. */
  baked: BakedCoverText;
  /** What the title/subtitle/author fields say now. */
  current: BakedCoverText;
}

/**
 * Detect when a typographic (baked-text) cover's artwork no longer matches the
 * book's current title/subtitle/author — e.g. the user renamed the book after
 * generating the cover, so the drawn title is now wrong. Returns null when the
 * cover isn't baked, hasn't been generated, or is still in sync.
 */
export function coverTextDrift(project: Project, coverId: string): CoverTextDrift | null {
  const tree = project.illustrations?.[coverId];
  if (!tree) return null;
  const content = getCursor(tree).content;
  if (content.textMode !== "in-image" || !content.bakedText) return null;
  const doc = project.screenplay ? getCursor(project.screenplay).content : null;
  const cover = coverId === COVER_FRONT_ID ? doc?.frontCover : doc?.backCover;
  // The front cover's title is always the project title (single source of truth).
  const current: BakedCoverText = {
    title: coverId === COVER_FRONT_ID ? project.title : cover?.title,
    subtitle: cover?.subtitle,
    author: cover?.author,
  };
  const norm = (s?: string) => (s ?? "").trim();
  const baked = content.bakedText;
  const drifted =
    norm(baked.title) !== norm(current.title) ||
    norm(baked.subtitle) !== norm(current.subtitle) ||
    norm(baked.author) !== norm(current.author);
  return drifted ? { baked, current } : null;
}

/**
 * Generate (or iterate on) the illustration for a screenplay spread. The render
 * runs server-side (`/ai/illustration`); the result is folded into the spread's
 * version tree here (single writer).
 */
export async function generateIllustrationVersion(
  spread: ScreenplaySpread,
  options: GenerateIllustrationOptions = {},
): Promise<void> {
  const project = useProjectsStore.getState().current();
  if (!project) throw new Error("No active project.");
  const { tier, ...runOptions } = options;
  const resolvedTier = tier ?? requireImageTier();
  if (!resolvedTier) return;
  const render = await illustrationRemote(
    project,
    spread.id,
    runOptions as IllustrationRunOptions,
    resolvedTier,
  );
  if (!render) return;
  // Record the exact text baked into a typographic cover, so the studio can
  // warn when the book's title/subtitle/author later drift from the artwork.
  if (spread.bakeText && (spread.coverTitle ?? "").trim()) {
    render.bakedText = {
      title: spread.coverTitle,
      subtitle: spread.coverSubtitle,
      author: spread.coverAuthor,
    };
  }
  const versions = applyIllustrationRender(project.illustrations?.[spread.id], render);
  await useProjectsStore.getState().setIllustration(spread.id, versions);
}

/**
 * Generate both covers as one continuous wrap image (split server-side into a
 * front + back panel) and fold each panel into its cover's version tree. One
 * generation → guaranteed-matching covers. Returns false when the tier prompt
 * was opened (no generation happened yet).
 */
export async function generateCoverWrap(options: { tier?: ImageTier } = {}): Promise<boolean> {
  const project = useProjectsStore.getState().current();
  if (!project) throw new Error("No active project.");
  const resolvedTier = options.tier ?? requireImageTier();
  if (!resolvedTier) return false;
  const { front, back } = await coverWrapRemote(project, resolvedTier);
  // Record the baked title/subtitle/author on the front panel (the wrap bakes
  // text into the front/right half only), for later drift detection.
  const frontCover = project.screenplay
    ? getCursor(project.screenplay).content.frontCover
    : undefined;
  if (frontCover?.bakeText && project.title.trim()) {
    front.bakedText = {
      title: project.title,
      subtitle: frontCover.subtitle,
      author: frontCover.author,
    };
  }
  // Re-read the project so we fold onto the freshest trees (single writer).
  const store = useProjectsStore.getState();
  const cur = store.current() ?? project;
  await store.setIllustration(
    COVER_FRONT_ID,
    applyIllustrationRender(cur.illustrations?.[COVER_FRONT_ID], front),
  );
  const cur2 = store.current() ?? cur;
  await store.setIllustration(
    COVER_BACK_ID,
    applyIllustrationRender(cur2.illustrations?.[COVER_BACK_ID], back),
  );
  return true;
}

/**
 * Build a from-scratch illustration render task for the backend job queue: the
 * spread's anchors (that have an image) become reference blobs, the rest are
 * described in the prompt. Used for bulk "generate all pages" so generation runs
 * server-side and survives a refresh. Throws if no provider is configured.
 */
export function buildIllustrationTask(
  project: Project,
  spread: ScreenplaySpread,
  tier: ImageTier = DEFAULT_IMAGE_TIER,
): JobTask {
  const imageModel = resolveImageModelClient("pageIllustration", tier);
  if (!imageModel) {
    throw new ProviderError(
      "AI generation isn't available right now. It's being set up on the server.",
      { kind: "auth", retryable: false },
    );
  }
  requireKey(imageModel.provider);

  const byId = new Map((project.anchors ?? []).map((a) => [a.id, a]));
  const anchors = effectiveAnchorIds(project.anchors, spread)
    .map((id) => byId.get(id))
    .filter((a): a is Anchor => Boolean(a));

  const references: BlobRef[] = [];
  const referencedAnchors: Anchor[] = [];
  const describedAnchors: Anchor[] = [];
  for (const a of anchors) {
    const img = currentAnchorImage(a);
    if (img) {
      references.push({
        blobId: img.blobId,
        mimeType: img.mimeType,
        label: `${a.name} (${a.description})`,
        role: "subject",
      });
      referencedAnchors.push(a);
    } else {
      describedAnchors.push(a);
    }
  }

  // Lead with the art-style exemplar when the selected preset has an example
  // image configured; the worker resolves + prepends the actual image so the
  // task payload stays small.
  const artStyles = useAppConfigStore.getState().artStyles;
  const presetId = project.config.artStyle?.presetId ?? undefined;
  const hasStyleRef = Boolean(presetId && artStyles?.examples?.[presetId]);

  const prompt = buildIllustrationPrompt({
    spread,
    config: project.config,
    referencedAnchors,
    refreshAnchors: [],
    describedAnchors,
    removedAnchors: [],
    hasStyleRef,
    hasCompositionRef: false,
    maskMode: false,
    bakeText: spread.bakeText,
    coverTitle: spread.coverTitle,
    coverSubtitle: spread.coverSubtitle,
    coverAuthor: spread.coverAuthor,
    prompts: {
      artStyles,
      templates: useAppConfigStore.getState().prompts,
    },
  });

  const request: ImageRenderRequest = {
    provider: imageModel.provider,
    model: imageModel.id,
    prompt,
    size: chooseImageSize(spread.kind, project.config),
    references: references.length ? references : undefined,
    ...(hasStyleRef && presetId ? { stylePresetId: presetId } : {}),
  };

  return {
    id: spread.id,
    status: "pending",
    request,
    // Provenance captured at BUILD time (what the render actually uses), so a
    // reconcile that happens after further anchor edits doesn't stamp the page
    // with versions it never saw (which would silently skip the stale warning).
    referenceUses: currentReferenceUses(
      project.anchors,
      effectiveAnchorIds(project.anchors, spread),
    ),
  };
}

/** Apply a completed render task's result blob to a spread's illustration tree. */
export async function applyIllustrationResult(
  project: Project,
  spread: ScreenplaySpread,
  result: { blobId: string; mimeType: string },
  prompt: string,
  referenceUses?: ReferenceUse[],
): Promise<void> {
  const content: IllustrationImage = {
    blobId: result.blobId,
    mimeType: result.mimeType,
    references:
      referenceUses ??
      currentReferenceUses(project.anchors, effectiveAnchorIds(project.anchors, spread)),
    textMode: spread.textMode,
    prompt,
  };
  const tree = project.illustrations?.[spread.id];
  const versions = tree
    ? addVersion(tree, content, { parentId: tree.cursorId, prompt, label: "Initial" })
    : createVersionTree(content, { prompt, label: "Initial" });
  await useProjectsStore.getState().setIllustration(spread.id, versions);
}
