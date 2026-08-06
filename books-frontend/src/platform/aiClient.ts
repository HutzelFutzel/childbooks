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
import { useAuthStore } from "../state/authStore";
import { useSparksUiStore } from "../state/sparksUiStore";
import type { Anchor, Project, ScreenplayDoc, StoryBrief } from "../core/types";
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
    // Out of Sparks → full accounts get the wallet (pre-suggesting a pack that
    // covers the shortfall); guests/unverified users can't buy, so the next
    // Sparks for them come from the signup/verify bonus — open the auth dialog.
    if (res.status === 402 && parsed?.error?.code === "insufficient_sparks") {
      const balance = parsed.error.balance ?? 0;
      const needed = parsed.error.needed ?? 0;
      if (useAuthStore.getState().accessLevel === "full") {
        useSparksUiStore.getState().openWallet(Math.max(0, needed - balance));
      } else {
        useAuthStore.getState().openAuthDialog();
      }
      throw new InsufficientSparksError(message, balance, needed);
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

/**
 * Tell the backend a project exists and where the user is in it.
 *
 * Books live in the user's own KV space, so the backend otherwise only learns
 * about one when it renders something for it — which makes abandoned projects
 * invisible to analysis, and those are the ones worth understanding. Fire and
 * forget: this is telemetry, and a failed beacon must never surface to the
 * person writing a story.
 */
export function touchProjectRemote(args: {
  projectId: string;
  stage?: string;
  title?: string;
}): void {
  void postAi<{ ok: boolean }>("/ai/project-touch", args).catch(() => {});
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
  /** Proposed relations, keyed by anchor name (ids don't exist server-side). */
  relations?: { from: string; to: string; kind: "contains" | "relates"; note?: string }[];
}

export interface StoryDraftResult {
  title: string;
  story: string;
}

export interface StoryFitResult {
  verdict: "good" | "minor" | "mismatch";
  headline: string;
  notes: string[];
}

/** Ask the backend to write the story described by the brief. */
export function storyDraftRemote(
  project: Project,
  brief: StoryBrief,
  signal?: AbortSignal,
): Promise<StoryDraftResult> {
  return postAi<StoryDraftResult>(
    "/ai/story-draft",
    { project: slimProjectForRender(project, {}), brief },
    signal,
  );
}

/** Advisory: does the author's own story suit the age band they picked? */
export function storyFitRemote(
  project: Project,
  signal?: AbortSignal,
): Promise<StoryFitResult> {
  return postAi<StoryFitResult>(
    "/ai/story-fit",
    { project: slimProjectForRender(project, {}) },
    signal,
  );
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
  /**
   * Cover-pair generation only: the blob id of an already-rendered sibling
   * cover (the front), so the backend attaches it as a reference image for
   * visual continuity. Resolved server-side via `env.loadBlob` — a blob id,
   * not raw bytes, since the client never receives the rendered pixels
   * itself, only a blob id/URL. Kept as a sibling of `options` (not inside
   * it) since it's a wire-level lookup instruction, not a pipeline option.
   */
  coverContinuationBlobId?: string,
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
    {
      project: slim,
      spreadId,
      options: serializableOptions(options),
      tier,
      ...(coverContinuationBlobId ? { coverContinuationBlobId } : {}),
    },
    options.signal,
  );
}
