/**
 * Platform-agnostic illustration orchestration.
 *
 * This is the single source of truth for how a spread's illustration is
 * generated — whole-page generation, edits, mask inpainting, and surgical
 * in-place subject refreshes — including prompt assembly, reference resolution,
 * compositing and version-tree bookkeeping.
 *
 * All side-effecting capabilities (blob IO, compositing, model selection, API
 * keys) are injected via {@link PipelineEnv} so the exact same logic runs on the
 * client (browser canvas + Firestore/Storage blobs) and in the backend worker
 * (sharp + Admin SDK Storage). The function is pure with respect to project
 * state: it reads the passed-in `Project` and returns the new version tree for
 * the caller to persist.
 */
import type { ProviderId } from "../config/options";
import type { ResolvedModels } from "../models/registry";
import type { ReferenceImage } from "../providers/types";
import type {
  Anchor,
  IllustrationImage,
  Project,
  ReferenceUse,
  ScreenplaySpread,
} from "../types";
import {
  addVersion,
  createVersionTree,
  type VersionTree,
} from "../versioning";
import { mapSettled } from "./concurrency";
import {
  buildAnchorSwapPrompt,
  buildIllustrationPrompt,
  chooseImageSize,
  generateIllustrationImage,
} from "./illustration";
import { locateSubjects, type SubjectBox } from "./localize";
import { effectiveAnchorIds } from "../book/anchorRefs";
import { anchorSignature, currentAnchorImage, currentReferenceUses } from "./provenance";
import type { PromptContext } from "../prompts/context";

/** Compositing operations, in base64 terms so core stays Buffer-free. */
export interface CompositeOps {
  /** Paste the edited output back over the original only inside the mask hole. */
  compositeMaskedRegion(input: {
    originalBase64: string;
    originalMime: string;
    editedBase64: string;
    editedMime: string;
    maskBase64: string;
  }): Promise<{ base64: string; mimeType: string }>;
  /** Build an inpainting mask: opaque page with a transparent hole over `box`. */
  buildHoleMask(input: {
    pageBase64: string;
    pageMime: string;
    box: { x: number; y: number; width: number; height: number };
    paddingFrac?: number;
  }): Promise<{ base64: string; mimeType: string }>;
}

/** Injected capabilities the orchestration needs from its host platform. */
export interface PipelineEnv {
  /** Auto-resolved models for every role. */
  models: ResolvedModels;
  /**
   * Resolve the API key for a provider. Implementations may return "" when the
   * key is injected downstream (e.g. the client talks through an authed proxy),
   * but MUST throw a friendly error when the provider is unavailable.
   */
  apiKeyFor(provider: ProviderId): string;
  /** Read a stored blob as base64, or null when missing. */
  loadBlob(blobId: string): Promise<{ base64: string; mimeType: string } | null>;
  /** Persist a base64 image and return its new blob id. */
  saveImage(base64: string, mimeType: string): Promise<string>;
  composite: CompositeOps;
  /** Admin-managed prompt overlays (art styles, age writing). */
  prompts?: PromptContext;
}

export interface IllustrationRunOptions {
  edit?: string;
  fromNodeId?: string;
  /** Reuse the source version's image as a reference (keep composition). */
  useReference?: boolean;
  /** Inpainting mask (transparent hole = region to change). Forces composition ref. */
  mask?: ReferenceImage;
  signal?: AbortSignal;
}

/**
 * The product of rendering one illustration: the stored blob plus everything
 * needed to record it as a version. Kept separate from the version tree so the
 * heavy render can run anywhere (worker) while the tree is mutated by whoever
 * owns the project state (the client), preserving a single writer.
 */
export interface IllustrationRender {
  blobId: string;
  mimeType: string;
  references: ReferenceUse[];
  prompt: string;
  label: string;
  textMode: IllustrationImage["textMode"];
  /** Parent version to branch from (the source node), if any. */
  parentId?: string;
}

/** Wrap a render into a (new or extended) version tree. Pure. */
export function applyIllustrationRender(
  tree: VersionTree<IllustrationImage> | undefined,
  render: IllustrationRender,
): VersionTree<IllustrationImage> {
  const content: IllustrationImage = {
    blobId: render.blobId,
    mimeType: render.mimeType,
    references: render.references,
    textMode: render.textMode,
    prompt: render.prompt,
  };
  return tree
    ? addVersion(tree, content, {
        parentId: render.parentId,
        prompt: render.prompt,
        label: render.label,
      })
    : createVersionTree(content, { prompt: render.prompt, label: render.label });
}

/** Max subjects edited in parallel within one page (keeps under rate limits). */
const SURGICAL_CONCURRENCY = 3;

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
async function trySurgicalAnchorUpdate(args: {
  config: Project["config"];
  refreshAnchors: Anchor[];
  page: { base64: string; mimeType: string };
  imageModel: ResolvedModels["imageModel"];
  imageKey: string;
  size: string;
  env: PipelineEnv;
  signal?: AbortSignal;
}): Promise<{ base64: string; mimeType: string; appliedIds: string[] } | null> {
  const { refreshAnchors, imageModel, imageKey, size, env, signal } = args;

  // Localization runs on the auto-selected (vision-capable) text model.
  const textModel = env.models.textModel;
  let textKey: string;
  try {
    textKey = env.apiKeyFor(textModel.provider);
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
        const ref = img ? await env.loadBlob(img.blobId) : null;
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
      const mask = await env.composite.buildHoleMask({
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
          config: args.config,
          maskMode: isOpenAI,
          prompts: env.prompts,
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
      const composited = await env.composite.compositeMaskedRegion({
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
 * Render (or iterate on) the illustration for a screenplay spread, feeding the
 * spread's anchors in as reference images for consistency. Does all the heavy
 * work — prompt assembly, reference resolution, model calls, surgical edits and
 * compositing — and stores the result blob, returning a {@link IllustrationRender}
 * for the caller to fold into the project's version tree. Returns null for a
 * placeholder spread.
 */
export async function renderIllustration(
  project: Project,
  spread: ScreenplaySpread,
  options: IllustrationRunOptions,
  env: PipelineEnv,
): Promise<IllustrationRender | null> {
  if (spread.placeholder) return null; // blank pages are not illustrated

  const imageModel = env.models.imageModel;
  const key = env.apiKeyFor(imageModel.provider);

  // Resolve the spread's anchors in their declared order, so reference images
  // line up with how they're enumerated in the prompt.
  const byId = new Map((project.anchors ?? []).map((a) => [a.id, a]));
  // Heal any drifted ids by name before resolving, so references aren't dropped.
  const effectiveIds = effectiveAnchorIds(project.anchors, spread);
  const anchors = effectiveIds
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
      const data = img ? await env.loadBlob(img.blobId) : null;
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
      const data = await env.loadBlob(src.content.blobId);
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
          .filter((id) => !effectiveIds.includes(id))
          .map((id) => byId.get(id))
          .filter((a): a is Anchor => Boolean(a));
        const addedCount = effectiveIds.filter(
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
      config: project.config,
      refreshAnchors,
      page: compositionData,
      imageModel,
      imageKey: key,
      size: chooseImageSize(spread.kind, project.config),
      env,
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
      const refUses: ReferenceUse[] = effectiveIds
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
      const blobId = await env.saveImage(surgical.base64, surgical.mimeType);
      return {
        blobId,
        mimeType: surgical.mimeType,
        references: refUses,
        prompt: updatePrompt,
        label: "Update",
        textMode: spread.textMode,
        parentId: sourceNodeId,
      };
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
    prompts: env.prompts,
  });

  const result = await generateIllustrationImage({
    prompt,
    size: chooseImageSize(spread.kind, project.config),
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
      const composited = await env.composite.compositeMaskedRegion({
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

  const blobId = await env.saveImage(finalBase64, finalMime);
  const label = options.edit?.trim() || (tree ? "Variation" : "Initial");
  return {
    blobId,
    mimeType: finalMime,
    references: currentReferenceUses(project.anchors, effectiveIds),
    prompt,
    label,
    textMode: spread.textMode,
    parentId: sourceNodeId,
  };
}

/**
 * Render + fold into the version tree in one call (the inline client path).
 * Returns the new tree, or null for a placeholder spread.
 */
export async function runIllustration(
  project: Project,
  spread: ScreenplaySpread,
  options: IllustrationRunOptions,
  env: PipelineEnv,
): Promise<VersionTree<IllustrationImage> | null> {
  const render = await renderIllustration(project, spread, options, env);
  if (!render) return null;
  return applyIllustrationRender(project.illustrations?.[spread.id], render);
}
