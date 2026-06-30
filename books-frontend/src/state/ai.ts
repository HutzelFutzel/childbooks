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
import { ProviderError } from "../core/errors";
import type { ResolvedModels } from "../core/models/registry";
import type { ProviderId } from "../core/config/options";
import type { ReferenceImage } from "../core/providers/types";
import type {
  Anchor,
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
  illustrationRemote,
  screenplayRemote,
} from "../platform/aiClient";
import { resolveImageModelClient, resolveModelsClient } from "../platform/aiResolve";
import { useProjectsStore } from "./projectsStore";
import { useSettingsStore } from "./settingsStore";

// Re-exported for existing UI imports (moved to the platform-agnostic core).
export { currentAnchorImage } from "../core/pipeline/provenance";
export {
  containedAnchorsFor,
  relatedAnchorsFor,
  linkedAnchorsFor,
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
export function getResolvedModels(): ResolvedModels {
  const models = resolveModelsClient();
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
  const render = await anchorImageRemote(project, anchorId, options as AnchorRunOptions);
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
  const previous =
    options.edit && tree ? getCursor(tree).content : undefined;

  const doc = await screenplayRemote(project, options.edit, previous, options.signal);

  const label = options.edit?.trim() || (tree ? "Regenerated" : "Initial");
  const versions = tree
    ? addVersion(tree, doc, { prompt: options.edit, label })
    : createVersionTree(doc, { label });

  await useProjectsStore.getState().setScreenplay(versions);
}

export interface GenerateIllustrationOptions {
  edit?: string;
  fromNodeId?: string;
  /** Reuse the source version's image as a reference (keep composition). */
  useReference?: boolean;
  /** Inpainting mask (transparent hole = region to change). Forces composition ref. */
  mask?: ReferenceImage;
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
  const linked = new Set([...(anchor.containedIds ?? []), ...(anchor.relatedIds ?? [])]);
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
    const isStale = used.some((u) => {
      const r = byId.get(u.anchorId);
      if (!r) return true;
      if ((r.versions?.cursorId ?? undefined) !== u.versionId) return true;
      if (u.signature !== undefined && u.signature !== anchorSignature(r)) return true;
      return false;
    });
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
    const versionChanged = (a.versions?.cursorId ?? undefined) !== u.versionId;
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
  const stale: string[] = [];
  for (const [spreadId, tree] of Object.entries(project.illustrations ?? {})) {
    const content = getCursor(tree).content;
    const used = content.references ?? [];
    const isStale = used.some((u) => {
      const a = byId.get(u.anchorId);
      if (!a) return true; // anchor was deleted
      if ((a.versions?.cursorId ?? undefined) !== u.versionId) return true;
      // Only compare signatures for records that carry one (back-compat).
      if (u.signature !== undefined && u.signature !== anchorSignature(a)) return true;
      return false;
    });
    if (isStale) stale.push(spreadId);
  }
  return stale;
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
  const render = await illustrationRemote(project, spread.id, options as IllustrationRunOptions);
  if (!render) return;
  const versions = applyIllustrationRender(project.illustrations?.[spread.id], render);
  await useProjectsStore.getState().setIllustration(spread.id, versions);
}

/**
 * Build a from-scratch illustration render task for the backend job queue: the
 * spread's anchors (that have an image) become reference blobs, the rest are
 * described in the prompt. Used for bulk "generate all pages" so generation runs
 * server-side and survives a refresh. Throws if no provider is configured.
 */
export function buildIllustrationTask(project: Project, spread: ScreenplaySpread): JobTask {
  const imageModel = resolveImageModelClient("pageIllustration");
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

  const prompt = buildIllustrationPrompt({
    spread,
    config: project.config,
    referencedAnchors,
    refreshAnchors: [],
    describedAnchors,
    removedAnchors: [],
    hasCompositionRef: false,
    maskMode: false,
  });

  const request: ImageRenderRequest = {
    provider: imageModel.provider,
    model: imageModel.id,
    prompt,
    size: chooseImageSize(spread.kind, project.config.bookSize),
    references: references.length ? references : undefined,
  };

  return { id: spread.id, status: "pending", request };
}

/** Apply a completed render task's result blob to a spread's illustration tree. */
export async function applyIllustrationResult(
  project: Project,
  spread: ScreenplaySpread,
  result: { blobId: string; mimeType: string },
  prompt: string,
): Promise<void> {
  const content: IllustrationImage = {
    blobId: result.blobId,
    mimeType: result.mimeType,
    references: currentReferenceUses(project.anchors, effectiveAnchorIds(project.anchors, spread)),
    textMode: spread.textMode,
    prompt,
  };
  const tree = project.illustrations?.[spread.id];
  const versions = tree
    ? addVersion(tree, content, { parentId: tree.cursorId, prompt, label: "Initial" })
    : createVersionTree(content, { prompt, label: "Initial" });
  await useProjectsStore.getState().setIllustration(spread.id, versions);
}
