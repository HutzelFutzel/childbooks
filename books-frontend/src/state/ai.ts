/**
 * Bridges UI/stores to the pure core pipelines: reads credentials from the
 * settings store and the selected models from the current project, runs the
 * analysis / image generation, and persists results via the projects store.
 */
import { analyzeStory, generateAnchorDescription } from "../core/pipeline/analysis";
import {
  buildAnchorPrompt,
  generateAnchorImage,
} from "../core/pipeline/anchors";
import {
  buildAnchorSwapPrompt,
  buildIllustrationPrompt,
  chooseImageSize,
  generateIllustrationImage,
} from "../core/pipeline/illustration";
import { locateSubjects, type SubjectBox } from "../core/pipeline/localize";
import { mapSettled } from "../core/pipeline/concurrency";
import { generateScreenplay } from "../core/pipeline/screenplay";
import { ProviderError } from "../core/errors";
import { selectModels, type ResolvedModels } from "../core/models/registry";
import { hasKey } from "../core/settings";
import type { ReferenceImage } from "../core/providers/types";
import type {
  Anchor,
  AnchorImage,
  BookConfig,
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
import { getBlobBase64, putImageBlob } from "./blobs";
import { buildHoleMask, compositeMaskedRegion } from "./compositing";
import { useProjectsStore } from "./projectsStore";
import { useSettingsStore } from "./settingsStore";

function requireKey(provider: "openai" | "google"): string {
  const key = useSettingsStore.getState().settings.apiKeys[provider]?.trim();
  if (!key) {
    throw new ProviderError(
      `Add your ${provider === "openai" ? "OpenAI" : "Google"} API key in Settings first.`,
      { provider, kind: "auth", retryable: false },
    );
  }
  return key;
}

/**
 * Resolve the best models for every role automatically (the user never picks
 * models). Throws a friendly auth error when no provider key is configured.
 */
function resolveModels(): ResolvedModels {
  const { discovery, settings } = useSettingsStore.getState();
  const models = selectModels(discovery, (p) => hasKey(settings, p));
  if (!models) {
    throw new ProviderError(
      "Add an OpenAI or Google API key in Settings to start generating.",
      { kind: "auth", retryable: false },
    );
  }
  return models;
}

/** A config with the auto-resolved models filled in, for the pure pipelines. */
function withModels(config: BookConfig, models: ResolvedModels): BookConfig {
  return {
    ...config,
    textModel: models.textModel,
    imageModel: models.imageModel,
    anchorImageModel: models.anchorImageModel,
  };
}

/** Analyze the current project's story and store the detected anchors. */
export async function analyzeCurrentStory(signal?: AbortSignal): Promise<void> {
  const project = useProjectsStore.getState().current();
  if (!project) throw new Error("No active project.");
  const models = resolveModels();
  const key = requireKey(models.textModel.provider);

  const { summary, anchors } = await analyzeStory({
    story: project.config.storyText,
    config: withModels(project.config, models),
    creds: { apiKey: key },
    model: models.textModel.id,
    signal,
  });

  await useProjectsStore.getState().setAnalysis(
    { summary, generatedAt: Date.now(), model: models.textModel.id },
    anchors,
  );
}

/**
 * Suggest (and store) a visual description for an anchor based on the story,
 * referencing other anchors so relationships are captured. Returns the text.
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
  const models = resolveModels();
  const key = requireKey(models.textModel.provider);

  const description = await generateAnchorDescription({
    story: project.config.storyText,
    config: withModels(project.config, models),
    creds: { apiKey: key },
    model: models.textModel.id,
    name: anchor.name,
    type: anchor.type,
    existingAnchors: (project.anchors ?? [])
      .filter((a) => a.id !== anchorId)
      .map((a) => ({ name: a.name, type: a.type, description: a.description })),
    signal,
  });

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
 * Generate (or iterate on) an anchor image. Creates the version tree on first
 * generation, otherwise adds a child version and moves the cursor to it.
 */
export async function generateAnchorVersion(
  anchorId: string,
  options: GenerateAnchorOptions = {},
): Promise<void> {
  const project = useProjectsStore.getState().current();
  if (!project) throw new Error("No active project.");
  const anchor = project.anchors?.find((a) => a.id === anchorId);
  if (!anchor) throw new Error("Anchor not found.");

  const isIteration = Boolean(anchor.versions);
  const isEdit = Boolean(options.edit?.trim());
  const sourceNodeId = options.fromNodeId ?? anchor.versions?.cursorId;

  // Explicitly linked anchors (a relative to resemble, or an object/place this
  // one contains). Their current images are fed in as context so relationships
  // and embedded subjects stay consistent.
  const all = project.anchors ?? [];
  const containedAnchors = containedAnchorsFor(anchor, all);
  const relatedAnchors = relatedAnchorsFor(anchor, all);
  const linked = linkedAnchorsFor(anchor, all);

  // Anchors are generated often during setup, so they normally use a
  // faster/cheaper dedicated model. But when a place/object embeds other anchors
  // (e.g. a room containing a specific bed), the embedded subjects must stay
  // pixel-consistent with their own reference sheets — which needs higher
  // fidelity — so we prefer the GPT Image model whenever an OpenAI key exists.
  const models = resolveModels();
  const hasEmbedded = anchor.type !== "character" && containedAnchors.length > 0;
  const imageModel =
    hasEmbedded && models.imageModel.provider === "openai"
      ? models.imageModel
      : models.anchorImageModel;
  const key = requireKey(imageModel.provider);

  const relationRefs: ReferenceImage[] = [];
  for (const rel of linked) {
    const img = currentAnchorImage(rel);
    const data = img ? await getBlobBase64(img.blobId) : null;
    if (data) {
      relationRefs.push({
        base64: data.base64,
        mimeType: data.mimeType,
        role: "relation",
        label: rel.name,
      });
    }
  }

  // The anchor's own previous image (edit base, or likeness on iterations).
  let subjectRef: ReferenceImage | null = null;
  if (options.useReference && anchor.versions && sourceNodeId) {
    const src = anchor.versions.nodes[sourceNodeId];
    if (src) {
      const data = await getBlobBase64(src.content.blobId);
      if (data) {
        subjectRef = {
          base64: data.base64,
          mimeType: data.mimeType,
          role: "subject",
          label: anchor.name,
        };
      }
    }
  }

  // gpt-image-2's images/edits endpoint composes a NEW image from every
  // reference it's given (no mask = no single "canvas" image), so we can pass
  // the anchor's own likeness together with its contained/related references —
  // even on a from-scratch generation — and let the prompt describe how they
  // combine. We still lead with the anchor's own image when present so an edit
  // is framed as a change to that sheet. Gemini composes labeled references
  // regardless of order.
  const isOpenAI = imageModel.provider === "openai";
  const editFromImage = isEdit && Boolean(subjectRef);
  let references: ReferenceImage[];
  if (editFromImage || isOpenAI) {
    references = [...(subjectRef ? [subjectRef] : []), ...relationRefs];
  } else {
    references = [...relationRefs, ...(subjectRef ? [subjectRef] : [])];
  }

  const prompt = buildAnchorPrompt({
    anchor,
    artStyle: project.config.artStyle,
    containedAnchors,
    relatedAnchors,
    edit: options.edit,
    editFromImage,
  });

  const result = await generateAnchorImage({
    prompt,
    creds: { apiKey: key },
    model: imageModel.id,
    providerId: imageModel.provider,
    references: references.length ? references : undefined,
    signal: options.signal,
  });

  const blobId = await putImageBlob(result.base64, result.mimeType);
  const content: AnchorImage = {
    blobId,
    mimeType: result.mimeType,
    references: linked.map((r) => ({
      anchorId: r.id,
      versionId: r.versions?.cursorId,
      signature: anchorSignature(r),
    })),
  };

  const label = options.edit?.trim() || (isIteration ? "Variation" : "Initial");
  const versions = anchor.versions
    ? addVersion(anchor.versions, content, {
        parentId: sourceNodeId,
        prompt,
        label,
      })
    : createVersionTree(content, { prompt, label });

  await useProjectsStore.getState().updateAnchor(anchorId, { versions });
}

/** Current image content for an anchor, if any. */
export function currentAnchorImage(anchor: Anchor): AnchorImage | null {
  if (!anchor.versions) return null;
  return getCursor(anchor.versions).content;
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
  const models = resolveModels();
  const key = requireKey(models.textModel.provider);

  const tree = project.screenplay;
  const previous =
    options.edit && tree ? getCursor(tree).content : undefined;

  const doc = await generateScreenplay({
    config: withModels(project.config, models),
    anchors: project.anchors ?? [],
    creds: { apiKey: key },
    model: models.textModel.id,
    edit: options.edit,
    previous,
    signal: options.signal,
  });

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

/**
 * A stable signature of an anchor's text inputs (description / guidance / mode).
 * When this changes, a page using the anchor should be considered stale even if
 * the image version id did not change.
 */
function anchorSignature(a: Anchor): string {
  return [a.description ?? "", a.userGuidance ?? "", a.mode ?? ""].join("\u0000");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveIds(ids: string[] | undefined, all: Anchor[], selfId: string): Anchor[] {
  if (!ids || ids.length === 0) return [];
  const set = new Set(ids);
  return all.filter((a) => a.id !== selfId && set.has(a.id));
}

/**
 * Anchors explicitly CONTAINED within this one (place/object), resolved by id.
 * Relations are user-declared (no fragile name matching), so the dependency and
 * staleness graphs only follow links the user actually created.
 */
export function containedAnchorsFor(anchor: Anchor, all: Anchor[]): Anchor[] {
  return resolveIds(anchor.containedIds, all, anchor.id);
}

/** Anchors this one explicitly RELATES to / resembles, resolved by id. */
export function relatedAnchorsFor(anchor: Anchor, all: Anchor[]): Anchor[] {
  return resolveIds(anchor.relatedIds, all, anchor.id);
}

/** All explicitly linked anchors (contained + related) for refs/staleness/ordering. */
export function linkedAnchorsFor(anchor: Anchor, all: Anchor[]): Anchor[] {
  const ids = [...(anchor.containedIds ?? []), ...(anchor.relatedIds ?? [])];
  return resolveIds(ids, all, anchor.id);
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

/**
 * Order anchors into dependency layers so that a referenced anchor (e.g. a bed
 * contained in a room) is generated before the anchor that references it.
 * Anchors in the same layer have no remaining dependencies on each other.
 */
export function orderAnchorsByDependency(anchors: Anchor[]): Anchor[][] {
  const ids = new Set(anchors.map((a) => a.id));
  const deps = new Map<string, Set<string>>();
  for (const a of anchors) {
    const rel = linkedAnchorsFor(a, anchors)
      .map((r) => r.id)
      .filter((id) => ids.has(id));
    deps.set(a.id, new Set(rel));
  }
  const done = new Set<string>();
  const layers: Anchor[][] = [];
  let remaining = [...anchors];
  while (remaining.length > 0) {
    const ready = remaining.filter((a) => [...deps.get(a.id)!].every((d) => done.has(d)));
    if (ready.length === 0) {
      // Cycle (e.g. mutual references) — emit the rest together to avoid a hang.
      layers.push(remaining);
      break;
    }
    layers.push(ready);
    ready.forEach((a) => done.add(a.id));
    remaining = remaining.filter((a) => !done.has(a.id));
  }
  return layers;
}

/**
 * Reference provenance an illustration's spread would currently use, so we can
 * record it and later detect when a reference changed. Records EVERY anchor on
 * the spread (even image-less ones) plus a signature of its text inputs.
 */
function currentReferenceUses(project: Project, anchorIds: string[]): ReferenceUse[] {
  const byId = new Map((project.anchors ?? []).map((a) => [a.id, a]));
  const uses: ReferenceUse[] = [];
  for (const id of anchorIds) {
    const a = byId.get(id);
    if (!a) continue;
    uses.push({
      anchorId: id,
      versionId: a.versions?.cursorId,
      signature: anchorSignature(a),
    });
  }
  return uses;
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
 * Update each changed subject IN PLACE on an existing page: locate the subject
 * in the current page, build a tight mask around it, regenerate only that region
 * from the subject's NEW reference, then composite the result back so every
 * pixel outside the region stays byte-identical. Subjects are updated one at a
 * time (threaded through `current`) which keeps the binding unambiguous on
 * providers (OpenAI) that can't label references.
 *
 * Returns the updated image, or null when any step fails for any subject — in
 * which case the caller falls back to a whole-page regeneration.
 */
/** Max subjects edited in parallel within one page (keeps under rate limits). */
const SURGICAL_CONCURRENCY = 3;

async function trySurgicalAnchorUpdate(args: {
  project: Project;
  refreshAnchors: Anchor[];
  page: { base64: string; mimeType: string };
  imageModel: ResolvedModels["imageModel"];
  imageKey: string;
  size: string;
  signal?: AbortSignal;
}): Promise<{ base64: string; mimeType: string; appliedIds: string[] } | null> {
  const { refreshAnchors, imageModel, imageKey, size, signal } = args;

  // Localization runs on the auto-selected (vision-capable) text model.
  const textModel = resolveModels().textModel;
  let textKey: string;
  try {
    textKey = requireKey(textModel.provider);
  } catch {
    return null;
  }
  const isOpenAI = imageModel.provider === "openai";

  // Load the NEW reference image for each changed subject (in parallel).
  type Subject = {
    anchor: Anchor;
    ref: { base64: string; mimeType: string };
  };
  const subjects = (
    await Promise.all(
      refreshAnchors.map(async (anchor): Promise<Subject | null> => {
        const img = currentAnchorImage(anchor);
        const ref = img ? await getBlobBase64(img.blobId) : null;
        return ref ? { anchor, ref } : null;
      }),
    )
  ).filter((s): s is Subject => Boolean(s));
  if (subjects.length === 0) return null;

  // ONE combined localization call for all subjects on the original page.
  const boxes = await locateSubjects({
    pageBase64: args.page.base64,
    pageMime: args.page.mimeType,
    subjects: subjects.map((s) => ({
      id: s.anchor.id,
      name: s.anchor.name,
      description: s.anchor.description,
    })),
    creds: { apiKey: textKey },
    model: textModel.id,
    providerId: textModel.provider,
    signal,
  });

  type Located = Subject & { box: SubjectBox };
  const located: Located[] = subjects
    .map((s) => ({ ...s, box: boxes.get(s.anchor.id) ?? null }))
    .filter((s): s is Located => Boolean(s.box));
  if (located.length === 0) return null;

  // Regenerate each subject's region IN PARALLEL against the original page
  // (disjoint masks), then composite them in afterwards. Lower quality keeps
  // each edit fast — final fidelity of a small region matters less.
  const edits = await mapSettled(
    located,
    async (s) => {
      const mask = await buildHoleMask({
        pageBase64: args.page.base64,
        pageMime: args.page.mimeType,
        box: s.box,
        paddingFrac: 0.12,
      });
      const references: ReferenceImage[] = [
        { base64: args.page.base64, mimeType: args.page.mimeType, role: "composition" },
        { base64: s.ref.base64, mimeType: s.ref.mimeType, role: "subject", label: s.anchor.name },
      ];
      const result = await generateIllustrationImage({
        prompt: buildAnchorSwapPrompt({
          anchor: s.anchor,
          config: args.project.config,
          maskMode: isOpenAI,
        }),
        size,
        creds: { apiKey: imageKey },
        model: imageModel.id,
        providerId: imageModel.provider,
        references,
        // OpenAI constrains the edit to the masked region; Gemini regenerates the
        // full frame and we rely on the composite below to keep the rest intact.
        mask: isOpenAI ? mask : undefined,
        quality: "medium",
        signal,
      });
      return { anchorId: s.anchor.id, edited: result, mask };
    },
    { concurrency: SURGICAL_CONCURRENCY },
  );

  // Composite each successful region back onto the original (cheap, sequential)
  // so every pixel outside the edited regions stays byte-identical.
  let current = args.page;
  const appliedIds: string[] = [];
  for (const e of edits) {
    if (e.status !== "fulfilled") continue;
    const { anchorId, edited, mask } = e.value;
    try {
      const composited = await compositeMaskedRegion({
        originalBase64: current.base64,
        originalMime: current.mimeType,
        editedBase64: edited.base64,
        editedMime: edited.mimeType,
        maskBase64: mask.base64,
      });
      if (!composited.base64) continue;
      current = { base64: composited.base64, mimeType: composited.mimeType };
      appliedIds.push(anchorId);
    } catch {
      // Skip this subject; it stays stale so the user can retry it.
    }
  }

  return appliedIds.length > 0 ? { ...current, appliedIds } : null;
}

/**
 * Generate (or iterate on) the illustration for a screenplay spread, feeding
 * the spread's anchors in as reference images for consistency.
 */
export async function generateIllustrationVersion(
  spread: ScreenplaySpread,
  options: GenerateIllustrationOptions = {},
): Promise<void> {
  const project = useProjectsStore.getState().current();
  if (!project) throw new Error("No active project.");
  if (spread.placeholder) return; // blank pages are not illustrated

  const imageModel = resolveModels().imageModel;
  const key = requireKey(imageModel.provider);

  // Resolve the spread's anchors in their declared order, so reference images
  // line up with how they're enumerated in the prompt.
  const byId = new Map((project.anchors ?? []).map((a) => [a.id, a]));
  const anchors = spread.anchorIds
    .map((id) => byId.get(id))
    .filter((a): a is Anchor => Boolean(a));

  // For inpainting, the mask must align to the FIRST reference image, so we
  // send only the page image (no anchor references) and rely on prompt-locking.
  const inpaint = Boolean(options.mask);

  // Anchor reference images for consistency (in order); split out ones without
  // a generated image so they can still be described in the prompt.
  const references: ReferenceImage[] = [];
  const referencedAnchors: Anchor[] = [];
  const describedAnchors: Anchor[] = [];
  if (!inpaint) {
    for (const a of anchors) {
      const img = currentAnchorImage(a);
      const data = img ? await getBlobBase64(img.blobId) : null;
      if (data) {
        references.push({
          base64: data.base64,
          mimeType: data.mimeType,
          label: `${a.name} (${a.description})`,
          role: "subject",
        });
        referencedAnchors.push(a);
      } else {
        describedAnchors.push(a);
      }
    }
  }

  // A mask implies inpainting the current page, so we always need its image as
  // the final (here, only) composition reference.
  const wantCompositionRef = options.useReference || inpaint;

  // Optionally append the previous illustration as the FINAL composition ref.
  const tree = project.illustrations?.[spread.id];
  const sourceNodeId = options.fromNodeId ?? tree?.cursorId;
  let hasCompositionRef = false;
  let compositionData: { base64: string; mimeType: string } | null = null;
  let removedAnchors: Anchor[] = [];
  let refreshAnchors: Anchor[] = [];
  // Recorded reference uses of the previous version (for honest provenance when
  // only some subjects get updated).
  let prevById = new Map<string, ReferenceUse>();
  // Whether the page's subject SET changed (added/removed anchors) since the
  // previous version — surgical in-place updates can't add or remove subjects,
  // so we defer to the whole-page path in that case.
  let structuralChange = false;
  if (wantCompositionRef && tree && sourceNodeId) {
    const src = tree.nodes[sourceNodeId];
    if (src) {
      const data = await getBlobBase64(src.content.blobId);
      if (data) {
        references.push({
          base64: data.base64,
          mimeType: data.mimeType,
          role: "composition",
        });
        compositionData = data;
        hasCompositionRef = true;
        // Subjects present in the previous version but no longer active on this
        // spread must be explicitly removed (they linger in the composition ref).
        const prevRefs = src.content.references ?? [];
        prevById = new Map(prevRefs.map((r) => [r.anchorId, r]));
        removedAnchors = prevRefs
          .map((r) => r.anchorId)
          .filter((id) => !spread.anchorIds.includes(id))
          .map((id) => byId.get(id))
          .filter((a): a is Anchor => Boolean(a));
        const addedCount = spread.anchorIds.filter(
          (id) => !prevById.has(id) && byId.has(id),
        ).length;
        structuralChange = removedAnchors.length > 0 || addedCount > 0;
        // Subjects still on the page whose design changed since this version was
        // generated (different image version or edited text). With an edit, the
        // prompt should ALSO refresh these — unless the edit already names them.
        const editLower = options.edit?.toLowerCase() ?? "";
        refreshAnchors = referencedAnchors.filter((a) => {
          const prev = prevById.get(a.id);
          if (!prev) return false; // newly added subject, not a "refresh"
          const versionChanged = (a.versions?.cursorId ?? undefined) !== prev.versionId;
          const textChanged =
            prev.signature !== undefined && prev.signature !== anchorSignature(a);
          if (!versionChanged && !textChanged) return false;
          return !editLower.includes(a.name.toLowerCase());
        });
      }
    }
  }

  const maskMode = Boolean(options.mask && hasCompositionRef);

  // Plain "update this page" (refresh changed subjects, no manual mask, no text
  // edit): update each changed subject in place via an auto-located masked edit
  // so the rest of the page stays pixel-identical. Falls back to the whole-page
  // regeneration below if localization or any model call fails.
  const isPlainRefresh =
    Boolean(options.useReference) &&
    !options.mask &&
    !options.edit?.trim() &&
    hasCompositionRef &&
    Boolean(compositionData) &&
    !structuralChange &&
    refreshAnchors.length > 0;
  if (isPlainRefresh && compositionData) {
    const surgical = await trySurgicalAnchorUpdate({
      project,
      refreshAnchors,
      page: compositionData,
      imageModel,
      imageKey: key,
      size: chooseImageSize(spread.kind, project.config.bookSize),
      signal: options.signal,
    });
    if (surgical) {
      const appliedSet = new Set(surgical.appliedIds);
      const appliedNames = refreshAnchors
        .filter((a) => appliedSet.has(a.id))
        .map((a) => a.name);
      const updatePrompt = `Updated ${appliedNames.join(", ")} to their new reference designs (in-place, rest of page unchanged).`;
      // Honest provenance: record applied/stable subjects at their current
      // version, but keep any subject we COULDN'T update at its previously
      // recorded version so the page stays flagged stale and can be retried.
      const refreshIds = new Set(refreshAnchors.map((a) => a.id));
      const references: ReferenceUse[] = spread.anchorIds
        .map((id): ReferenceUse | null => {
          const a = byId.get(id);
          if (!a) return null;
          const missed = refreshIds.has(id) && !appliedSet.has(id);
          if (missed) {
            const prev = prevById.get(id);
            if (prev) return prev;
          }
          return {
            anchorId: id,
            versionId: a.versions?.cursorId,
            signature: anchorSignature(a),
          };
        })
        .filter((u): u is ReferenceUse => Boolean(u));
      const blobId = await putImageBlob(surgical.base64, surgical.mimeType);
      const content: IllustrationImage = {
        blobId,
        mimeType: surgical.mimeType,
        references,
        textMode: spread.textMode,
        prompt: updatePrompt,
      };
      const versions = tree
        ? addVersion(tree, content, { parentId: sourceNodeId, prompt: updatePrompt, label: "Update" })
        : createVersionTree(content, { prompt: updatePrompt, label: "Update" });
      await useProjectsStore.getState().setIllustration(spread.id, versions);
      return;
    }
  }

  const prompt = buildIllustrationPrompt({
    spread,
    config: project.config,
    referencedAnchors,
    refreshAnchors,
    describedAnchors,
    removedAnchors,
    hasCompositionRef,
    maskMode,
    edit: options.edit,
  });

  const result = await generateIllustrationImage({
    prompt,
    size: chooseImageSize(spread.kind, project.config.bookSize),
    creds: { apiKey: key },
    model: imageModel.id,
    providerId: imageModel.provider,
    references: references.length ? references : undefined,
    mask: maskMode ? options.mask : undefined,
    signal: options.signal,
  });

  // For masked touch-ups, paste the edited output back over the original only
  // inside the painted region so everything outside it stays pixel-identical.
  let finalBase64 = result.base64;
  let finalMime = result.mimeType;
  if (maskMode && options.mask && compositionData) {
    try {
      const composited = await compositeMaskedRegion({
        originalBase64: compositionData.base64,
        originalMime: compositionData.mimeType,
        editedBase64: result.base64,
        editedMime: result.mimeType,
        maskBase64: options.mask.base64,
      });
      if (composited.base64) {
        finalBase64 = composited.base64;
        finalMime = composited.mimeType;
      }
    } catch {
      // Fall back to the raw model output if compositing fails.
    }
  }

  const blobId = await putImageBlob(finalBase64, finalMime);
  const content: IllustrationImage = {
    blobId,
    mimeType: finalMime,
    references: currentReferenceUses(project, spread.anchorIds),
    textMode: spread.textMode,
    prompt,
  };
  const label = options.edit?.trim() || (tree ? "Variation" : "Initial");
  const versions = tree
    ? addVersion(tree, content, { parentId: sourceNodeId, prompt, label })
    : createVersionTree(content, { prompt, label });

  await useProjectsStore.getState().setIllustration(spread.id, versions);
}
