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
import { bindProjectLikenessPhotos } from "./likeness";
import type { AnchorRender, AnchorRunOptions } from "../core/pipeline/anchorRun";
import type { ExtractArtStyleResult } from "../core/pipeline/styleExtract";
import type { ExtractArtLookResult } from "../core/pipeline/lookExtract";
import type { IllustrationRender, IllustrationRunOptions } from "../core/pipeline/illustrationRun";
import { IntentAmbiguousError } from "../core/pipeline/intentResolve";
import type { GuideTurn, GuideTurnResult } from "../core/pipeline/guideInterpret";
import { ProviderError, type ProviderErrorKind } from "../core/errors";
import type { ImageTier } from "../core/config/modelConfig";
import type {
  GenerationQuote,
  GenerationQuotePurpose,
  GenerationQuoteUnit,
} from "../core/billing/generationQuote";
import type { ManuscriptCast } from "../core/guide/ownWords";

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
    kind?: ProviderErrorKind;
    retryable?: boolean;
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
    // An upstream provider failure keeps its KIND across the wire, so the
    // toast can say "the AI service took too long" instead of relaying a raw
    // provider string. Rebuilt as a real ProviderError so every consumer of
    // `describeError` / `isAbortError` behaves the same as it does in-process.
    if (parsed?.error?.code === "provider_error" && parsed.error.kind) {
      throw new ProviderError(message, {
        kind: parsed.error.kind,
        status: res.status,
        retryable: parsed.error.retryable,
      });
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
  /** Which studio the reader is looking at. Retired with the comparison. */
  flow?: "guide" | "legacy";
  /** True when the reader has reached the finished-book preview. */
  previewed?: boolean;
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
  /** A short title in the book's language, when the analysis invented one. */
  title?: string;
  /** Subtitle ideas in the book's language; older servers send none. */
  subtitles?: string[];
  anchors: Anchor[];
  model: string;
  /** Private contained-subject dependencies, keyed by name until reconciliation. */
  embeddings?: { container: string; subject: string }[];
}

export interface StoryDraftResult {
  title: string;
  story: string;
  /** Front-cover subtitle ideas written with the story (drafts only). */
  subtitles?: string[];
}

export interface StoryFitResult {
  verdict: "good" | "minor" | "mismatch";
  headline: string;
  notes: string[];
  /** Per-quality calibration against the age band's rubric. */
  dimensions?: { id: string; fit: "typical" | "lighter" | "heavier" }[];
  /**
   * The age band and its revision at the time of the read. A later edit to the
   * band changes what "right for this age" means, which outdates the read just
   * as surely as editing the story does.
   */
  profileId?: string;
  profileRevision?: number;
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

/** Ask the backend to translate and adapt an existing story into a target language. */
export function storyTranslateRemote(
  project: Project,
  sourceLocale?: string,
  targetLocale?: string,
  signal?: AbortSignal,
): Promise<StoryDraftResult> {
  return postAi<StoryDraftResult>(
    "/ai/story-translate",
    { project: slimProjectForRender(project, {}), sourceLocale, targetLocale },
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

/**
 * Ask the backend to read one chat message from the guided studio.
 *
 * The reply is a PROPOSAL: `patch` is untrusted and must go through
 * `applyGuidePatch` (see `state/guideTurn.ts`, the only caller that should exist).
 *
 * Slimmed differently from every other text call, and it matters. The others send
 * the artifact they are about to work on; this one asks "where is this book, and
 * what does it still need", so it reads the *presence* of every artifact — the
 * story analysis, the character sheets, the page plan, the finished pages. Sending
 * the usual text-only snapshot would show it a book with no artwork and no pages
 * however far along the reader actually is, and it would answer accordingly:
 * offering to draw characters that have been drawn for days.
 *
 * Cheap despite that, because presence is all it needs: version trees reduce to
 * their cursor lineage and the nodes hold blob references rather than image bytes,
 * so the payload grows with the page count and not with the edit history.
 * `guide-interpreter-invariants.ts` holds this to the letter — it compares the
 * guide's view of a book before and after slimming, over every state in the ladder,
 * because getting this wrong produces no error at all, just a guide that is
 * confidently wrong about the book in front of it.
 */
export function interpretGuideTurnRemote(
  project: Project,
  message: string,
  args: {
    transcript?: GuideTurn[];
    /** The admin's saved flow toggle; honoured server-side for admins only. */
    guidePreference?: "guide" | "legacy" | null;
    /** The follow-up the guide just asked, so a short reply finds its skill. */
    pending?: string;
    /** The story passage the reader marked, so "make this nicer" finds its skill. */
    marked?: string;
    /** The picture the reader has selected, so "redraw her" finds who. */
    selected?: string;
  } = {},
  signal?: AbortSignal,
): Promise<GuideTurnResult & { turnId: string | null }> {
  return postAi<GuideTurnResult & { turnId: string | null }>(
    "/ai/guide/interpret",
    {
      project: slimProjectForRender(project, {
        keepScreenplay: true,
        keepAnchorVersions: true,
        keepAnalysis: true,
        illustrationTargets: Object.keys(project.illustrations ?? {}).map((id) => ({ id })),
      }),
      message,
      transcript: args.transcript ?? [],
      guidePreference: args.guidePreference ?? null,
      ...(args.pending ? { pending: args.pending } : {}),
      ...(args.marked ? { marked: args.marked } : {}),
      ...(args.selected ? { selected: args.selected } : {}),
    },
    signal,
  );
}

/** What the admin's "try it" reads out of one sentence. Nothing is applied. */
export interface GuideTryResult {
  skillsOn: boolean;
  intent: string;
  reply: string;
  confidence: number;
  commands: { id: string; args: Record<string, unknown>; evidence: string; confidence: number }[];
  overflowCommands: { id: string; args: Record<string, unknown> }[];
  refusedCommands: { id: string; reason: string; evidence: string }[];
  facts: string[];
  refusedFacts: number;
}

/**
 * Admin-only: read a sentence against a book with the guide settings as edited
 * (the unsaved draft) and report which skills would run. Writes nothing.
 */
export function tryGuideTurnRemote(
  project: Project,
  message: string,
  draft: unknown,
  signal?: AbortSignal,
): Promise<GuideTryResult> {
  return postAi<GuideTryResult>(
    "/ai/guide/try",
    {
      project: slimProjectForRender(project, {
        keepScreenplay: true,
        keepAnchorVersions: true,
        keepAnalysis: true,
        illustrationTargets: Object.keys(project.illustrations ?? {}).map((id) => ({ id })),
      }),
      message,
      draft,
    },
    signal,
  );
}

/**
 * Tell the server what the browser did with a proposal.
 *
 * Fire-and-forget by design: this is the audit trail, and the reader's turn must
 * not wait on it or fail with it. A dropped report costs one row's outcome field;
 * a report that could block the conversation would cost the conversation.
 */
export function reportGuideTurnOutcomeRemote(report: {
  turnId: string;
  applied: string[];
  unchanged: string[];
  rejected: { key: string; reason: string }[];
  admittedFailure: boolean;
}): void {
  void postAi<{ ok: boolean }>("/ai/guide/outcome", report).catch(() => {});
}

export function extractArtStyleRemote(
  project: Project,
  signal?: AbortSignal,
): Promise<ExtractArtStyleResult> {
  return postAi<ExtractArtStyleResult>(
    "/ai/extract-art-style",
    {
      project: slimProjectForRender(project, {
        keepAnchorVersions: false,
        keepStyleSourceArt: true,
      }),
    },
    signal,
  );
}

export function extractArtLookRemote(
  project: Project,
  signal?: AbortSignal,
): Promise<ExtractArtLookResult> {
  return postAi<ExtractArtLookResult>(
    "/ai/extract-art-look",
    { project: slimProjectForRender(project, { keepAnchorVersions: false }) },
    signal,
  );
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

export async function anchorImageRemote(
  project: Project,
  anchorId: string,
  options: AnchorRunOptions,
  tier: ImageTier,
): Promise<AnchorRender> {
  await bindProjectLikenessPhotos(project, [anchorId]);
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

/** Ask the backend for a stored estimate covering exactly these units. */
export function requestGenerationQuoteRemote(args: {
  projectId: string;
  purpose: GenerationQuotePurpose;
  tier: ImageTier;
  units: GenerationQuoteUnit[];
}): Promise<GenerationQuote> {
  return postAi<GenerationQuote>("/ai/generation-quote", args);
}

/** The next thing the guide says, after a turn is saved. The caller checks the asks. */
export function guideAskNextRemote(args: {
  projectId: string;
  language: string;
  names: string[];
  learned: string;
  open: string;
  transcript: string;
  guidePreference?: string | null;
}): Promise<{ text: string; asks: string[] }> {
  return postAi("/ai/guide/speak", { ...args, mode: "next" });
}

/** Phrase configured guide lines in the chat language. Names come back unchanged. */
export function guideSpeakRemote(args: {
  projectId: string;
  language: string;
  names: string[];
  lines: { id: string; meaning: string }[];
  guidePreference?: string | null;
}): Promise<{ lines: Record<string, string> }> {
  return postAi("/ai/guide/speak", args);
}

/** Phrase one guide message in the persona. The caller validates the text. */
export function guideComposeRemote(
  args: {
    projectId: string;
    language: string;
    locale: string;
    names: string[];
    meanings: string[];
    transcript: string;
    guidePreference?: string | null;
  },
  signal?: AbortSignal,
): Promise<{ text: string }> {
  return postAi("/ai/guide/compose", args, signal);
}

/** Answer a how-to question from the help articles and this book. */
export function guideAnswerRemote(
  project: Project,
  args: { question: string; language: string; locale: string; transcript: string; guidePreference?: string | null },
  signal?: AbortSignal,
): Promise<{ text: string; grounded: boolean }> {
  return postAi("/ai/guide/answer", { project: slimProjectForRender(project, {}), ...args }, signal);
}

/** Read the names and stated ages in a manuscript, without rewriting it. */
export function guideExtractCastRemote(args: {
  projectId: string;
  story: string;
  guidePreference?: string | null;
}): Promise<ManuscriptCast> {
  return postAi("/ai/guide/extract-cast", args);
}
