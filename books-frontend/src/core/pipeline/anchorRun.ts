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
import { addVersion, createVersionTree, type VersionTree } from "../versioning";
import { buildAnchorPrompt, generateAnchorImage } from "./anchors";
import {
  containedAnchorsFor,
  linkedAnchorsFor,
  relatedAnchorsFor,
} from "../book/anchorGraph";
import { anchorSignature, currentAnchorImage } from "./provenance";
import type { PipelineEnv } from "./illustrationRun";

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
  return tree
    ? addVersion(tree, content, {
        parentId: render.parentId,
        prompt: render.prompt,
        label: render.label,
      })
    : createVersionTree(content, { prompt: render.prompt, label: render.label });
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

  const relationRefs: ReferenceImage[] = [];
  for (const rel of linked) {
    const img = currentAnchorImage(rel);
    const data = img ? await env.loadBlob(img.blobId) : null;
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
      const data = await env.loadBlob(src.content.blobId);
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
    prompts: env.prompts,
  });

  const result = await generateAnchorImage({
    prompt,
    creds: { apiKey: key },
    model: imageModel.id,
    providerId: imageModel.provider,
    references: references.length ? references : undefined,
    signal: options.signal,
  });

  const blobId = await env.saveImage(result.base64, result.mimeType);
  return {
    blobId,
    mimeType: result.mimeType,
    references: linked.map((r) => ({
      anchorId: r.id,
      versionId: r.versions?.cursorId,
      signature: anchorSignature(r),
    })),
    prompt,
    label: options.edit?.trim() || (isIteration ? "Variation" : "Initial"),
    parentId: sourceNodeId,
  };
}
