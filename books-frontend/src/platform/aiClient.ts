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
import type { AnchorRender, AnchorRunOptions } from "../core/pipeline/anchorRun";
import type { IllustrationRender, IllustrationRunOptions } from "../core/pipeline/illustrationRun";

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
  error?: { message?: string; code?: string; balance?: number; needed?: number };
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
  return postAi<AnalyzeResult>("/ai/analyze", { project }, signal);
}

export async function anchorDescriptionRemote(
  project: Project,
  anchorId: string,
  signal?: AbortSignal,
): Promise<string> {
  const { description } = await postAi<{ description: string }>(
    "/ai/anchor-description",
    { project, anchorId },
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
  return postAi<ScreenplayDoc>("/ai/screenplay", { project, edit, previous }, signal);
}

export function anchorImageRemote(
  project: Project,
  anchorId: string,
  options: AnchorRunOptions,
): Promise<AnchorRender> {
  return postAi<AnchorRender>(
    "/ai/anchor-image",
    { project, anchorId, options: serializableOptions(options) },
    options.signal,
  );
}

export function illustrationRemote(
  project: Project,
  spreadId: string,
  options: IllustrationRunOptions,
): Promise<IllustrationRender | null> {
  return postAi<IllustrationRender | null>(
    "/ai/illustration",
    { project, spreadId, options: serializableOptions(options) },
    options.signal,
  );
}
