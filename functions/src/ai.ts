/**
 * Server-side AI execution endpoints.
 *
 * All interactive AI now runs here (not in the browser): each endpoint resolves
 * the model for its action from the admin `appConfig/models` (server-authoritative
 * — the client never chooses the model), runs the shared platform-agnostic
 * pipeline with the server-held provider key, meters token usage, and returns
 * the result for the client to fold into its version trees. Bulk/long-running
 * work still goes through the Firestore job queue (`jobs.ts`).
 *
 * Mounted under `/ai`, guarded by `requireAuth` in `app.ts` — guests generate
 * too (low-friction trial), at the same production quality but without a
 * negative-balance buffer, so a guest can never spend past granted Sparks.
 */
import express, { type Express, type Response } from "express";
import { isAdminUid, isAnonymousToken, type AuthedRequest } from "./auth";
import { backendPipelineEnv } from "./pipelineEnv";
import { withUsage } from "./usage";
import { meterAndSettle, runKindOf } from "./actionRun";
import { isClientMilestone, touchProject } from "./projects";
import {
  ensureAffordAction,
  InsufficientSparks,
  printPrepDue,
  printPrepShare,
  referenceLimitsForAction,
} from "./sparks";
import { hasLikenessPhotoForSubject } from "./likeness";
import {
  plannedAnchorReferences,
  plannedIllustrationReferences,
} from "../../books-frontend/src/core/billing/referencePlan";
import { standingPriceOverrides } from "./campaigns/pricing";
import { ensureWithinQuota, incrementQuota, QuotaExceeded } from "./quotas";
import { ALL_IMAGE_ACTION_IDS } from "../../books-frontend/src/core/ai/actions";
import { ProviderError } from "../../books-frontend/src/core/errors";
import {
  apiKeyFor,
  requireTier,
  resolveImageModels,
  resolveTextAction,
  ServiceUnavailable,
} from "./modelResolve";
import { analyzeStory, generateAnchorDescription } from "../../books-frontend/src/core/pipeline/analysis";
import {
  extractArtStyleFromImages,
  type ExtractArtStyleResult,
  type SourceArtCharacterInput,
} from "../../books-frontend/src/core/pipeline/styleExtract";
import { extractArtLookFromImages } from "../../books-frontend/src/core/pipeline/lookExtract";
import { collectSourceArtGroups, firstStyleArtwork } from "../../books-frontend/src/core/book/sourceArt";
import type { CustomStyleRef } from "../../books-frontend/src/core/config/customArtStyles";
import { captureStyleCover } from "./styleShowcase";
import {
  applyCustomStyleToProject,
  findCustomStyle,
  hashDrawing,
  orderDrawings,
  refOf,
  saveCustomStyle,
  type LoadedDrawing,
} from "./customStyles";
import { coverSpread } from "../../books-frontend/src/core/book/units";
import { coverLinesOf } from "../../books-frontend/src/core/book/coverLines";
import { generateStoryDraft } from "../../books-frontend/src/core/pipeline/storyDraft";
import { translateStory } from "../../books-frontend/src/core/pipeline/storyTranslate";
import { checkStoryFit } from "../../books-frontend/src/core/pipeline/storyFit";
import {
  briefBlockers,
  isBriefReady,
  normalizeStoryBriefForCraft,
  storyBriefSchema,
} from "../../books-frontend/src/core/story/brief";
import { resolveStoryCraftFor } from "../../books-frontend/src/core/prompts/story";
import { generateScreenplay } from "../../books-frontend/src/core/pipeline/screenplay";
import { renderAnchor, type AnchorRunOptions } from "../../books-frontend/src/core/pipeline/anchorRun";
import {
  renderCoverContinuation,
  renderIllustration,
  type IllustrationRunOptions,
} from "../../books-frontend/src/core/pipeline/illustrationRun";
import { stampImageProvenance } from "../../books-frontend/src/core/pipeline/imageProvenance";
import { IntentAmbiguousError } from "../../books-frontend/src/core/pipeline/intentResolve";
import {
  activeComponentId,
  interpretGuideTurn,
  patchedSlotIds,
  type GuideTurn,
} from "../../books-frontend/src/core/pipeline/guideInterpret";
import { normalizeGuideConfig } from "../../books-frontend/src/core/config/guide";
import { guidePatchContext } from "../../books-frontend/src/core/guide/patch";
import { resolveGuidePlaylist } from "../../books-frontend/src/core/guide/playlist";
import { askGuideNext, speakGuideLines } from "../../books-frontend/src/core/guide/speech";
import { answerGuideQuestion, composeGuideMessage } from "../../books-frontend/src/core/guide/agent/compose";
import {
  bookFactsText,
  enabledSkills,
  helpSheetText,
  resolveHelpArticles,
  skillsHelpText,
} from "../../books-frontend/src/core/guide/agent/help";
import { extractManuscriptCast, OWN_WORDS_MAX_CHARS } from "../../books-frontend/src/core/guide/ownWords";
import { recordGuideEvent, recordGuideTurn, recordGuideTurnOutcome } from "./guideTurns";
import { isGuideEventKind } from "../../books-frontend/src/core/guide/events";
import { downloadBlobBase64 } from "./storage";
import {
  getArtStylesConfig,
  getStoryCraftConfig,
  getAudienceConfig,
  getGuideConfig,
  getLayoutsConfig,
  getGenerationTuningConfig,
  loadModelCapabilities,
  loadPromptContext,
} from "./appConfig";
import {
  estimateProfileForAction,
  generationRenderKindOf,
} from "../../books-frontend/src/core/config/generationEstimateProfile";
import { generationTuningFor } from "../../books-frontend/src/core/config/generationTuning";
import { containedAnchorsFor } from "../../books-frontend/src/core/book/anchorGraph";
import { effectiveAnchorIds } from "../../books-frontend/src/core/book/anchorRefs";
import {
  COVER_BACK_ID,
  COVER_FRONT_ID,
  SPINE_ID,
  type BodyPlan,
  type BookConfig,
  type ModelSelection,
  type Project,
  type ScreenplayDoc,
  type ScreenplaySpread,
  type StoryBrief,
} from "../../books-frontend/src/core/types";

const resolveText = resolveTextAction;

function withTextModel(config: BookConfig, model: ModelSelection): BookConfig {
  return { ...config, textModel: { provider: model.provider, id: model.id } };
}

/**
 * Wall-clock budget for one `/ai/*` request, kept under the `api` function's own
 * 300s timeout.
 *
 * Without a deadline of our own the platform is the only thing that stops a slow
 * request, and it stops it by killing the instance — the client then gets an
 * unparseable 5xx body and shows "Request failed (500)." after five minutes of
 * spinning. Worse, nothing bounded the pipelines' retry budgets against the
 * function's: a text call may retry up to four times at 210–240s each, which
 * cannot fit however fast the provider is.
 *
 * `AbortSignal.timeout` (rather than a plain controller) is deliberate: it
 * aborts with a `TimeoutError`, which the provider layer classifies as
 * `kind: "timeout"` — non-retryable, and honestly described to the user as the
 * provider being too slow instead of as a cancellation.
 */
const REQUEST_BUDGET_MS = 280_000;

function requestDeadline(): AbortSignal {
  return AbortSignal.timeout(REQUEST_BUDGET_MS);
}

/**
 * Longest a single PAST turn may be when replayed as history.
 *
 * Not the limit on the message being read — that one is admin-set, because a
 * parent pasting their own story needs room. History is different: a 40,000
 * character turn three messages ago is prompt weight we pay for on every
 * subsequent turn, and its first 2,000 characters say the same thing about what
 * the conversation is doing.
 */
const MAX_GUIDE_TRANSCRIPT_TEXT = 2000;

/** Turns of history the guide sends along, capped so the prompt stays bounded. */
const MAX_GUIDE_TRANSCRIPT = 12;

/**
 * Accept a transcript from the client, dropping anything malformed.
 *
 * The history is the client's to keep — it is what the reader can see on screen,
 * and reconstructing it here from the turn log would let a stale server view
 * disagree with the conversation in front of them. It only ever resolves
 * references like "yes" and "the second one", so a dropped entry costs precision,
 * never correctness.
 */
function parseGuideTranscript(raw: unknown): GuideTurn[] {
  if (!Array.isArray(raw)) return [];
  const turns: GuideTurn[] = [];
  for (const entry of raw.slice(-MAX_GUIDE_TRANSCRIPT)) {
    if (!entry || typeof entry !== "object") continue;
    const { role, text } = entry as { role?: unknown; text?: unknown };
    if (role !== "reader" && role !== "guide") continue;
    if (typeof text !== "string" || !text.trim()) continue;
    turns.push({ role, text: text.trim().slice(0, MAX_GUIDE_TRANSCRIPT_TEXT) });
  }
  return turns;
}

/** Source drawings as the vision model reads them, plus what a saved style needs to know about each. */
type LoadedSourceArtCharacter = SourceArtCharacterInput & { drawings: LoadedDrawing[] };

async function loadSourceArtCharacters(
  uid: string,
  project: Project,
): Promise<LoadedSourceArtCharacter[]> {
  const groups = collectSourceArtGroups(project);
  return (
    await Promise.all(
      groups.map(async (group) => {
        const drawings = (
          await Promise.all(
            group.images.map(async (image): Promise<LoadedDrawing | null> => {
              try {
                const loaded = await downloadBlobBase64(uid, image.blobId);
                return {
                  blobId: image.blobId,
                  mimeType: loaded.mimeType,
                  base64: loaded.base64,
                  sha256: hashDrawing(loaded.base64),
                  createdAt: image.createdAt,
                };
              } catch {
                return null;
              }
            }),
          )
        ).filter((row): row is LoadedDrawing => Boolean(row));
        const images = drawings.map(({ base64, mimeType }) => ({ base64, mimeType }));
        return { id: group.id, name: group.name, images, drawings };
      }),
    )
  ).filter((group) => group.images.length > 0);
}

/**
 * Save the look just read as a custom style, one per set of drawings. A failure
 * here never fails the extraction the reader has already paid for: the book
 * simply keeps its own copy of the wording and the drawing.
 */
async function saveReadLook(args: {
  uid: string;
  project: Project;
  hashes: string[];
  drawings: LoadedDrawing[];
  stylePrompt: string;
  names: string[];
  model: ModelSelection;
}): Promise<CustomStyleRef | undefined> {
  try {
    const saved = await saveCustomStyle({
      uid: args.uid,
      hashes: args.hashes,
      drawings: args.drawings,
      promptDescription: args.stylePrompt,
      derivedFromNames: args.names,
      projectId: args.project.id,
      extraction: { model: { provider: args.model.provider, id: args.model.id } },
    });
    return refOf(saved);
  } catch (error) {
    console.warn("[ai] could not save the custom art style", { error: String(error) });
    return undefined;
  }
}

function sendError(res: Response, err: unknown): void {
  if (err instanceof InsufficientSparks) {
    // 402 Payment Required — the client surfaces a Spark top-up prompt.
    res.status(402).json({
      error: { message: err.message, code: "insufficient_sparks", balance: err.balance, needed: err.needed },
    });
    return;
  }
  if (err instanceof ServiceUnavailable) {
    res.status(503).json({ error: { message: err.message } });
    return;
  }
  if (err instanceof QuotaExceeded) {
    // 403 Forbidden — the client surfaces an upgrade prompt.
    res.status(403).json({
      error: { message: err.message, code: "quota_exceeded", quota: err.quotaId, limit: err.limit },
    });
    return;
  }
  if (err instanceof IntentAmbiguousError) {
    res.status(409).json({
      error: {
        message: err.message,
        code: "intent_ambiguous",
        candidates: err.candidates,
      },
    });
    return;
  }
  // Carry the provider error's KIND across the wire, not just its message.
  // Without it the client rebuilds every failure as a bare `Error` and prints
  // the raw provider string, so all of `describeError`'s copy — the rate-limit,
  // timeout and parse wording — was unreachable for anything going through
  // HTTP. `retryable` rides along so the client never invites a retry of a
  // request that can only fail the same way again.
  if (err instanceof ProviderError) {
    // Always 502/504 — never the provider's own status. 401/403 here mean "the
    // CALLER's auth" everywhere else in this API, so forwarding a provider key
    // rejection as 401 would send `backendFetch` off to refresh a session that
    // was never the problem and then prompt the user to sign in again.
    res.status(err.kind === "timeout" ? 504 : 502).json({
      error: {
        message: err.message,
        code: "provider_error",
        kind: err.kind,
        retryable: err.retryable,
      },
    });
    return;
  }
  res.status(500).json({ error: { message: (err as Error)?.message ?? "Generation failed." } });
}

function isCoverId(id: string): boolean {
  return id === COVER_FRONT_ID || id === COVER_BACK_ID || id === SPINE_ID;
}

export function registerAiRoutes(app: Express): void {
  const json = express.json({ limit: "50mb" });

  // --- Text actions ---------------------------------------------------------

  app.post("/ai/story-draft", json, async (req: AuthedRequest, res: Response) => {
    try {
      const { project, brief: rawBrief } = req.body as { project: Project; brief: unknown };
      // Never let a client-supplied brief reach a prompt unchecked: the mode
      // selects the template, and the theme/device ids index the admin catalog.
      const parsed = storyBriefSchema.safeParse(rawBrief);
      if (!parsed.success) {
        res.status(400).json({ error: { message: "That story brief isn't valid." } });
        return;
      }
      const parsedBrief = parsed.data as StoryBrief;
      if (parsedBrief.mode === "own") {
        res.status(400).json({ error: { message: "This mode writes its own story." } });
        return;
      }
      if (!isBriefReady(parsedBrief)) {
        res.status(400).json({
          error: { message: briefBlockers(parsedBrief)[0] ?? "The story brief is incomplete." },
        });
        return;
      }
      const [model, prompts] = await Promise.all([resolveText("storyDraft"), loadPromptContext()]);
      const brief = normalizeStoryBriefForCraft(
        parsedBrief,
        resolveStoryCraftFor(project.config.ageRangeId, prompts),
      );
      const startedAt = Date.now();
      const { value, events, stats } = await withUsage(() =>
        generateStoryDraft({
          brief,
          config: withTextModel(project.config, model),
          creds: { apiKey: apiKeyFor(model.provider) },
          model: model.id,
          prompts,
          signal: requestDeadline(),
        }),
        model.params,
      );
      await meterAndSettle({
        uid: req.uid!,
        action: "storyDraft",
        events,
        stats,
        projectId: project.id,
        project,
        kind: "fresh",
        source: "sync",
        startedAt,
        models: { text: model },
      });
      res.json(value);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/ai/story-translate", json, async (req: AuthedRequest, res: Response) => {
    try {
      const { project, sourceLocale, targetLocale } = req.body as {
        project: Project;
        sourceLocale?: BookConfig["contentLocale"];
        targetLocale?: BookConfig["contentLocale"];
      };
      const story = project.config.storyText?.trim() ?? "";
      if (story.length < 5) {
        res.status(400).json({ error: { message: "There's no story to translate yet." } });
        return;
      }
      const [model, prompts] = await Promise.all([resolveText("storyDraft"), loadPromptContext()]);
      const startedAt = Date.now();
      const target = targetLocale ?? project.config.contentLocale;
      const { value, events, stats } = await withUsage(() =>
        translateStory({
          config: withTextModel(
            {
              ...project.config,
              contentLocale: target,
            },
            model,
          ),
          story,
          title: project.title,
          subtitle: coverLinesOf(project).subtitle,
          sourceLocale,
          targetLocale: target,
          creds: { apiKey: apiKeyFor(model.provider) },
          model: model.id,
          prompts,
          signal: requestDeadline(),
        }),
        model.params,
      );
      await meterAndSettle({
        uid: req.uid!,
        action: "storyDraft",
        events,
        stats,
        projectId: project.id,
        project,
        kind: "fresh",
        source: "sync",
        startedAt,
        models: { text: model },
      });
      res.json(value);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/ai/story-fit", json, async (req: AuthedRequest, res: Response) => {
    try {
      const { project } = req.body as { project: Project };
      const story = project.config.storyText?.trim() ?? "";
      if (story.length < 20) {
        res.status(400).json({ error: { message: "There's no story to check yet." } });
        return;
      }
      const [model, prompts] = await Promise.all([resolveText("storyCheck"), loadPromptContext()]);
      const startedAt = Date.now();
      const { value, events, stats } = await withUsage(() =>
        checkStoryFit({
          story,
          config: withTextModel(project.config, model),
          creds: { apiKey: apiKeyFor(model.provider) },
          model: model.id,
          prompts,
          signal: requestDeadline(),
        }),
        model.params,
      );
      await meterAndSettle({
        uid: req.uid!,
        action: "storyCheck",
        events,
        stats,
        projectId: project.id,
        project,
        kind: "fresh",
        source: "sync",
        startedAt,
        models: { text: model },
      });
      res.json(value);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/ai/analyze", json, async (req: AuthedRequest, res: Response) => {
    try {
      const { project } = req.body as { project: Project };
      const [model, prompts] = await Promise.all([resolveText("storyAnalysis"), loadPromptContext()]);
      let artworkLooks: { name: string; description: string; bodyPlan?: BodyPlan }[] = [];
      const sourceCharacters = await loadSourceArtCharacters(req.uid!, project).catch(() => []);
      if (sourceCharacters.length > 0) {
        try {
          const lookModel = await resolveText("extractArtLook");
          const lookStarted = Date.now();
          const lookRun = await withUsage(() =>
            extractArtLookFromImages({
              characters: sourceCharacters,
              creds: { apiKey: apiKeyFor(lookModel.provider) },
              model: lookModel.id,
              providerId: lookModel.provider,
              prompts,
              signal: requestDeadline(),
            }),
            lookModel.params,
          );
          await meterAndSettle({
            uid: req.uid!,
            action: "extractArtLook",
            events: lookRun.events,
            stats: lookRun.stats,
            projectId: project.id,
            project,
            kind: "fresh",
            source: "sync",
            startedAt: lookStarted,
            models: { text: lookModel },
          });
          artworkLooks = lookRun.value.characters;
        } catch {
          // Analysis still runs; pages then rely on the attached sheets.
        }
      }
      const startedAt = Date.now();
      const { value, events, stats } = await withUsage(() =>
        analyzeStory({
          story: project.config.storyText,
          config: withTextModel(project.config, model),
          creds: { apiKey: apiKeyFor(model.provider) },
          model: model.id,
          prompts,
          artworkLooks,
          signal: requestDeadline(),
        }),
        // Without the bound action's parameters the analysis ran at the provider's
        // default thinking level, with no timeout of its own.
        model.params,
      );
      await meterAndSettle({
        uid: req.uid!,
        action: "storyAnalysis",
        events,
        stats,
        projectId: project.id,
        project,
        kind: "fresh",
        source: "sync",
        startedAt,
        models: { text: model },
      });
      res.json({ ...value, model: model.id });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/ai/extract-art-style", json, async (req: AuthedRequest, res: Response) => {
    try {
      const { project } = req.body as { project: Project };
      const groups = collectSourceArtGroups(project);
      if (groups.length === 0) {
        res.status(400).json({ error: { message: "Add character artwork first." } });
        return;
      }
      const guest = isAnonymousToken(req.authToken);
      const characters = await loadSourceArtCharacters(req.uid!, project);
      if (characters.length === 0) {
        res.status(400).json({ error: { message: "The artwork could not be loaded." } });
        return;
      }
      // The same drawings are the same look. When they were read before, hand
      // back the saved style: no model call, no charge, the same wording.
      const allDrawings = characters.flatMap((character) => character.drawings);
      const allHashes = allDrawings.map((drawing) => drawing.sha256);
      const saved = await findCustomStyle(req.uid!, allHashes).catch(() => null);
      if (saved) {
        res.json({
          compatible: true,
          stylePrompt: saved.revision.promptDescription,
          characters: characters.map((character) => ({
            id: character.id,
            name: character.name,
            stylePrompt: saved.revision.promptDescription,
          })),
          customStyle: refOf(saved),
          cached: true,
        });
        return;
      }
      await ensureAffordAction(req.uid!, "extractArtStyle", requireTier(undefined, guest), {
        noNegativeBuffer: guest,
      });
      const [model, prompts] = await Promise.all([
        resolveText("extractArtStyle"),
        loadPromptContext(),
      ]);
      const startedAt = Date.now();
      const { value, events, stats } = await withUsage(() =>
        extractArtStyleFromImages({
          characters,
          creds: { apiKey: apiKeyFor(model.provider) },
          model: model.id,
          providerId: model.provider,
          prompts,
          signal: requestDeadline(),
        }),
        model.params,
      );
      await meterAndSettle({
        uid: req.uid!,
        action: "extractArtStyle",
        events,
        stats,
        projectId: project.id,
        project,
        kind: "fresh",
        source: "sync",
        startedAt,
        models: { text: model },
      });

      // Save what was read. A shared look is one style for all the drawings;
      // a clash saves one candidate per character, and the book points at
      // whichever the reader picks (it becomes active when a render uses it).
      const first = firstStyleArtwork(project, collectSourceArtGroups(project));
      let out: ExtractArtStyleResult = value;
      if (value.compatible && value.stylePrompt.trim()) {
        const customStyle = await saveReadLook({
          uid: req.uid!,
          project,
          hashes: allHashes,
          drawings: orderDrawings(allDrawings, first?.ref.blobId),
          stylePrompt: value.stylePrompt,
          names: first?.name ? [first.name] : characters.slice(0, 1).map((character) => character.name),
          model,
        });
        if (customStyle) out = { ...value, customStyle };
      } else {
        const options = await Promise.all(
          value.characters.map(async (option) => {
            const character = characters.find((candidate) => candidate.id === option.id);
            if (!character || character.drawings.length === 0) return option;
            const customStyle = await saveReadLook({
              uid: req.uid!,
              project,
              hashes: character.drawings.map((drawing) => drawing.sha256),
              drawings: orderDrawings(character.drawings),
              stylePrompt: option.stylePrompt,
              names: [option.name],
              model,
            });
            return customStyle ? { ...option, customStyle } : option;
          }),
        );
        out = { ...value, characters: options };
      }
      res.json(out);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/ai/extract-art-look", json, async (req: AuthedRequest, res: Response) => {
    try {
      const { project } = req.body as { project: Project };
      const groups = collectSourceArtGroups(project);
      if (groups.length === 0) {
        res.status(400).json({ error: { message: "Add character artwork first." } });
        return;
      }
      const guest = isAnonymousToken(req.authToken);
      await ensureAffordAction(req.uid!, "extractArtLook", requireTier(undefined, guest), {
        noNegativeBuffer: guest,
      });
      const characters = await loadSourceArtCharacters(req.uid!, project);
      if (characters.length === 0) {
        res.status(400).json({ error: { message: "The artwork could not be loaded." } });
        return;
      }
      const [model, prompts] = await Promise.all([
        resolveText("extractArtLook"),
        loadPromptContext(),
      ]);
      const startedAt = Date.now();
      const { value, events, stats } = await withUsage(() =>
        extractArtLookFromImages({
          characters,
          creds: { apiKey: apiKeyFor(model.provider) },
          model: model.id,
          providerId: model.provider,
          prompts,
          signal: requestDeadline(),
        }),
        model.params,
      );
      await meterAndSettle({
        uid: req.uid!,
        action: "extractArtLook",
        events,
        stats,
        projectId: project.id,
        project,
        kind: "fresh",
        source: "sync",
        startedAt,
        models: { text: model },
      });
      res.json(value);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/ai/anchor-description", json, async (req: AuthedRequest, res: Response) => {
    try {
      const { project, anchorId } = req.body as { project: Project; anchorId: string };
      const anchor = project.anchors?.find((a) => a.id === anchorId);
      if (!anchor) {
        res.status(400).json({ error: { message: "Anchor not found." } });
        return;
      }
      const model = await resolveText("anchorDescription");
      const prompts = await loadPromptContext();
      const startedAt = Date.now();
      const { value, events, stats } = await withUsage(() =>
        generateAnchorDescription({
          story: project.config.storyText,
          config: withTextModel(project.config, model),
          creds: { apiKey: apiKeyFor(model.provider) },
          model: model.id,
          name: anchor.name,
          type: anchor.type,
          existingAnchors: (project.anchors ?? [])
            .filter((a) => a.id !== anchorId)
            .map((a) => ({ name: a.name, type: a.type, description: a.description })),
          prompts,
          signal: requestDeadline(),
        }),
        model.params,
      );
      await meterAndSettle({
        uid: req.uid!,
        action: "anchorDescription",
        events,
        stats,
        projectId: project.id,
        project,
        kind: "fresh",
        targetId: anchorId,
        source: "sync",
        startedAt,
        models: { text: model },
      });
      res.json({ description: value });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/ai/screenplay", json, async (req: AuthedRequest, res: Response) => {
    try {
      const { project, edit, previous } = req.body as {
        project: Project;
        edit?: string;
        previous?: ScreenplayDoc;
      };
      const [model, prompts] = await Promise.all([resolveText("screenplay"), loadPromptContext()]);
      const startedAt = Date.now();
      const { value, events, stats } = await withUsage(() =>
        generateScreenplay({
          config: withTextModel(project.config, model),
          anchors: project.anchors ?? [],
          creds: { apiKey: apiKeyFor(model.provider) },
          model: model.id,
          edit,
          previous,
          prompts,
          signal: requestDeadline(),
        }),
        model.params,
      );
      await meterAndSettle({
        uid: req.uid!,
        action: "screenplay",
        events,
        stats,
        projectId: project.id,
        project,
        kind: edit?.trim() ? "edit" : "fresh",
        source: "sync",
        startedAt,
        models: { text: model },
      });
      res.json(value);
    } catch (err) {
      sendError(res, err);
    }
  });

  /**
   * Read one chat message from the guided studio and return the facts it states.
   *
   * Server-side for the same reasons as every other AI call — the model comes from
   * the admin config, the key never leaves here, and usage is metered — plus one
   * specific to this route: the world the model is offered (age bands, art styles,
   * printable sizes) is read from the live config here, so a client cannot widen it
   * by claiming a band that no longer exists.
   *
   * It returns a PROPOSAL. The patch is applied on the client, through
   * `applyGuidePatch`, into the project the client already owns — this route never
   * writes a book. That keeps the single-writer rule intact (the client owns the
   * project document and its undo history) and means a bad interpretation costs a
   * rejected patch rather than a corrupted book.
   */
  app.post("/ai/guide/interpret", json, async (req: AuthedRequest, res: Response) => {
    try {
      const {
        project,
        message: rawMessage,
        transcript: rawTranscript,
        pending,
        marked: rawMarked,
        selected: rawSelected,
      } = req.body as {
        project: Project;
        message?: unknown;
        transcript?: unknown;
        pending?: unknown;
        marked?: unknown;
        selected?: unknown;
      };
      // What the reader has selected on the book ("Amanda's portrait"). Context
      // for "her" and "this" only, like the marked passage.
      const selected =
        typeof rawSelected === "string" && rawSelected.trim() ? rawSelected.trim().slice(0, 120) : undefined;
      // A marked passage is only believed when it is really in the story; the
      // model reads it to resolve "make this nicer", never to decide anything else.
      const marked =
        typeof rawMarked === "string" && rawMarked.trim() && project?.config?.storyText?.includes(rawMarked.trim())
          ? rawMarked.trim().slice(0, 1500)
          : undefined;
      const message = typeof rawMessage === "string" ? rawMessage.trim() : "";
      if (!message) {
        res.status(400).json({ error: { message: "There's no message to read." } });
        return;
      }
      const guide = await getGuideConfig();

      // Bounded before it reaches a prompt: an unbounded paste is a cost we'd pay
      // per turn. The ceiling is admin-set rather than a constant because the one
      // message we actively ask for — the parent's own story text, pasted — is
      // 40,000 characters, and a 2,000-character wall built for conversational
      // turns was rejecting it.
      if (message.length > guide.extraction.maxMessageChars) {
        res.status(400).json({ error: { message: "That message is too long to read at once." } });
        return;
      }

      // Free by default (every text action ships free), so there is no Spark gate
      // to hold the line here. This counter is the one that can, if an admin ever
      // needs it to — checked before the call so a refusal costs us nothing.
      await ensureWithinQuota(req.uid!, "guideTurnsPerBook", project.id);

      const [model, prompts, audience, artStyles, storyCraft] = await Promise.all([
        resolveText("guideInterpret"),
        loadPromptContext(),
        getAudienceConfig(),
        getArtStylesConfig(),
        getStoryCraftConfig(),
      ]);
      const playlist = resolveGuidePlaylist(guide.playlist);
      // The same context the browser will build when it applies the result. It has
      // to be, or the server's dry run clears a claim the client then refuses —
      // and the repair loop would be correcting against the wrong rules.
      const patchContext = guidePatchContext({ audience, artStyles, storyCraft });
      const startedAt = Date.now();
      const { value, events, stats } = await withUsage(() =>
        interpretGuideTurn({
          project,
          message,
          playlist,
          transcript: parseGuideTranscript(rawTranscript),
          patchContext,
          creds: { apiKey: apiKeyFor(model.provider) },
          model: model.id,
          providerId: model.provider,
          prompts,
          thresholds: guide.extraction.thresholds,
          repairAttempts: guide.extraction.repairAttempts,
          temperature: guide.extraction.temperature,
          ...(marked ? { marked } : {}),
          ...(selected ? { selected } : {}),
          ...(guide.agent.enabled
            ? {
                skills: {
                  enabled: enabledSkills(guide.agent),
                  floor: guide.agent.turn.commandFloor,
                  max: guide.agent.turn.maxCommands,
                  pending: typeof pending === "string" ? pending.slice(0, 300) : undefined,
                },
              }
            : {}),
          signal: requestDeadline(),
        }),
        model.params,
      );
      await meterAndSettle({
        uid: req.uid!,
        action: "guideInterpret",
        events,
        stats,
        projectId: project.id,
        project,
        kind: "fresh",
        source: "sync",
        startedAt,
        models: { text: model },
      });
      await incrementQuota(req.uid!, "guideTurnsPerBook", project.id);

      // Logged whatever came back, including the turns we failed to read — those
      // are the rows worth reading later. Best-effort: a log write must never cost
      // the reader their answer.
      const turnId = await recordGuideTurn({
        uid: req.uid!,
        projectId: project.id,
        message,
        componentId: activeComponentId(playlist, project),
        result: value,
        proposedSlots: patchedSlotIds(value.patch),
        model,
        latencyMs: Date.now() - startedAt,
      }).catch(() => null);

      res.json({ ...value, turnId });
    } catch (err) {
      sendError(res, err);
    }
  });

  /**
   * Admin "try it": read one sentence against a book with the guide settings AS
   * EDITED (the unsaved draft), and say which skills would run with which
   * arguments, which were refused and why. Nothing is written, logged, metered or
   * counted against a quota — the book is only read, and the result is not applied.
   * Admin-only; a customer gets the same refusal as for any admin route.
   */
  app.post("/ai/guide/try", json, async (req: AuthedRequest, res: Response) => {
    try {
      if (!(await isAdminUid(req.uid!))) {
        res.status(403).json({ error: { message: "Admins only." } });
        return;
      }
      const { project, message: rawMessage, draft } = req.body as {
        project: Project;
        message?: unknown;
        draft?: unknown;
      };
      const message = typeof rawMessage === "string" ? rawMessage.trim().slice(0, 2000) : "";
      if (!message || !project?.id) {
        res.status(400).json({ error: { message: "Pick a book and type a sentence." } });
        return;
      }
      const guide = draft ? normalizeGuideConfig(draft) : await getGuideConfig();
      const [model, prompts, audience, artStyles, storyCraft] = await Promise.all([
        resolveText("guideInterpret"),
        loadPromptContext(),
        getAudienceConfig(),
        getArtStylesConfig(),
        getStoryCraftConfig(),
      ]);
      const playlist = resolveGuidePlaylist(guide.playlist);
      const { value } = await withUsage(
        () =>
          interpretGuideTurn({
            project,
            message,
            playlist,
            transcript: [],
            patchContext: guidePatchContext({ audience, artStyles, storyCraft }),
            creds: { apiKey: apiKeyFor(model.provider) },
            model: model.id,
            providerId: model.provider,
            prompts,
            thresholds: guide.extraction.thresholds,
            repairAttempts: guide.extraction.repairAttempts,
            temperature: guide.extraction.temperature,
            ...(guide.agent.enabled
              ? {
                  skills: {
                    enabled: enabledSkills(guide.agent),
                    floor: guide.agent.turn.commandFloor,
                    max: guide.agent.turn.maxCommands,
                  },
                }
              : {}),
            signal: requestDeadline(),
          }),
        model.params,
      );
      res.json({
        skillsOn: guide.agent.enabled,
        intent: value.intent,
        reply: value.reply,
        confidence: value.confidence,
        commands: value.commands ?? [],
        overflowCommands: value.overflowCommands ?? [],
        refusedCommands: value.refusedCommands ?? [],
        facts: value.claims.map((c) => c.slot),
        refusedFacts: value.refused.length,
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  /**
   * What the browser did with the proposal it was given.
   *
   * Its own route because the answer is not known when the turn is answered: the
   * patch is applied client-side, against the live project. Without this, the log
   * holds only what the model suggested, and the question anyone actually has
   * — "did the parent's message end up in their book?" — cannot be asked of it.
   *
   * Cheap and unmetered. It writes four short arrays onto a row this user already
   * owns, keyed by an id the server minted for them, so there is nothing here to
   * ration and no other user's row to reach.
   */
  app.post("/ai/guide/outcome", json, async (req: AuthedRequest, res: Response) => {
    try {
      const { turnId, applied, unchanged, rejected, admittedFailure } = req.body as {
        turnId?: unknown;
        applied?: unknown;
        unchanged?: unknown;
        rejected?: unknown;
        admittedFailure?: unknown;
      };
      if (typeof turnId !== "string" || !turnId) {
        res.status(400).json({ error: { message: "No turn to report on." } });
        return;
      }
      const slots = (value: unknown): string[] =>
        Array.isArray(value)
          ? value.filter((id): id is string => typeof id === "string").slice(0, 24)
          : [];

      await recordGuideTurnOutcome({
        uid: req.uid!,
        turnId,
        outcome: {
          applied: slots(applied),
          unchanged: slots(unchanged),
          rejected: Array.isArray(rejected)
            ? rejected
                .filter(
                  (entry): entry is { key: string; reason: string } =>
                    !!entry &&
                    typeof entry === "object" &&
                    typeof (entry as { key?: unknown }).key === "string",
                )
                .map((entry) => ({ key: entry.key, reason: String(entry.reason ?? "") }))
                .slice(0, 24)
            : [],
          admittedFailure: admittedFailure === true,
        },
      });
      res.json({ ok: true });
    } catch (err) {
      sendError(res, err);
    }
  });

  /**
   * Something the reader did that is not a typed message — a tap, an undo, a price
   * shown, the order screen opened.
   *
   * The turn log only ever sees sentences, so a book answered by tapping was
   * invisible to every report. This is the other half. A closed list of kinds, a
   * flat bounded detail, a per-user rate ceiling, and an answer that is always
   * `ok` unless the request is malformed: telemetry must never be something the
   * reader can feel.
   */
  app.post("/ai/guide/event", json, async (req: AuthedRequest, res: Response) => {
    try {
      const { projectId, kind, detail } = (req.body ?? {}) as {
        projectId?: unknown;
        kind?: unknown;
        detail?: unknown;
      };
      if (typeof projectId !== "string" || !projectId || !isGuideEventKind(kind)) {
        res.status(400).json({ error: { message: "Nothing to record." } });
        return;
      }
      const kept = await recordGuideEvent({ uid: req.uid!, projectId, kind, detail });
      res.json({ ok: true, kept });
    } catch (err) {
      sendError(res, err);
    }
  });

  /**
   * Phrase the guide's configured lines in the reader's chat language.
   *
   * The configured sentence is the meaning; this only decides the words. Names
   * are passed separately and a phrasing that loses one falls back to the
   * meaning (`speakGuideLines`).
   */
  app.post("/ai/guide/speak", json, async (req: AuthedRequest, res: Response) => {
    try {
      const body = (req.body ?? {}) as {
        projectId?: unknown;
        language?: unknown;
        names?: unknown;
        lines?: unknown;
        mode?: unknown;
        open?: unknown;
        learned?: unknown;
        transcript?: unknown;
      };
      if (body.mode === "next") {
        const open = typeof body.open === "string" ? body.open.slice(0, 2000) : "";
        const learned = typeof body.learned === "string" ? body.learned.slice(0, 1000) : "";
        const transcript = typeof body.transcript === "string" ? body.transcript.slice(0, 4000) : "";
        if (typeof body.language !== "string" || !body.language.trim()) {
          res.status(400).json({ error: { message: "Nothing to say." } });
          return;
        }
        const [model, prompts] = await Promise.all([resolveText("guideSpeak"), loadPromptContext()]);
        const startedAt = Date.now();
        const { value, events, stats } = await withUsage(() =>
          askGuideNext({
            language: String(body.language).slice(0, 80),
            names: Array.isArray(body.names)
              ? body.names.filter((n): n is string => typeof n === "string").slice(0, 24)
              : [],
            learned,
            open,
            transcript,
            creds: { apiKey: apiKeyFor(model.provider) },
            model: model.id,
            providerId: model.provider,
            prompts,
            signal: requestDeadline(),
          }),
          model.params,
        );
        await meterAndSettle({
          uid: req.uid!,
          action: "guideSpeak",
          events,
          stats,
          ...(typeof body.projectId === "string" && body.projectId ? { projectId: body.projectId } : {}),
          kind: "fresh",
          source: "sync",
          startedAt,
          models: { text: model },
        });
        res.json(value);
        return;
      }
      const lines = Array.isArray(body.lines)
        ? body.lines
            .filter(
              (line): line is { id: string; meaning: string } =>
                !!line &&
                typeof (line as { id?: unknown }).id === "string" &&
                typeof (line as { meaning?: unknown }).meaning === "string",
            )
            .slice(0, 12)
            .map((line) => ({ id: line.id.slice(0, 60), meaning: line.meaning.slice(0, 1200) }))
        : [];
      if (typeof body.language !== "string" || !body.language.trim() || lines.length === 0) {
        res.status(400).json({ error: { message: "Nothing to say." } });
        return;
      }
      const [model, prompts] = await Promise.all([resolveText("guideSpeak"), loadPromptContext()]);
      const startedAt = Date.now();
      const { value, events, stats } = await withUsage(() =>
        speakGuideLines({
          language: String(body.language).slice(0, 80),
          names: Array.isArray(body.names)
            ? body.names.filter((n): n is string => typeof n === "string").slice(0, 24)
            : [],
          lines,
          creds: { apiKey: apiKeyFor(model.provider) },
          model: model.id,
          providerId: model.provider,
          prompts,
          signal: requestDeadline(),
        }),
        model.params,
      );
      await meterAndSettle({
        uid: req.uid!,
        action: "guideSpeak",
        events,
        stats,
        ...(typeof body.projectId === "string" && body.projectId ? { projectId: body.projectId } : {}),
        kind: "fresh",
        source: "sync",
        startedAt,
        models: { text: model },
      });
      res.json({ lines: value });
    } catch (err) {
      sendError(res, err);
    }
  });

  /**
   * Phrase one guide message in the persona and the chat language.
   *
   * The meanings are decided on the client from trusted beats; the persona and
   * style are read from the admin config here, so a client cannot restyle the
   * guide. The client validates the result (`validateComposed`) and shows the
   * configured wording when it fails.
   */
  app.post("/ai/guide/compose", json, async (req: AuthedRequest, res: Response) => {
    try {
      const body = (req.body ?? {}) as {
        projectId?: unknown;
        language?: unknown;
        locale?: unknown;
        names?: unknown;
        meanings?: unknown;
        transcript?: unknown;
      };
      const meanings = Array.isArray(body.meanings)
        ? body.meanings.filter((m): m is string => typeof m === "string" && Boolean(m.trim())).slice(0, 6).map((m) => m.slice(0, 600))
        : [];
      if (typeof body.language !== "string" || !body.language.trim() || meanings.length === 0) {
        res.status(400).json({ error: { message: "Nothing to say." } });
        return;
      }
      const guide = await getGuideConfig();
      if (!guide.agent.composer.enabled || !guide.agent.persona.enabled) {
        res.status(409).json({ error: { message: "The composer is off." } });
        return;
      }
      const [model, prompts] = await Promise.all([resolveText("guideCompose"), loadPromptContext()]);
      const startedAt = Date.now();
      const { value, events, stats } = await withUsage(
        () =>
          composeGuideMessage({
            language: String(body.language).slice(0, 80),
            locale: typeof body.locale === "string" ? body.locale.slice(0, 16) : "en-US",
            names: Array.isArray(body.names)
              ? body.names.filter((n): n is string => typeof n === "string").slice(0, 24)
              : [],
            meanings,
            transcript: typeof body.transcript === "string" ? body.transcript.slice(0, 3000) : "",
            persona: guide.agent.persona,
            style: guide.agent.style.lines,
            creds: { apiKey: apiKeyFor(model.provider) },
            model: model.id,
            providerId: model.provider,
            prompts,
            signal: requestDeadline(),
          }),
        model.params,
      );
      await meterAndSettle({
        uid: req.uid!,
        action: "guideCompose",
        events,
        stats,
        ...(typeof body.projectId === "string" && body.projectId ? { projectId: body.projectId } : {}),
        kind: "fresh",
        source: "sync",
        startedAt,
        models: { text: model },
      });
      res.json({ text: value });
    } catch (err) {
      sendError(res, err);
    }
  });

  /**
   * Answer a how-to question from the help articles and the book's state.
   * Never states prices; says it isn't sure when the sheet doesn't cover it.
   */
  app.post("/ai/guide/answer", json, async (req: AuthedRequest, res: Response) => {
    try {
      const body = (req.body ?? {}) as {
        project?: Project;
        question?: unknown;
        language?: unknown;
        locale?: unknown;
        transcript?: unknown;
      };
      const question = typeof body.question === "string" ? body.question.trim().slice(0, 800) : "";
      const project = body.project;
      if (!question || !project || typeof project !== "object") {
        res.status(400).json({ error: { message: "There's no question to answer." } });
        return;
      }
      const guide = await getGuideConfig();
      if (!guide.agent.enabled || !guide.agent.answers.enabled) {
        res.status(409).json({ error: { message: "Answers are off." } });
        return;
      }
      const [model, prompts] = await Promise.all([resolveText("guideAnswer"), loadPromptContext()]);
      const startedAt = Date.now();
      const guest = isAnonymousToken(req.authToken);
      const { value, events, stats } = await withUsage(
        () =>
          answerGuideQuestion({
            language: typeof body.language === "string" ? body.language.slice(0, 80) : "English (en-US)",
            locale: typeof body.locale === "string" ? body.locale.slice(0, 16) : "en-US",
            question,
            help: helpSheetText(resolveHelpArticles(guide.agent.help.articles)),
            skills: skillsHelpText(guide.agent),
            book: bookFactsText(project, guest),
            transcript: typeof body.transcript === "string" ? body.transcript.slice(0, 3000) : "",
            persona: guide.agent.persona,
            style: guide.agent.style.answers,
            creds: { apiKey: apiKeyFor(model.provider) },
            model: model.id,
            providerId: model.provider,
            prompts,
            signal: requestDeadline(),
          }),
        model.params,
      );
      await meterAndSettle({
        uid: req.uid!,
        action: "guideAnswer",
        events,
        stats,
        projectId: project.id,
        kind: "fresh",
        source: "sync",
        startedAt,
        models: { text: model },
      });
      res.json(value);
    } catch (err) {
      sendError(res, err);
    }
  });

  /**
   * Read who is in a manuscript the reader wrote or pasted. Returns names and
   * stated ages only; the story is never rewritten.
   */
  app.post("/ai/guide/extract-cast", json, async (req: AuthedRequest, res: Response) => {
    try {
      const body = (req.body ?? {}) as { projectId?: unknown; story?: unknown };
      const story = typeof body.story === "string" ? body.story.slice(0, OWN_WORDS_MAX_CHARS) : "";
      if (!story.trim()) {
        res.status(400).json({ error: { message: "There's no story to read yet." } });
        return;
      }
      const [model, prompts] = await Promise.all([resolveText("guideExtractCast"), loadPromptContext()]);
      const startedAt = Date.now();
      const { value, events, stats } = await withUsage(() =>
        extractManuscriptCast({
          story,
          creds: { apiKey: apiKeyFor(model.provider) },
          model: model.id,
          providerId: model.provider,
          prompts,
          signal: requestDeadline(),
        }),
        model.params,
      );
      await meterAndSettle({
        uid: req.uid!,
        action: "guideExtractCast",
        events,
        stats,
        ...(typeof body.projectId === "string" && body.projectId ? { projectId: body.projectId } : {}),
        kind: "fresh",
        source: "sync",
        startedAt,
        models: { text: model },
      });
      res.json(value);
    } catch (err) {
      sendError(res, err);
    }
  });

  // --- Image actions --------------------------------------------------------

  app.post("/ai/anchor-image", json, async (req: AuthedRequest, res: Response) => {
    try {
      const { project, anchorId, options, tier: rawTier } = req.body as {
        project: Project;
        anchorId: string;
        options?: AnchorRunOptions;
        tier?: string;
      };
      const anchor = project.anchors?.find((a) => a.id === anchorId);
      if (!anchor) {
        res.status(400).json({ error: { message: "Anchor not found." } });
        return;
      }
      // A saved custom style speaks for itself: the wording and drawing come
      // from the record, not from whatever the client sent next to the pointer.
      await applyCustomStyleToProject(req.uid!, project);
      // Guests receive the same production quality, with no negative buffer.
      const guest = isAnonymousToken(req.authToken);
      const tier = requireTier(rawTier, guest);
      const anchorIsEdit = typeof options?.edit === "string" && options.edit.trim().length > 0;
      const renderKind = runKindOf(options, anchorIsEdit);
      const hasPhoto =
        anchor.type === "character" && !anchor.versions
          ? await hasLikenessPhotoForSubject(req.uid!, project.id, anchorId).catch(() => false)
          : false;
      const referenceCount = plannedAnchorReferences(
        project,
        anchorId,
        { ...(options ?? {}), hasPhoto },
        await referenceLimitsForAction("anchorImage", tier),
      );
      const quotedSparks = await ensureAffordAction(req.uid!, "anchorImage", tier, {
        noNegativeBuffer: guest,
        kind: renderKind,
        referenceCount,
      });
      const [models, prompts, layouts, capabilities, generationTuning] = await Promise.all([
        resolveImageModels("anchorImage", tier),
        loadPromptContext(),
        getLayoutsConfig(),
        loadModelCapabilities(),
        getGenerationTuningConfig(),
      ]);
      const env = backendPipelineEnv(
        req.uid!,
        models,
        prompts,
        capabilities,
        layouts,
        generationTuning,
        "anchorImage",
      );
      const startedAt = Date.now();
      const { value, events, stats } = await withUsage(() =>
        renderAnchor(project, anchor, { ...(options ?? {}), signal: requestDeadline() }, env),
      );
      const estimateProfile = estimateProfileForAction({
        action: "anchorImage",
        tier,
        model: models.anchorImageModel,
        tuning: generationTuningFor(generationTuning, "anchorImage"),
        kind: renderKind,
      });
      await meterAndSettle({
        uid: req.uid!,
        action: "anchorImage",
        tier,
        events,
        stats,
        projectId: project.id,
        project,
        kind: renderKind,
        targetId: anchorId,
        source: "sync",
        quotedSparks,
        startedAt,
        models: { image: models.anchorImageModel, text: models.textModel },
        generation: value.generation,
        estimateProfile,
        inputReferenceCount: value.inputReferenceCount,
        outputSize: value.outputSize,
        latency: {
          profile: estimateProfile,
          refs:
            value.inputReferenceCount ??
            containedAnchorsFor(anchor, project.anchors ?? []).length,
        },
      });
      res.json(stampImageProvenance(value, tier, models.anchorImageModel));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/ai/illustration", json, async (req: AuthedRequest, res: Response) => {
    try {
      const { project, spreadId, options, tier: rawTier, coverContinuationBlobId } = req.body as {
        project: Project;
        spreadId: string;
        options?: IllustrationRunOptions;
        tier?: string;
        /**
         * Cover-pair generation only: blob id of the already-rendered FRONT
         * cover. When present, the back cover is rendered as a true outpaint
         * continuation of the front's real edge pixels (`renderCoverContinuation`)
         * instead of a normal `renderIllustration` call. Sent as its own
         * request (front, then back) rather than combined into one, so
         * neither render risks the function's timeout the way a single
         * "generate both" request used to.
         */
        coverContinuationBlobId?: string;
      };
      const spread = findSpread(project, spreadId);
      if (!spread) {
        res.status(400).json({ error: { message: "Spread not found." } });
        return;
      }
      const cover = isCoverId(spreadId);
      const action = cover ? "coverIllustration" : "pageIllustration";
      await applyCustomStyleToProject(req.uid!, project);
      // Guests receive the same production quality, with no negative buffer.
      const guest = isAnonymousToken(req.authToken);
      // A continuous back cover uses the same production-quality binding as
      // every other customer image.
      const tier = requireTier(rawTier, guest);
      // An "edit" is a re-roll carrying an instruction. These count against the
      // per-book edit quota (scoped to the project); fresh generations don't.
      const isEdit = typeof options?.edit === "string" && options.edit.trim().length > 0;
      if (isEdit) await ensureWithinQuota(req.uid!, "editsPerBook", project.id);
      // A manual mask is an edit for pricing too — it takes the same surgical
      // path, and `meterAndSettle` below already classifies it that way.
      const renderKind = generationRenderKindOf({
        ...options,
        continuation: Boolean(coverContinuationBlobId),
      });
      const referenceCount = plannedIllustrationReferences(
        project,
        spreadId,
        { ...(options ?? {}), masked: Boolean(options?.mask), continuation: Boolean(coverContinuationBlobId) },
        await referenceLimitsForAction(action, tier),
      );
      const printPrep = await printPrepDue(req.uid!, project, spreadId, action);
      const quotedSparks = await ensureAffordAction(req.uid!, action, tier, {
        noNegativeBuffer: guest,
        kind: renderKind,
        referenceCount,
        printPrep,
      });
      const printPrepSparks = printPrep
        ? await printPrepShare(req.uid!, action, tier, renderKind, referenceCount, quotedSparks)
        : 0;
      const [models, prompts, layouts, capabilities, generationTuning] = await Promise.all([
        resolveImageModels(cover ? "coverIllustration" : "pageIllustration", tier),
        loadPromptContext(),
        getLayoutsConfig(),
        loadModelCapabilities(),
        getGenerationTuningConfig(),
      ]);
      const env = backendPipelineEnv(
        req.uid!,
        models,
        prompts,
        capabilities,
        layouts,
        generationTuning,
        action,
      );
      const startedAt = Date.now();
      const { value, events, stats } = await withUsage(async () => {
        const signal = requestDeadline();
        if (coverContinuationBlobId) {
          const front = await env.loadBlob(coverContinuationBlobId);
          if (!front) throw new Error("The front cover couldn't be loaded for continuation.");
          return renderCoverContinuation(project, spread, front, env, { signal });
        }
        return renderIllustration(project, spread, { ...(options ?? {}), signal }, env);
      });
      const estimateProfile = estimateProfileForAction({
        action,
        tier,
        model: models.imageModel,
        tuning: generationTuningFor(generationTuning, action),
        kind: renderKind,
      });
      await meterAndSettle({
        uid: req.uid!,
        action,
        tier,
        events,
        stats,
        projectId: project.id,
        project,
        // A manual mask is an edit for both pricing history and bucketing.
        kind: renderKind,
        targetId: spreadId,
        source: "sync",
        quotedSparks,
        ...(printPrep ? { printPrep: { slotId: spreadId, sparks: printPrepSparks } } : {}),
        startedAt,
        models: { image: models.imageModel, text: models.textModel },
        generation: value?.generation,
        estimateProfile,
        inputReferenceCount: value?.inputReferenceCount,
        outputSize: value?.outputSize,
        ...(value
          ? {
              latency: {
                profile: estimateProfile,
                refs:
                  value.inputReferenceCount ??
                  effectiveAnchorIds(project.anchors, spread).length,
              },
            }
          : {}),
      });
      if (isEdit) await incrementQuota(req.uid!, "editsPerBook", project.id);
      if (value) {
        if (spreadId === COVER_FRONT_ID && value.artStyleKey && !coverContinuationBlobId) {
          await captureStyleCover(req.uid!, {
            style: project.config.artStyle,
            projectId: project.id,
            blobId: value.blobId,
          });
        }
        res.json(stampImageProvenance(value, tier, models.imageModel));
        return;
      }
      res.json(value);
    } catch (err) {
      sendError(res, err);
    }
  });

  // --- Pricing ---------------------------------------------------------------

  /**
   * The standing campaign price overrides that apply to THIS caller.
   *
   * Everything else the studio needs to quote a render is world-readable config
   * it already subscribes to (the Sparks peg, the cost table, the recent-cost
   * window, the plan's own multiplier). Campaign overrides are the exception:
   * they depend on audience eligibility, which is evaluated against account
   * facts the client can't see. Without this the studio quoted the undiscounted
   * price all the way through a "renders are free this week" promotion, while
   * the wallet charged the discounted one — the exact quote/charge split
   * `campaigns/pricing.ts` exists to prevent, just pointing the other way.
   *
   * Soft-fails to "no overrides": a price preview that can't load must show the
   * normal price, never block generation.
   */
  app.get("/ai/price-overrides", async (req: AuthedRequest, res: Response) => {
    try {
      res.json({ actions: await standingPriceOverrides(req.uid!, ALL_IMAGE_ACTION_IDS) });
    } catch (err) {
      console.warn("[ai] price overrides failed", err);
      res.json({ actions: {} });
    }
  });

  // --- Project mirror --------------------------------------------------------

  /**
   * Register a project with the backend and report where the user is in it.
   *
   * Books are created and progressed entirely client-side, so without this a
   * project only becomes visible to analysis once it makes its first AI call —
   * which hides exactly the projects that matter most: the abandoned ones. The
   * client calls this on create and on stage changes. Everything it sends is
   * stored as untrusted `reported` data; the money numbers still come only from
   * what the backend metered itself.
   */
  app.post("/ai/project-touch", json, async (req: AuthedRequest, res: Response) => {
    try {
      const { projectId, stage, title, previewed, reached } = req.body as {
        projectId?: string;
        stage?: string;
        title?: string;
        previewed?: unknown;
        reached?: unknown;
      };
      if (!projectId) {
        res.status(400).json({ error: { message: "projectId is required." } });
        return;
      }
      await touchProject({
        uid: req.uid!,
        projectId,
        stage,
        title,
        ...(previewed === true ? { previewed: true } : {}),
        // Same rule: only milestones a browser is allowed to name.
        ...(isClientMilestone(reached) ? { reached } : {}),
      });
      res.json({ ok: true });
    } catch (err) {
      sendError(res, err);
    }
  });
}

/** Resolve a spread (or a cover pseudo-spread) from the project snapshot. */
function findSpread(project: Project, spreadId: string): ScreenplaySpread | undefined {
  const doc = project.screenplay ? currentScreenplay(project) : undefined;
  if (!doc) return undefined;
  const direct = doc.spreads.find((s) => s.id === spreadId);
  if (direct) return direct;
  // Covers/spine are rendered through the same pipeline as a synthetic spread.
  if (spreadId === COVER_FRONT_ID && doc.frontCover) {
    return coverSpread(spreadId, doc.frontCover, project);
  }
  if (spreadId === COVER_BACK_ID && doc.backCover) {
    return coverSpread(spreadId, doc.backCover, project);
  }
  return undefined;
}

function currentScreenplay(project: Project): ScreenplayDoc | undefined {
  const tree = project.screenplay;
  if (!tree) return undefined;
  const node = tree.nodes[tree.cursorId];
  return node?.content;
}
