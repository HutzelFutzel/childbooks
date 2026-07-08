/**
 * Client for the server-side AI execution endpoints (`/ai/*`).
 *
 * Interactive AI no longer runs in the browser: these helpers POST a project
 * snapshot to the backend, which resolves the model from the admin config, runs
 * the shared pipeline with the server-held key, meters usage, and returns the
 * render/result. The caller folds the result into the project's version trees
 * (single writer), exactly like the job-reconcile path does.
 */
import { backendFetch } from "./backend";
import { useSparksUiStore } from "../state/sparksUiStore";
import type { Anchor, Project, ScreenplayDoc } from "../core/types";
import { slimProjectForRender } from "../core/book/slimProject";
import type { AnchorRender, AnchorRunOptions } from "../core/pipeline/anchorRun";
import type { IllustrationRender, IllustrationRunOptions } from "../core/pipeline/illustrationRun";
import { IntentAmbiguousError } from "../core/pipeline/intentResolve";
import type { ImageTier } from "../core/config/modelConfig";

export { IntentAmbiguousError };

/** Thrown when the backend rejects an AI action for lack of Sparks (HTTP 402). */
export class InsufficientSparksError extends Error {
  constructor(
    message: string,
    public balance: number,
    public needed: number,
  ) {
    super(message);
    this.name = "InsufficientSparksError";
  }
}

interface ErrorBody {
  error?: {
    message?: string;
    code?: string;
    balance?: number;
    needed?: number;
    candidates?: { anchorId: string; name: string; brief?: string }[];
  };
}

async function postAi<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await backendFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    let parsed: ErrorBody | null = null;
    try {
      parsed = (await res.json()) as ErrorBody;
    } catch {
      parsed = null;
    }
    const message = parsed?.error?.message ?? `Request failed (${res.status}).`;
    if (res.status === 409 && parsed?.error?.code === "intent_ambiguous") {
      throw new IntentAmbiguousError(message, parsed.error.candidates ?? []);
    }
    // Out of Sparks → pop the wallet (pre-suggesting a pack that covers the
    // shortfall) so the user can fix it in one click, then surface a typed error.
    if (res.status === 402 && parsed?.error?.code === "insufficient_sparks") {
      const balance = parsed.error.balance ?? 0;
      const needed = parsed.error.needed ?? 0;
      useSparksUiStore.getState().openWallet(Math.max(0, needed - balance));
      throw new InsufficientSparksError(message, balance, needed);
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

/** Strip non-serializable fields (AbortSignal) from run options for the wire. */
function serializableOptions<T extends { signal?: AbortSignal }>(options: T): Omit<T, "signal"> {
  const { signal: _signal, ...rest } = options;
  return rest;
}

export interface AnalyzeResult {
  summary: string;
  anchors: Anchor[];
  model: string;
}

export function analyzeStoryRemote(project: Project, signal?: AbortSignal): Promise<AnalyzeResult> {
  // Text-only: needs config.storyText; drop all version history/design.
  return postAi<AnalyzeResult>("/ai/analyze", { project: slimProjectForRender(project, {}) }, signal);
}

export async function anchorDescriptionRemote(
  project: Project,
  anchorId: string,
  signal?: AbortSignal,
): Promise<string> {
  const { description } = await postAi<{ description: string }>(
    "/ai/anchor-description",
    { project: slimProjectForRender(project, {}), anchorId },
    signal,
  );
  return description;
}

export function screenplayRemote(
  project: Project,
  edit?: string,
  previous?: ScreenplayDoc,
  signal?: AbortSignal,
): Promise<ScreenplayDoc> {
  // Reads anchors' text + config only; the previous screenplay is sent separately.
  return postAi<ScreenplayDoc>(
    "/ai/screenplay",
    { project: slimProjectForRender(project, {}), edit, previous },
    signal,
  );
}

export function anchorImageRemote(
  project: Project,
  anchorId: string,
  options: AnchorRunOptions,
  tier: ImageTier,
): Promise<AnchorRender> {
  // Image render: keep anchors' active images (+ this anchor's branch point).
  const slim = slimProjectForRender(project, {
    keepAnchorVersions: true,
    anchorTargets: [{ id: anchorId, nodeId: options.fromNodeId }],
  });
  return postAi<AnchorRender>(
    "/ai/anchor-image",
    { project: slim, anchorId, options: serializableOptions(options), tier },
    options.signal,
  );
}

export function illustrationRemote(
  project: Project,
  spreadId: string,
  options: IllustrationRunOptions,
  tier: ImageTier,
): Promise<IllustrationRender | null> {
  // Illustration render: needs the screenplay (to resolve the spread/cover), the
  // anchors' active images, and this spread's illustration tree (+ branch point).
  const slim = slimProjectForRender(project, {
    keepScreenplay: true,
    keepAnchorVersions: true,
    illustrationTargets: [{ id: spreadId, nodeId: options.fromNodeId }],
  });
  return postAi<IllustrationRender | null>(
    "/ai/illustration",
    { project: slim, spreadId, options: serializableOptions(options), tier },
    options.signal,
  );
}
