/**
 * Platform-agnostic anchor (character / place / object) image orchestration.
 *
 * Resolves the anchor's explicit relations into reference images, builds the
 * prompt, renders the reference sheet, and stores the blob — returning an
 * {@link AnchorRender} for the caller to fold into the anchor's version tree.
 * Side effects are injected via {@link PipelineEnv}, so the same logic runs on
 * the client and in the backend worker.
 */
import type { ReferenceImage } from "../providers/types";
import type { Anchor, AnchorImage, Project, ReferenceUse } from "../types";
import {
  addVersion,
  createVersionTree,
  DEFAULT_MAX_VERSIONS,
  pruneVersionTree,
  type VersionTree,
} from "../versioning";
import { buildAnchorPrompt, generateAnchorImage } from "./anchors";
import {
  containedAnchorsFor,
  linkedAnchorsFor,
  relatedAnchorsFor,
  relationSentence,
} from "../book/anchorGraph";
import { anchorSignature, currentAnchorImage } from "./provenance";
import {
  asRefPayload,
  loadStyleReference,
  removeRegionsInPlace,
  type PipelineEnv,
} from "./illustrationRun";
import { resolveMentionedAnchors } from "./intentResolve";
import { locateEmbeddedObsolete, type SubjectBox } from "./localize";

export interface AnchorRunOptions {
  /** Extra revision instruction, e.g. "make her smile". */
  edit?: string;
  /** Branch from this existing version (defaults to the current cursor). */
  fromNodeId?: string;
  /** Use the source version's image as a reference for consistency. */
  useReference?: boolean;
  signal?: AbortSignal;
}

/** The product of rendering one anchor image (see {@link IllustrationRender}). */
export interface AnchorRender {
  blobId: string;
  mimeType: string;
  references: ReferenceUse[];
  prompt: string;
  label: string;
  parentId?: string;
}

/** Wrap an anchor render into a (new or extended) version tree. Pure. */
export function applyAnchorRender(
  tree: VersionTree<AnchorImage> | undefined,
  render: AnchorRender,
): VersionTree<AnchorImage> {
  const content: AnchorImage = {
    blobId: render.blobId,
    mimeType: render.mimeType,
    references: render.references,
  };
  const next = tree
    ? addVersion(tree, content, {
        parentId: render.parentId,
        prompt: render.prompt,
        label: render.label,
      })
    : createVersionTree(content, { prompt: render.prompt, label: render.label });
  return pruneVersionTree(next, DEFAULT_MAX_VERSIONS);
}

/**
 * Render (or iterate on) an anchor's reference image. Returns the render for the
 * caller to persist into the anchor's version tree.
 */
export async function renderAnchor(
  project: Project,
  anchor: Anchor,
  options: AnchorRunOptions,
  env: PipelineEnv,
): Promise<AnchorRender> {
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

  // Resolve each related pair into a full, side-independent sentence ("Dad has
  // lighter hair than Mom") so the prompt reads correctly no matter which
  // anchor stored the edge — the same statement feeds both anchors' prompts,
  // teaching e.g. Mom she has darker hair without us inverting anything.
  const relatedNotes: Record<string, string> = {};
  for (const r of relatedAnchors) {
    const sentence = relationSentence(anchor, r);
    if (sentence) relatedNotes[r.id] = sentence;
  }

  // Cross-referencing: when the edit text mentions OTHER anchors ("make him
  // the same age as Amanda", typos included), detect them with one cheap
  // structured text call and inject their descriptions as prompt context — no
  // user tagging required. Best-effort: failures just skip the context.
  let mentionedAnchors: Anchor[] = [];
  if (isEdit) {
    const intentModel = env.models.intentModel ?? env.models.textModel;
    try {
      const intentKey = env.apiKeyFor(intentModel.provider);
      const runStepFn = env.runStep ?? (<T>(_s: string, fn: () => Promise<T>) => fn());
      const candidates = all.filter((a) => a.id !== anchor.id);
      const ids = await runStepFn("intent", () =>
        resolveMentionedAnchors({
          text: options.edit!,
          candidates,
          creds: { apiKey: intentKey },
          model: intentModel.id,
          providerId: intentModel.provider,
          prompts: env.prompts,
          signal: options.signal,
        }),
      );
      const idSet = new Set(ids);
      mentionedAnchors = candidates.filter((a) => idSet.has(a.id));
    } catch {
      // Provider unavailable — proceed without mention context.
    }
  }

  // Anchors normally use a faster/cheaper dedicated model. But when a
  // place/object embeds other anchors (e.g. a room containing a specific bed),
  // the embedded subjects must stay pixel-consistent with their own reference
  // sheets — which needs higher fidelity — so prefer GPT Image if available.
  const hasEmbedded = anchor.type !== "character" && containedAnchors.length > 0;
  const imageModel =
    hasEmbedded && env.models.imageModel.provider === "openai"
      ? env.models.imageModel
      : env.models.anchorImageModel;
  const key = env.apiKeyFor(imageModel.provider);

  // Contained children are drawn INTO this sheet and must match their own
  // reference exactly — pass them with the strong "subject" role (same strategy
  // as page illustration). Related anchors are context only ("resembles a
  // sibling"): passing their image invites the model to draw them, so they stay
  // TEXT-ONLY in the prompt. Blobs load in parallel, preserving order.
  const containedRefs: ReferenceImage[] = (
    await Promise.all(
      containedAnchors.map(async (rel): Promise<ReferenceImage | null> => {
        const img = currentAnchorImage(rel);
        const raw = img ? await env.loadBlob(img.blobId) : null;
        if (!raw) return null;
        const data = await asRefPayload(env, raw);
        return {
          base64: data.base64,
          mimeType: data.mimeType,
          role: "subject",
          label: rel.name,
        };
      }),
    )
  ).filter((r): r is ReferenceImage => Boolean(r));

  // The anchor's own previous image (edit base, or likeness on iterations).
  let subjectRef: ReferenceImage | null = null;
  if (options.useReference && anchor.versions && sourceNodeId) {
    const src = anchor.versions.nodes[sourceNodeId];
    if (src) {
      const raw = await env.loadBlob(src.content.blobId);
      if (raw) {
        const data = await asRefPayload(env, raw);
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
  // the anchor's own likeness together with its contained references — even on
  // a from-scratch generation — and let the prompt describe how they combine.
  // We still lead with the anchor's own image when present so an edit is framed
  // as a change to that sheet. Gemini composes labeled references regardless of
  // order.
  const isOpenAI = imageModel.provider === "openai";
  const editFromImage = isEdit && Boolean(subjectRef);
  let references: ReferenceImage[];
  if (editFromImage || isOpenAI) {
    references = [...(subjectRef ? [subjectRef] : []), ...containedRefs];
  } else {
    references = [...containedRefs, ...(subjectRef ? [subjectRef] : [])];
  }

  // Lead with the art-style exemplar so a from-scratch/variation sheet matches
  // the selected style. Skipped for edit-from-image, which must preserve the
  // existing sheet's style (adding a style ref could restyle it).
  const styleRef = editFromImage ? null : await loadStyleReference(env, project.config);
  if (styleRef) references = [styleRef, ...references];

  // Ordered reference legend so the model can bind each image to the right
  // subject (essential for OpenAI, whose images carry no labels). MUST mirror
  // the final `references` order above.
  const legendNames = references.map((r) => {
    if (r.role === "style") return "an art-style reference (match its style only, not its content)";
    if (r.label === anchor.name) return `the current reference sheet of ${anchor.name}`;
    return `${r.label ?? "a contained subject"} (must match this reference exactly)`;
  });
  const legend = legendNames.map((name, i) => `(${i + 1}) ${name}`).join(", ");

  const prompt = buildAnchorPrompt({
    anchor,
    artStyle: project.config.artStyle,
    containedAnchors,
    relatedAnchors,
    relatedNotes,
    mentionedAnchors,
    edit: options.edit,
    editFromImage,
    hasStyleRef: Boolean(styleRef),
    legend: references.length > 0 ? legend : undefined,
    prompts: env.prompts,
  });

  const runStep = env.runStep ?? (<T>(_s: string, fn: () => Promise<T>) => fn());
  let result = await runStep("image", () =>
    generateAnchorImage({
      prompt,
      creds: { apiKey: key },
      model: imageModel.id,
      providerId: imageModel.provider,
      references: references.length ? references : undefined,
      signal: options.signal,
    }),
  );

  // Embedded de-dup on reference sheets: when this place/object contains other
  // anchors, erase generic default instances (e.g. a default bed) that conflict
  // with the anchored embedded design. Respects multi-angle panel layout.
  // OpenAI only: its edits endpoint honors a real inpainting mask. Gemini
  // regenerates the full frame, so pasting a rectangle back produces seams —
  // worse than leaving the sheet untouched.
  if (hasEmbedded && containedAnchors.length > 0 && imageModel.provider === "openai") {
    const bindModel = env.models.bindingModel ?? env.models.textModel;
    try {
      const bindKey = env.apiKeyFor(bindModel.provider);
      const obsolete = await runStep("embedded", () =>
        locateEmbeddedObsolete({
          pageBase64: result.base64,
          pageMime: result.mimeType,
          parent: { name: anchor.name, description: anchor.description },
          children: containedAnchors.map((c) => ({
            id: c.id,
            name: c.name,
            description: c.description,
          })),
          mode: "sheet",
          creds: { apiKey: bindKey },
          model: bindModel.id,
          providerId: bindModel.provider,
          prompts: env.prompts,
          signal: options.signal,
        }),
      );
      const removals: { name: string; box: SubjectBox }[] = [];
      for (const child of containedAnchors) {
        const b = obsolete.get(child.id);
        if (!b) continue;
        for (const box of b.obsolete) removals.push({ name: child.name, box });
      }
      if (removals.length > 0) {
        const repaired = await removeRegionsInPlace({
          removals,
          page: { base64: result.base64, mimeType: result.mimeType },
          config: project.config,
          imageModel,
          imageKey: key,
          size: "1024x1024",
          env,
          signal: options.signal,
          step: "embedded",
          strict: false,
        });
        if (repaired) result = { ...result, base64: repaired.base64, mimeType: repaired.mimeType };
      }
    } catch {
      // Best-effort; keep the un-repaired sheet rather than failing the render.
    }
  }

  const blobId = await env.saveImage(result.base64, result.mimeType);
  const relatedIdSet = new Set(relatedAnchors.map((r) => r.id));
  return {
    blobId,
    mimeType: result.mimeType,
    // Provenance: contained anchors were used as IMAGES (track their version),
    // related anchors as TEXT only (track just the signature, so a sibling's
    // image regeneration doesn't flag this sheet stale).
    references: linked.map((r) => ({
      anchorId: r.id,
      versionId: r.versions?.cursorId,
      signature: anchorSignature(r),
      ...(relatedIdSet.has(r.id) && !containedAnchors.some((c) => c.id === r.id)
        ? { textOnly: true }
        : {}),
    })),
    prompt,
    label: options.edit?.trim() || (isIteration ? "Variation" : "Initial"),
    parentId: sourceNodeId,
  };
}
