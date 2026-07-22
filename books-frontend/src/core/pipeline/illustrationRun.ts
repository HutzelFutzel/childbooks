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
  DepictedSubject,
  IllustrationImage,
  Project,
  ReferenceUse,
  ScreenplaySpread,
} from "../types";
import { COVER_BACK_ID, COVER_FRONT_ID } from "../types";

/** True for the front/back cover pseudo-spreads (adds cover-only negatives). */
function isCoverSpread(spread: ScreenplaySpread): boolean {
  return spread.id === COVER_FRONT_ID || spread.id === COVER_BACK_ID;
}
import {
  addVersion,
  createVersionTree,
  DEFAULT_MAX_VERSIONS,
  getCursor,
  pruneVersionTree,
  type VersionTree,
} from "../versioning";
import { mapSettled } from "./concurrency";
import {
  buildAnchorSwapPrompt,
  buildIllustrationPrompt,
  buildModifySubjectPrompt,
  buildRemoveRegionPrompt,
  chooseImageSize,
  generateIllustrationImage,
} from "./illustration";
import { embeddedPairsAmong } from "../book/anchorGraph";
import { paginate } from "./pagination";
import type { PageSide } from "../book/layouts";
import {
  canonicalEditText,
  IntentAmbiguousError,
  isFullyStructured,
  mentionedAnchorIds,
  resolveEditIntent,
  type ResolvedEditOp,
} from "./intentResolve";
import {
  locateAndCountSubjects,
  locateEmbeddedObsolete,
  locateSubjects,
  type SubjectBox,
} from "./localize";
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
  /**
   * Resolve the admin-managed example image for an art-style preset (fetched
   * from the art-styles config), or null when none is configured/fetchable.
   * Used to steer generation toward the selected style with a real exemplar
   * rather than only a textual description.
   */
  loadStyleImage(presetId: string): Promise<{ base64: string; mimeType: string } | null>;
  /**
   * Shrink an image that is about to be sent to a model as a REFERENCE (not as
   * a compositing base): resize + re-encode so multi-megabyte stored blobs don't
   * inflate the request payload — oversized payloads are the main cause of
   * stalled provider calls. Optional; identity when the host can't resize.
   * Never applied to images a mask must align to, or to compositing bases.
   */
  downscaleRef?(image: { base64: string; mimeType: string }): Promise<{ base64: string; mimeType: string }>;
  composite: CompositeOps;
  /** Admin-managed prompt overlays (art styles, age writing). */
  prompts?: PromptContext;
  /**
   * Optional step tagger for cost attribution: wraps an internal pipeline step
   * (e.g. "image", "binding", "localize") so its provider calls are metered
   * under that step while still rolling up into the action's combined cost.
   * Identity (just runs `fn`) when the host doesn't meter per step.
   */
  runStep?<T>(step: string, fn: () => Promise<T>): Promise<T>;
}

export interface IllustrationRunOptions {
  edit?: string;
  /** When intent resolution was ambiguous, the user-selected target anchor id. */
  intentTargetAnchorId?: string;
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
  /** Cover-only: the exact text baked into the artwork (typographic covers). */
  bakedText?: IllustrationImage["bakedText"];
  /** Subjects bound to regions in the rendered image (post-render binding pass). */
  depicted?: DepictedSubject[];
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
    ...(render.bakedText ? { bakedText: render.bakedText } : {}),
    ...(render.depicted ? { depicted: render.depicted } : {}),
  };
  const next = tree
    ? addVersion(tree, content, {
        parentId: render.parentId,
        prompt: render.prompt,
        label: render.label,
      })
    : createVersionTree(content, { prompt: render.prompt, label: render.label });
  // Bound history so the persisted project can't grow without limit. Blobs of
  // dropped versions are reclaimed by the scoped blob GC.
  return pruneVersionTree(next, DEFAULT_MAX_VERSIONS);
}

/**
 * Resolve the book's selected art style into a leading "style" reference image,
 * or null when it uses a custom style / none is configured. The exemplar steers
 * the rendering technique; the textual style description stays in the prompt as
 * a complement and as the fallback when no image is available.
 */
export async function loadStyleReference(
  env: PipelineEnv,
  config: Project["config"],
): Promise<ReferenceImage | null> {
  const presetId = config.artStyle?.presetId;
  if (!presetId) return null;
  const data = await env.loadStyleImage(presetId);
  if (!data) return null;
  return {
    base64: data.base64,
    mimeType: data.mimeType,
    role: "style",
    label: "art style reference",
  };
}

export { IntentAmbiguousError } from "./intentResolve";

/**
 * The physical side a content spread sits on (drives layout-aware, text-safe
 * composition in the prompt). A double-page spread is "spread"; a single page
 * is left/right by its page number (recto = odd = right). Returns undefined for
 * covers and synthesized spreads not present in the paginated doc, so they skip
 * the outer-edge text guidance.
 */
function resolvePageSide(project: Project, spread: ScreenplaySpread): PageSide | undefined {
  if (spread.kind === "spread") return "spread";
  const tree = project.screenplay;
  if (!tree) return undefined;
  try {
    const pages = paginate(getCursor(tree).content).pageMap.get(spread.id);
    if (!pages || pages.length === 0) return undefined;
    return pages[0] % 2 === 1 ? "right" : "left";
  } catch {
    return undefined;
  }
}

/**
 * Best-effort reference downscale through the env's optional hook. Returns the
 * original image when the host can't resize or the hook fails. Only ever used
 * for payload copies (model references / vision inputs) — never for images a
 * mask must align to or for compositing bases.
 */
export async function asRefPayload(
  env: PipelineEnv,
  image: { base64: string; mimeType: string },
): Promise<{ base64: string; mimeType: string }> {
  if (!env.downscaleRef) return image;
  try {
    return await env.downscaleRef(image);
  } catch {
    return image;
  }
}

/**
 * Mask each listed region, regenerate it as matching background (subject erased),
 * and composite back so pixels outside stay identical. Best-effort when
 * strict=false (skip failed regions); aborts on first failure when strict=true.
 */
/** Shared in-place region erasure used by page/anchor repair passes. */
export async function removeRegionsInPlace(args: {
  removals: { name: string; box: SubjectBox }[];
  page: { base64: string; mimeType: string };
  config: Project["config"];
  imageModel: ResolvedModels["imageModel"];
  imageKey: string;
  size: string;
  env: PipelineEnv;
  signal?: AbortSignal;
  step: string;
  strict?: boolean;
}): Promise<{ base64: string; mimeType: string } | null> {
  const { removals, page, config, imageModel, imageKey, size, env, signal, step, strict } = args;
  if (removals.length === 0) return null;
  const runStep = env.runStep ?? (<T>(_s: string, fn: () => Promise<T>) => fn());
  const isOpenAI = imageModel.provider === "openai";

  let current = page;
  let removed = 0;
  for (const r of removals) {
    try {
      const mask = await env.composite.buildHoleMask({
        pageBase64: current.base64,
        pageMime: current.mimeType,
        box: r.box,
        paddingFrac: 0.08,
      });
      const result = await runStep(step, () =>
        generateIllustrationImage({
          prompt: buildRemoveRegionPrompt({
            subjectName: r.name,
            config,
            maskMode: isOpenAI,
            prompts: env.prompts,
          }),
          size,
          creds: { apiKey: imageKey },
          model: imageModel.id,
          providerId: imageModel.provider,
          references: [
            { base64: current.base64, mimeType: current.mimeType, role: "composition" },
          ],
          mask: isOpenAI ? mask : undefined,
          // Small masked region, composited back — low quality is visually
          // equivalent here and roughly halves the per-edit latency.
          quality: "low",
          signal,
        }),
      );
      const composited = await env.composite.compositeMaskedRegion({
        originalBase64: current.base64,
        originalMime: current.mimeType,
        editedBase64: result.base64,
        editedMime: result.mimeType,
        maskBase64: mask.base64,
      });
      if (composited.base64) {
        current = { base64: composited.base64, mimeType: composited.mimeType };
        removed += 1;
      } else if (strict) return null;
    } catch {
      if (strict) return null;
    }
  }
  return removed > 0 ? current : strict ? null : page;
}

/**
 * Post-render binding + de-duplication pass for a page illustration.
 *
 * One vision call (admin-configurable `bindingPass` model, falling back to the
 * localize/text model) both:
 *   1. Binds each anchor that should appear on the page to its region — recorded
 *      as `depicted` on the version so later edits/removals don't have to
 *      re-derive the mapping by fuzzy text matching; and
 *   2. Detects DUPLICATES — a subject that must appear once but was drawn more
 *      than once (a common failure of cheaper image models, e.g. after an anchor
 *      change) — and removes each extra occurrence in place, filling the vacated
 *      area with matching background, so exactly one instance remains.
 *
 * Best-effort throughout: on any failure it returns the input image unchanged
 * (never blocks the render). Duplicate removal only spends image calls when a
 * duplicate is actually found. Repairs are metered under the "dedupe" step; the
 * binding vision call under "binding".
 *
 * Rectangle-composite repairs run ONLY on OpenAI, whose edits endpoint honors a
 * real inpainting mask. Gemini has no mask support — it regenerates the whole
 * frame, and compositing a rectangle from a misaligned regeneration produces
 * seams worse than the original flaw. On non-OpenAI providers this pass does
 * the (single, cheap) binding vision call and skips all repair image calls,
 * which also removes the main latency tail from "fast" generations.
 */
const MAX_DUPE_REPAIRS = 2;

async function bindAndRepairPage(args: {
  anchors: Anchor[];
  embeddedPairs?: { parent: Anchor; child: Anchor }[];
  image: { base64: string; mimeType: string };
  config: Project["config"];
  imageModel: ResolvedModels["imageModel"];
  imageKey: string;
  size: string;
  env: PipelineEnv;
  signal?: AbortSignal;
}): Promise<{ image: { base64: string; mimeType: string }; depicted: DepictedSubject[] }> {
  const { anchors, embeddedPairs = [], image, config, imageModel, imageKey, size, env, signal } =
    args;
  if (anchors.length === 0) return { image, depicted: [] };

  const model = env.models.bindingModel ?? env.models.textModel;
  let bindKey: string;
  try {
    bindKey = env.apiKeyFor(model.provider);
  } catch {
    return { image, depicted: [] };
  }
  const runStep = env.runStep ?? (<T>(_s: string, fn: () => Promise<T>) => fn());
  const canRepair = imageModel.provider === "openai";

  // Vision models only need to LOCATE subjects (normalized boxes), so a
  // downscaled copy keeps the payload small without affecting the result.
  const visionPage = await asRefPayload(env, image);
  const bindings = await runStep("binding", () =>
    locateAndCountSubjects({
      pageBase64: visionPage.base64,
      pageMime: visionPage.mimeType,
      subjects: anchors.map((a) => ({ id: a.id, name: a.name, description: a.description })),
      creds: { apiKey: bindKey },
      model: model.id,
      providerId: model.provider,
      prompts: env.prompts,
      signal,
    }),
  );

  const dupes: { name: string; box: SubjectBox }[] = [];
  for (const a of anchors) {
    const b = bindings.get(a.id);
    if (!b) continue;
    for (const box of b.extras) dupes.push({ name: a.name, box });
  }

  let current = image;
  if (dupes.length > 0 && canRepair) {
    const repaired = await removeRegionsInPlace({
      removals: dupes.slice(0, MAX_DUPE_REPAIRS),
      page: current,
      config,
      imageModel,
      imageKey,
      size,
      env,
      signal,
      step: "dedupe",
      strict: false,
    });
    if (repaired) current = repaired;
  }

  // Embedded-anchor de-dup: when a child anchor is also on the page inside its
  // parent place/object, erase generic default instances (e.g. a default bed
  // when a specific bed anchor is present). Repair-capable providers only —
  // the detection vision calls are skipped too when we can't act on them.
  if (embeddedPairs.length > 0 && canRepair) {
    const byParent = new Map<string, { parent: Anchor; children: Anchor[] }>();
    for (const { parent, child } of embeddedPairs) {
      const g = byParent.get(parent.id) ?? { parent, children: [] };
      g.children.push(child);
      byParent.set(parent.id, g);
    }
    const embeddedObsolete: { name: string; box: SubjectBox }[] = [];
    const embeddedPrimary = new Map<string, SubjectBox>();
    const visionCurrent = await asRefPayload(env, current);
    for (const { parent, children } of byParent.values()) {
      const found = await runStep("embedded", () =>
        locateEmbeddedObsolete({
          pageBase64: visionCurrent.base64,
          pageMime: visionCurrent.mimeType,
          parent: { name: parent.name, description: parent.description },
          children: children.map((c) => ({ id: c.id, name: c.name, description: c.description })),
          mode: "scene",
          creds: { apiKey: bindKey },
          model: model.id,
          providerId: model.provider,
          prompts: env.prompts,
          signal,
        }),
      );
      for (const child of children) {
        const b = found.get(child.id);
        if (!b) continue;
        embeddedPrimary.set(child.id, b.primary);
        for (const box of b.obsolete) embeddedObsolete.push({ name: child.name, box });
      }
    }
    if (embeddedObsolete.length > 0) {
      const repaired = await removeRegionsInPlace({
        removals: embeddedObsolete,
        page: current,
        config,
        imageModel,
        imageKey,
        size,
        env,
        signal,
        step: "embedded",
        strict: false,
      });
      if (repaired) current = repaired;
    }
    // Prefer embedded-primary boxes for child anchors when available.
    for (const [childId, box] of embeddedPrimary) {
      const idx = bindings.get(childId);
      if (idx) idx.box = box;
      else {
        const child = anchors.find((a) => a.id === childId);
        if (child) bindings.set(childId, { box, extras: [] });
      }
    }
  }

  const depicted: DepictedSubject[] = [];
  for (const a of anchors) {
    const b = bindings.get(a.id);
    if (b) depicted.push({ anchorId: a.id, box: b.box, brief: a.description, confidence: 1 });
  }
  return { image: current, depicted };
}

/**
 * Remove one or more subjects from an existing page IN PLACE, using the regions
 * recorded for them in the previous version's binding pass. Each region is
 * masked, regenerated as matching background (the subject erased), and
 * composited back so every pixel outside the removed regions stays identical.
 * Used for the system "toggle off anchors" intent, which is a pure removal.
 *
 * Returns the updated image, or null when the regions aren't known or every
 * removal failed — the caller then falls back to a whole-page regeneration that
 * drops the subjects via the prompt.
 */
async function trySurgicalRemoval(args: {
  config: Project["config"];
  removals: { name: string; box: SubjectBox }[];
  page: { base64: string; mimeType: string };
  imageModel: ResolvedModels["imageModel"];
  imageKey: string;
  size: string;
  env: PipelineEnv;
  signal?: AbortSignal;
}): Promise<{ base64: string; mimeType: string } | null> {
  return removeRegionsInPlace({
    removals: args.removals,
    page: args.page,
    config: args.config,
    imageModel: args.imageModel,
    imageKey: args.imageKey,
    size: args.size,
    env: args.env,
    signal: args.signal,
    step: "removal",
    strict: true,
  });
}

/**
 * Replace one subject region with another anchor's reference design in place.
 */
async function trySurgicalReplaceOne(args: {
  config: Project["config"];
  targetBox: SubjectBox;
  sourceAnchor: Anchor;
  sourceRef: { base64: string; mimeType: string };
  page: { base64: string; mimeType: string };
  imageModel: ResolvedModels["imageModel"];
  imageKey: string;
  size: string;
  env: PipelineEnv;
  signal?: AbortSignal;
}): Promise<{ base64: string; mimeType: string } | null> {
  const { config, targetBox, sourceAnchor, sourceRef, page, imageModel, imageKey, size, env, signal } =
    args;
  const runStep = env.runStep ?? (<T>(_s: string, fn: () => Promise<T>) => fn());
  const isOpenAI = imageModel.provider === "openai";
  try {
    const mask = await env.composite.buildHoleMask({
      pageBase64: page.base64,
      pageMime: page.mimeType,
      box: targetBox,
      paddingFrac: 0.12,
    });
    const result = await runStep("subjectEdit", () =>
      generateIllustrationImage({
        prompt: buildAnchorSwapPrompt({
          anchor: sourceAnchor,
          config,
          maskMode: isOpenAI,
          prompts: env.prompts,
        }),
        size,
        creds: { apiKey: imageKey },
        model: imageModel.id,
        providerId: imageModel.provider,
        references: [
          { base64: page.base64, mimeType: page.mimeType, role: "composition" },
          { base64: sourceRef.base64, mimeType: sourceRef.mimeType, role: "subject", label: sourceAnchor.name },
        ],
        mask: isOpenAI ? mask : undefined,
        // Small masked region, composited back — low quality suffices.
        quality: "low",
        signal,
      }),
    );
    const composited = await env.composite.compositeMaskedRegion({
      originalBase64: page.base64,
      originalMime: page.mimeType,
      editedBase64: result.base64,
      editedMime: result.mimeType,
      maskBase64: mask.base64,
    });
    return composited.base64 ? { base64: composited.base64, mimeType: composited.mimeType } : null;
  } catch {
    return null;
  }
}

/**
 * Modify ONE attribute of a subject in place ("make Arthur's hair blue"): mask
 * the subject's recorded region, regenerate only that region with the change
 * applied (the subject's sheet attached for identity), composite back.
 */
async function trySurgicalModifyOne(args: {
  config: Project["config"];
  targetAnchor: Anchor;
  instruction: string;
  targetBox: SubjectBox;
  /** The subject's reference sheet (identity guard); optional. */
  sheetRef: { base64: string; mimeType: string } | null;
  page: { base64: string; mimeType: string };
  imageModel: ResolvedModels["imageModel"];
  imageKey: string;
  size: string;
  env: PipelineEnv;
  signal?: AbortSignal;
}): Promise<{ base64: string; mimeType: string } | null> {
  const { config, targetAnchor, instruction, targetBox, sheetRef, page, imageModel, imageKey, size, env, signal } =
    args;
  const runStep = env.runStep ?? (<T>(_s: string, fn: () => Promise<T>) => fn());
  const isOpenAI = imageModel.provider === "openai";
  try {
    const mask = await env.composite.buildHoleMask({
      pageBase64: page.base64,
      pageMime: page.mimeType,
      box: targetBox,
      paddingFrac: 0.12,
    });
    const references: ReferenceImage[] = [
      { base64: page.base64, mimeType: page.mimeType, role: "composition" },
      ...(sheetRef
        ? [{
            base64: sheetRef.base64,
            mimeType: sheetRef.mimeType,
            role: "subject" as const,
            label: targetAnchor.name,
          }]
        : []),
    ];
    const result = await runStep("subjectEdit", () =>
      generateIllustrationImage({
        prompt: buildModifySubjectPrompt({
          anchor: targetAnchor,
          instruction,
          config,
          maskMode: isOpenAI,
          hasSheetRef: Boolean(sheetRef),
          prompts: env.prompts,
        }),
        size,
        creds: { apiKey: imageKey },
        model: imageModel.id,
        providerId: imageModel.provider,
        references,
        mask: isOpenAI ? mask : undefined,
        // Small masked region, composited back — low quality suffices.
        quality: "low",
        signal,
      }),
    );
    const composited = await env.composite.compositeMaskedRegion({
      originalBase64: page.base64,
      originalMime: page.mimeType,
      editedBase64: result.base64,
      editedMime: result.mimeType,
      maskBase64: mask.base64,
    });
    return composited.base64 ? { base64: composited.base64, mimeType: composited.mimeType } : null;
  } catch {
    return null;
  }
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
  const runStep = env.runStep ?? (<T>(_s: string, fn: () => Promise<T>) => fn());

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
  const boxes = await runStep("localize", () =>
    locateSubjects({
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
      prompts: env.prompts,
      signal,
    }),
  );

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
      const result = await runStep("subjectEdit", () =>
        generateIllustrationImage({
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
          // Small masked region, composited back — low quality suffices.
          quality: "low",
          signal,
        }),
      );
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
 * Execute a user edit via structured intent resolution + surgical ops. Uses the
 * previous version's binding layer to locate targets by anchor id. Throws
 * {@link IntentAmbiguousError} when the resolver can't pick a unique target.
 * Returns null to fall back to prompt-based whole-page regeneration.
 */
async function tryStructuredEdit(args: {
  project: Project;
  spread: ScreenplaySpread;
  options: IllustrationRunOptions;
  env: PipelineEnv;
  anchors: Anchor[];
  effectiveIds: string[];
  byId: Map<string, Anchor>;
  compositionData: { base64: string; mimeType: string };
  prevDepicted: DepictedSubject[];
  embeddedPairs: { parent: Anchor; child: Anchor }[];
  /** Pre-resolved intent ops (resolution runs once, in renderIllustration). */
  ops: ResolvedEditOp[];
  sourceNodeId?: string;
  imageModel: ResolvedModels["imageModel"];
  imageKey: string;
  signal?: AbortSignal;
}): Promise<IllustrationRender | null> {
  const {
    project,
    spread,
    options,
    env,
    anchors,
    effectiveIds,
    byId,
    compositionData,
    prevDepicted,
    embeddedPairs,
    ops,
    sourceNodeId,
    imageModel,
    imageKey,
    signal,
  } = args;
  const edit = options.edit?.trim();
  if (!edit || !isFullyStructured(ops)) return null;

  const size = chooseImageSize(spread.kind, project.config);

  let current = compositionData;
  const depictedByAnchor = new Map(
    prevDepicted.filter((d) => d.anchorId).map((d) => [d.anchorId!, d]),
  );
  const opLabels: string[] = [];

  for (const op of ops) {
    if (op.op === "remove" && op.targetAnchorId) {
      const a = byId.get(op.targetAnchorId);
      const d = depictedByAnchor.get(op.targetAnchorId);
      if (!a || !d) return null;
      const removed = await trySurgicalRemoval({
        config: project.config,
        removals: [{ name: a.name, box: d.box }],
        page: current,
        imageModel,
        imageKey,
        size,
        env,
        signal,
      });
      if (!removed) return null;
      current = removed;
      depictedByAnchor.delete(op.targetAnchorId);
      opLabels.push(`removed ${a.name}`);
    } else if (op.op === "refresh" && op.targetAnchorId) {
      const a = byId.get(op.targetAnchorId);
      if (!a) return null;
      const updated = await trySurgicalAnchorUpdate({
        config: project.config,
        refreshAnchors: [a],
        page: current,
        imageModel,
        imageKey,
        size,
        env,
        signal,
      });
      if (!updated) return null;
      current = { base64: updated.base64, mimeType: updated.mimeType };
      opLabels.push(`updated ${a.name}`);
    } else if (op.op === "replace" && op.targetAnchorId && op.sourceAnchorId) {
      const target = byId.get(op.targetAnchorId);
      const source = byId.get(op.sourceAnchorId);
      const d = depictedByAnchor.get(op.targetAnchorId);
      const sourceImg = source ? currentAnchorImage(source) : null;
      const sourceRef = sourceImg ? await env.loadBlob(sourceImg.blobId) : null;
      if (!target || !source || !d || !sourceRef) return null;
      const replaced = await trySurgicalReplaceOne({
        config: project.config,
        targetBox: d.box,
        sourceAnchor: source,
        sourceRef,
        page: current,
        imageModel,
        imageKey,
        size,
        env,
        signal,
      });
      if (!replaced) return null;
      current = replaced;
      opLabels.push(`replaced ${target.name} with ${source.name}`);
    } else if (op.op === "modify" && op.targetAnchorId) {
      const a = byId.get(op.targetAnchorId);
      const d = depictedByAnchor.get(op.targetAnchorId);
      if (!a || !d) return null;
      // Sheet along for identity (best-effort: a missing sheet doesn't block).
      const img = currentAnchorImage(a);
      const raw = img ? await env.loadBlob(img.blobId) : null;
      const sheetRef = raw ? await asRefPayload(env, raw) : null;
      const instruction = op.instruction?.trim() || edit;
      const modified = await trySurgicalModifyOne({
        config: project.config,
        targetAnchor: a,
        instruction,
        targetBox: d.box,
        sheetRef,
        page: current,
        imageModel,
        imageKey,
        size,
        env,
        signal,
      });
      if (!modified) return null;
      current = modified;
      opLabels.push(instruction);
    }
  }

  const { image: bound, depicted } = await bindAndRepairPage({
    anchors,
    embeddedPairs,
    image: current,
    config: project.config,
    imageModel,
    imageKey,
    size,
    env,
    signal,
  });
  const blobId = await env.saveImage(bound.base64, bound.mimeType);
  const prompt =
    opLabels.length > 0
      ? `${opLabels.join("; ")} (structured in-place edit).`
      : `${edit} (structured in-place edit).`;
  return {
    blobId,
    mimeType: bound.mimeType,
    references: currentReferenceUses(project.anchors, effectiveIds),
    prompt,
    label: "Edit",
    textMode: spread.textMode,
    depicted,
    parentId: sourceNodeId,
  };
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
  // In-place rectangle surgery needs a real inpainting mask, which only the
  // OpenAI edits endpoint supports. On other providers (Gemini regenerates the
  // whole frame, so composited rectangles misalign) every surgical path falls
  // through to a whole-page, composition-preserving regeneration.
  const surgicalCapable = imageModel.provider === "openai";

  // Resolve the spread's anchors in their declared order, so reference images
  // line up with how they're enumerated in the prompt.
  const byId = new Map((project.anchors ?? []).map((a) => [a.id, a]));
  // Heal any drifted ids by name before resolving, so references aren't dropped.
  const effectiveIds = effectiveAnchorIds(project.anchors, spread);
  const anchors = effectiveIds
    .map((id) => byId.get(id))
    .filter((a): a is Anchor => Boolean(a));
  const embeddedPairs = embeddedPairsAmong(project.anchors ?? [], effectiveIds);

  // For inpainting, the mask must align to the FIRST reference image, so we
  // send only the page image (no anchor references) and rely on prompt-locking.
  const inpaint = Boolean(options.mask);

  // A mask implies inpainting the current page, so we always need its image as
  // the final (here, only) composition reference.
  const wantCompositionRef = options.useReference || inpaint;

  // Load the previous illustration FIRST: its recorded provenance decides which
  // subjects actually changed, which in turn decides which reference sheets are
  // worth sending at all (see the reference assembly below).
  const tree = project.illustrations?.[spread.id];
  const sourceNodeId = options.fromNodeId ?? tree?.cursorId;
  let hasCompositionRef = false;
  let compositionData: { base64: string; mimeType: string } | null = null;
  // The (possibly downscaled) copy sent to the model as the composition ref;
  // appended LAST to the references array after the anchor sheets below.
  let compositionRefPayload: { base64: string; mimeType: string } | null = null;
  let removedAnchors: Anchor[] = [];
  let refreshAnchors: Anchor[] = [];
  let addedAnchors: Anchor[] = [];
  // Every subject whose DESIGN changed since the previous version (superset of
  // refreshAnchors, which additionally excludes subjects the edit text names).
  const changedDesignIds = new Set<string>();
  // Recorded reference uses of the previous version (for honest provenance when
  // only some subjects get updated).
  let prevById = new Map<string, ReferenceUse>();
  // Where each subject was drawn in the previous version (binding pass output),
  // so removals can be done surgically in place instead of a whole-page regen.
  let prevDepicted: DepictedSubject[] = [];
  // Whether the page's subject SET changed (added/removed anchors) since the
  // previous version — surgical in-place updates can't add or remove subjects,
  // so we defer to the whole-page path in that case.
  let structuralChange = false;
  const anchorsWithImage = anchors.filter((a) => Boolean(currentAnchorImage(a)));
  if (wantCompositionRef && tree && sourceNodeId) {
    const src = tree.nodes[sourceNodeId];
    if (src) {
      const data = await env.loadBlob(src.content.blobId);
      if (data) {
        // The model reference can be a downscaled copy, EXCEPT when inpainting:
        // the mask must align pixel-for-pixel to this (first) image. The
        // full-res original is kept separately as the compositing base.
        compositionRefPayload = inpaint ? data : await asRefPayload(env, data);
        compositionData = data;
        hasCompositionRef = true;
        // Subjects present in the previous version but no longer active on this
        // spread must be explicitly removed (they linger in the composition ref).
        const prevRefs = src.content.references ?? [];
        prevById = new Map(prevRefs.map((r) => [r.anchorId, r]));
        prevDepicted = src.content.depicted ?? [];
        removedAnchors = prevRefs
          .map((r) => r.anchorId)
          .filter((id) => !effectiveIds.includes(id))
          .map((id) => byId.get(id))
          .filter((a): a is Anchor => Boolean(a));
        addedAnchors = effectiveIds
          .filter((id) => !prevById.has(id))
          .map((id) => byId.get(id))
          .filter((a): a is Anchor => Boolean(a));
        structuralChange = removedAnchors.length > 0 || addedAnchors.length > 0;
        // Subjects still on the page whose design changed since this version was
        // generated (different image version or edited text). refreshAnchors is
        // derived AFTER intent resolution below, so edit-targeted subjects can
        // be excluded by resolved id instead of fragile substring matching.
        for (const a of anchorsWithImage) {
          const prev = prevById.get(a.id);
          if (!prev) continue; // newly added subject, not a "refresh"
          const versionChanged = (a.versions?.cursorId ?? undefined) !== prev.versionId;
          const textChanged =
            prev.signature !== undefined && prev.signature !== anchorSignature(a);
          if (versionChanged || textChanged) changedDesignIds.add(a.id);
        }
      }
    }
  }

  // ---- Edit-intent resolution (BOTH tiers) ---------------------------------
  // One cheap structured text call identifies WHO the edit refers to — by
  // canonical anchor id, robust to nicknames, pronouns and typos. Its output
  // drives (1) which reference sheets are sent, (2) which subjects the "keep
  // unchanged" clause may lock, (3) a canonical rewrite of the edit for the
  // whole-page prompt, and (4) surgical execution on capable providers.
  // Best-effort: on failure everything falls back to substring heuristics.
  const editText = options.edit?.trim();
  let editOps: ResolvedEditOp[] | null = null;
  if (editText && hasCompositionRef && !inpaint) {
    const intentModel = env.models.intentModel ?? env.models.textModel;
    try {
      const intentKey = env.apiKeyFor(intentModel.provider);
      const runIntent = env.runStep ?? (<T>(_s: string, fn: () => Promise<T>) => fn());
      editOps = await runIntent("intent", () =>
        resolveEditIntent({
          userEdit: editText,
          anchors: project.anchors ?? [],
          depicted: prevDepicted,
          pageAnchors: anchors,
          disambiguateTargetId: options.intentTargetAnchorId,
          creds: { apiKey: intentKey },
          model: intentModel.id,
          providerId: intentModel.provider,
          prompts: env.prompts,
          signal: options.signal,
        }),
      );
    } catch (e) {
      if (e instanceof IntentAmbiguousError) throw e;
      // Degrading is intentional (substring heuristics still work), but never
      // silent: a persistent resolver failure (bad model id, quota) would
      // otherwise quietly worsen every edit with no trace to debug from.
      console.warn(
        "[illustration] edit-intent resolution failed; falling back to substring heuristics:",
        e instanceof Error ? e.message : e,
      );
      editOps = null;
    }
  }
  const editMentions = editOps ? mentionedAnchorIds(editOps) : null;
  const editFullyStructured = editOps ? isFullyStructured(editOps) : false;
  /** Does the edit target/mention this anchor? Resolver id match when
   *  available; substring fallback otherwise (or when a freeform op may hide
   *  an unresolved mention). */
  const editRefersTo = (a: Anchor): boolean => {
    if (!editText) return false;
    if (editMentions?.has(a.id)) return true;
    if (editOps && editFullyStructured) return false; // resolver is authoritative
    return editText.toLowerCase().includes(a.name.toLowerCase());
  };

  // With an edit, changed-design subjects the edit itself targets are NOT
  // auto-refreshed (the edit decides what happens to them).
  refreshAnchors = anchorsWithImage.filter(
    (a) => changedDesignIds.has(a.id) && !editRefersTo(a),
  );

  // Canonical rewrite: when every op resolved cleanly, the whole-page prompt
  // gets a deterministic instruction with proper anchor names — typos and
  // pronouns from the user's text never reach the image model.
  const canonicalEdit = editOps ? canonicalEditText(editOps, project.anchors ?? []) : null;
  const promptEdit = canonicalEdit ?? options.edit;

  // Anchor reference images for consistency (in order); anchors without a
  // generated image are described in the prompt instead. On a composition-
  // preserving regeneration only CHANGED, ADDED, or edit-named subjects get
  // their sheet sent — unchanged subjects are already correct in the
  // composition reference, and re-sending their sheets bloats the payload and
  // invites the model to redraw them. They're locked via a "keep" prompt
  // clause instead (keptAnchors).
  const references: ReferenceImage[] = [];
  const referencedAnchors: Anchor[] = [];
  const describedAnchors: Anchor[] = [];
  const keptAnchors: Anchor[] = [];
  // Lead with the art-style exemplar (when configured) so it applies to the
  // whole page. Skipped for inpainting: the mask aligns to the FIRST reference
  // image, so that slot must stay the page being edited.
  let hasStyleRef = false;
  if (!inpaint) {
    const needsSheet = (a: Anchor): boolean => {
      if (!hasCompositionRef) return true; // fresh render: send everything
      if (changedDesignIds.has(a.id)) return true;
      if (!prevById.has(a.id)) return true; // newly added subject
      // The edit targets this subject — its sheet keeps it on-model, and it
      // must NOT land in the "keep unchanged" clause (which would contradict
      // the edit instruction).
      return editRefersTo(a);
    };
    const sheetAnchors: Anchor[] = [];
    for (const a of anchors) {
      if (!currentAnchorImage(a)) describedAnchors.push(a);
      else if (needsSheet(a)) sheetAnchors.push(a);
      else keptAnchors.push(a);
    }
    // Load the style exemplar and the needed anchor blobs in parallel (order is
    // restored below so references still line up with the prompt legend).
    const [styleRef, anchorData] = await Promise.all([
      loadStyleReference(env, project.config),
      Promise.all(
        sheetAnchors.map(async (a) => {
          const img = currentAnchorImage(a);
          const raw = img ? await env.loadBlob(img.blobId) : null;
          // Reference-only payload: downscale so 4-6 full-res sheets don't
          // balloon the request into provider-stalling territory.
          return raw ? await asRefPayload(env, raw) : null;
        }),
      ),
    ]);
    if (styleRef) {
      references.push(styleRef);
      hasStyleRef = true;
    }
    sheetAnchors.forEach((a, i) => {
      const data = anchorData[i];
      if (data) {
        references.push({
          base64: data.base64,
          mimeType: data.mimeType,
          label: `${a.name} (${a.description})`,
          role: "subject",
        });
        referencedAnchors.push(a);
      } else {
        // Sheet expected but the blob is missing — describe it instead.
        describedAnchors.push(a);
      }
    });
  }

  // Append the previous illustration as the FINAL composition reference (or,
  // for inpainting, the only reference — the mask aligns to it).
  if (compositionRefPayload) {
    references.push({
      base64: compositionRefPayload.base64,
      mimeType: compositionRefPayload.mimeType,
      role: "composition",
    });
  }

  const maskMode = Boolean(options.mask && hasCompositionRef);

  // Pure removal (system "toggle off anchors" intent): the only change is that
  // subjects were dropped, and we know where they sat from the previous
  // version's binding pass. Erase them in place and keep the rest identical —
  // far more reliable than asking a whole-page regen to omit them. Requires the
  // recorded region for EVERY removed subject; otherwise fall through.
  const removalBoxes = removedAnchors
    .map((a) => {
      const d = prevDepicted.find((p) => p.anchorId === a.id);
      return d ? { name: a.name, box: d.box } : null;
    })
    .filter((r): r is { name: string; box: SubjectBox } => Boolean(r));
  const isSurgicalRemoval =
    surgicalCapable &&
    Boolean(options.useReference) &&
    !options.mask &&
    !options.edit?.trim() &&
    hasCompositionRef &&
    Boolean(compositionData) &&
    removedAnchors.length > 0 &&
    addedAnchors.length === 0 &&
    refreshAnchors.length === 0 &&
    removalBoxes.length === removedAnchors.length;
  if (isSurgicalRemoval && compositionData) {
    const removedImg = await trySurgicalRemoval({
      config: project.config,
      removals: removalBoxes,
      page: compositionData,
      imageModel,
      imageKey: key,
      size: chooseImageSize(spread.kind, project.config),
      env,
      signal: options.signal,
    });
    if (removedImg) {
      const removedNames = removedAnchors.map((a) => a.name).join(", ");
      const { image: bound, depicted } = await bindAndRepairPage({
        anchors,
        embeddedPairs,
        image: removedImg,
        config: project.config,
        imageModel,
        imageKey: key,
        size: chooseImageSize(spread.kind, project.config),
        env,
        signal: options.signal,
      });
      const blobId = await env.saveImage(bound.base64, bound.mimeType);
      return {
        blobId,
        mimeType: bound.mimeType,
        references: currentReferenceUses(project.anchors, effectiveIds),
        prompt: `Removed ${removedNames} in-place (rest of page unchanged).`,
        label: "Update",
        textMode: spread.textMode,
        depicted,
        parentId: sourceNodeId,
      };
    }
  }

  // Plain "update this page" (refresh changed subjects, no manual mask, no text
  // edit): update each changed subject in place via an auto-located masked edit
  // so the rest of the page stays pixel-identical. Falls back to the whole-page
  // regeneration below if localization or any model call fails.
  const isPlainRefresh =
    surgicalCapable &&
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
      const { image: bound, depicted } = await bindAndRepairPage({
        anchors,
        embeddedPairs,
        image: { base64: surgical.base64, mimeType: surgical.mimeType },
        config: project.config,
        imageModel,
        imageKey: key,
        size: chooseImageSize(spread.kind, project.config),
        env,
        signal: options.signal,
      });
      const blobId = await env.saveImage(bound.base64, bound.mimeType);
      return {
        blobId,
        mimeType: bound.mimeType,
        references: refUses,
        prompt: updatePrompt,
        label: "Update",
        textMode: spread.textMode,
        depicted,
        parentId: sourceNodeId,
      };
    }
  }

  // Custom user edit: when every op resolved cleanly and the previous version
  // has binding data, execute surgically in place. Falls back to prompt-based
  // regen (with the canonical rewrite) on failure.
  if (
    surgicalCapable &&
    editText &&
    editOps &&
    editFullyStructured &&
    options.useReference &&
    !options.mask &&
    hasCompositionRef &&
    compositionData &&
    prevDepicted.length > 0
  ) {
    const structured = await tryStructuredEdit({
      project,
      spread,
      options,
      env,
      anchors,
      effectiveIds,
      byId,
      compositionData,
      prevDepicted,
      embeddedPairs,
      ops: editOps,
      sourceNodeId,
      imageModel,
      imageKey: key,
      signal: options.signal,
    });
    if (structured) return structured;
  }

  const prompt = buildIllustrationPrompt({
    spread,
    config: project.config,
    referencedAnchors,
    refreshAnchors,
    // Only meaningful on composition-preserving regens (the base image lacks
    // them); a fresh render already features every active subject.
    addedAnchors: hasCompositionRef ? addedAnchors : [],
    keptAnchors,
    embeddedPairs,
    describedAnchors,
    removedAnchors,
    hasStyleRef,
    hasCompositionRef,
    maskMode,
    // Cover-only: bake the title/subtitle/author typography into the artwork.
    bakeText: spread.bakeText,
    coverTitle: spread.coverTitle,
    coverSubtitle: spread.coverSubtitle,
    coverAuthor: spread.coverAuthor,
    isCover: isCoverSpread(spread),
    // Canonical rewrite when intent resolved cleanly (proper anchor names,
    // typos corrected); the user's raw text otherwise.
    edit: promptEdit,
    prompts: env.prompts,
    // Keep a calm, text-safe band on this page's outer edge (active layout).
    pageSide: resolvePageSide(project, spread),
  });

  const runStep = env.runStep ?? (<T>(_s: string, fn: () => Promise<T>) => fn());
  const result = await runStep("image", () =>
    generateIllustrationImage({
      prompt,
      size: chooseImageSize(spread.kind, project.config),
      creds: { apiKey: key },
      model: imageModel.id,
      providerId: imageModel.provider,
      references: references.length ? references : undefined,
      mask: maskMode ? options.mask : undefined,
      signal: options.signal,
    }),
  );

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

  // Version label shows the canonical form so the user can see how their edit
  // was understood (e.g. "make Arthur's hair blue" for "make athrurs hair blue").
  const label = promptEdit?.trim() || (tree ? "Variation" : "Initial");
  const { image: bound, depicted } = await bindAndRepairPage({
    anchors,
    embeddedPairs,
    image: { base64: finalBase64, mimeType: finalMime },
    config: project.config,
    imageModel,
    imageKey: key,
    size: chooseImageSize(spread.kind, project.config),
    env,
    signal: options.signal,
  });
  const blobId = await env.saveImage(bound.base64, bound.mimeType);
  return {
    blobId,
    mimeType: bound.mimeType,
    references: currentReferenceUses(project.anchors, effectiveIds),
    prompt,
    label,
    textMode: spread.textMode,
    depicted,
    parentId: sourceNodeId,
  };
}

/** Inputs for a single wrap-cover generation (front + back as one artwork). */
export interface CoverWrapInput {
  /** Front-cover art brief (renders into the RIGHT half). */
  frontIllustration: string;
  /** Back-cover art brief (renders into the LEFT half). */
  backIllustration: string;
  /** Union of the anchors both covers should feature (for consistency). */
  anchorIds?: string[];
  anchorNames?: string[];
  /** Bake the title/subtitle/author typography into the front (right) half. */
  bakeText?: boolean;
  coverTitle?: string;
  coverSubtitle?: string;
  coverAuthor?: string;
}

/** The raw (unsaved) product of one wrap-cover render, for the host to split. */
export interface CoverWrapImage {
  base64: string;
  mimeType: string;
  prompt: string;
  references: ReferenceUse[];
}

/**
 * Render a single continuous "wrap" cover — the back cover on the LEFT, the
 * front cover on the RIGHT, painted as one seamless wide scene — so the two
 * covers are guaranteed to match. The host then slices it in half to get the
 * two panels (see `splitWrapCover`), which both keeps costs to ONE generation
 * and gives real visual continuity instead of two separately-prompted images.
 *
 * Returns the raw image bytes (NOT saved) plus provenance, because the split +
 * per-panel upscale + blob persistence happen on the host where an image
 * library is available.
 */
export async function renderCoverWrapImage(
  project: Project,
  input: CoverWrapInput,
  env: PipelineEnv,
  signal?: AbortSignal,
): Promise<CoverWrapImage> {
  const bake = Boolean(input.bakeText && (input.coverTitle ?? "").trim());
  const wrapBrief = [
    "This is ONE continuous WRAP-AROUND cover for a printed book: the LEFT half is the BACK cover and the RIGHT half is the FRONT cover, painted as a single seamless scene that flows across the full width. Do NOT draw a seam, divider, fold or border down the centre.",
    input.frontIllustration.trim() ? `FRONT cover (RIGHT half): ${input.frontIllustration.trim()}` : "",
    input.backIllustration.trim() ? `BACK cover (LEFT half): ${input.backIllustration.trim()}` : "",
    "Place the main character(s) and the focal point in the RIGHT half (front cover). Let the LEFT half (back cover) continue the SAME setting, sky, colour palette, lighting and art style more calmly, leaving room for a short blurb. Keep the lower-LEFT corner calm and simple — plain, uncluttered background with no objects, symbols or graphics there.",
    bake ? "Render the title text ONLY in the RIGHT half (front cover); do not place any title on the left (back) half." : "",
  ]
    .filter(Boolean)
    .join(" ");

  const spread: ScreenplaySpread = {
    id: "cover-wrap",
    kind: "spread",
    text: "",
    illustration: wrapBrief,
    layoutNote: "",
    anchorIds: input.anchorIds ?? [],
    anchorNames: input.anchorNames,
    textMode: bake ? "in-image" : "overlay",
    ...(bake
      ? {
          bakeText: true,
          coverTitle: input.coverTitle,
          coverSubtitle: input.coverSubtitle,
          coverAuthor: input.coverAuthor,
        }
      : {}),
  };

  const byId = new Map((project.anchors ?? []).map((a) => [a.id, a]));
  const effectiveIds = effectiveAnchorIds(project.anchors, spread);
  const anchors = effectiveIds
    .map((id) => byId.get(id))
    .filter((a): a is Anchor => Boolean(a));

  const references: ReferenceImage[] = [];
  const referencedAnchors: Anchor[] = [];
  const describedAnchors: Anchor[] = [];
  const [styleRef, anchorData] = await Promise.all([
    loadStyleReference(env, project.config),
    Promise.all(
      anchors.map(async (a) => {
        const img = currentAnchorImage(a);
        const raw = img ? await env.loadBlob(img.blobId) : null;
        return raw ? await asRefPayload(env, raw) : null;
      }),
    ),
  ]);
  let hasStyleRef = false;
  if (styleRef) {
    references.push(styleRef);
    hasStyleRef = true;
  }
  anchors.forEach((a, i) => {
    if (!currentAnchorImage(a)) {
      describedAnchors.push(a);
      return;
    }
    const data = anchorData[i];
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
  });

  const prompt = buildIllustrationPrompt({
    spread,
    config: project.config,
    referencedAnchors,
    describedAnchors,
    hasStyleRef,
    hasCompositionRef: false,
    maskMode: false,
    bakeText: spread.bakeText,
    coverTitle: spread.coverTitle,
    coverSubtitle: spread.coverSubtitle,
    coverAuthor: spread.coverAuthor,
    isCover: true,
    prompts: env.prompts,
  });

  const imageModel = env.models.imageModel;
  const key = env.apiKeyFor(imageModel.provider);
  const runStep = env.runStep ?? (<T>(_s: string, fn: () => Promise<T>) => fn());
  const result = await runStep("image", () =>
    generateIllustrationImage({
      prompt,
      size: chooseImageSize("spread", project.config),
      creds: { apiKey: key },
      model: imageModel.id,
      providerId: imageModel.provider,
      references: references.length ? references : undefined,
      signal,
    }),
  );

  return {
    base64: result.base64,
    mimeType: result.mimeType,
    prompt,
    references: currentReferenceUses(project.anchors, effectiveIds),
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
