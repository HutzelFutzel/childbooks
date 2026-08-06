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
 * too (low-friction trial), but with guest limits: forced "quick" tier and no
 * negative-balance buffer, so a guest can never spend past their granted Sparks.
 */
import express, { type Express, type Response } from "express";
import { isAnonymousToken, type AuthedRequest } from "./auth";
import { backendPipelineEnv } from "./pipelineEnv";
import { recordUsage, withUsage } from "./usage";
import { ensureAffordAction, InsufficientSparks, settleActionCost } from "./sparks";
import { ensureWithinQuota, incrementQuota, QuotaExceeded } from "./quotas";
import {
  apiKeyFor,
  ImageTierRequired,
  requireTier,
  resolveImageModels,
  resolveTextAction,
  ServiceUnavailable,
} from "./modelResolve";
import { analyzeStory, generateAnchorDescription } from "../../books-frontend/src/core/pipeline/analysis";
import { generateStoryDraft } from "../../books-frontend/src/core/pipeline/storyDraft";
import { checkStoryFit } from "../../books-frontend/src/core/pipeline/storyFit";
import {
  briefBlockers,
  isBriefReady,
  storyBriefSchema,
} from "../../books-frontend/src/core/story/brief";
import { generateScreenplay } from "../../books-frontend/src/core/pipeline/screenplay";
import { renderAnchor, type AnchorRunOptions } from "../../books-frontend/src/core/pipeline/anchorRun";
import {
  renderCoverContinuation,
  renderIllustration,
  type IllustrationRunOptions,
} from "../../books-frontend/src/core/pipeline/illustrationRun";
import { stampImageProvenance } from "../../books-frontend/src/core/pipeline/imageProvenance";
import { IntentAmbiguousError } from "../../books-frontend/src/core/pipeline/intentResolve";
import { loadModelCapabilities, loadPromptContext } from "./appConfig";
import { latencyKindOf, recordTaskLatency } from "./latency";
import { containedAnchorsFor } from "../../books-frontend/src/core/book/anchorGraph";
import { effectiveAnchorIds } from "../../books-frontend/src/core/book/anchorRefs";
import {
  COVER_BACK_ID,
  COVER_FRONT_ID,
  SPINE_ID,
  type BookConfig,
  type ModelSelection,
  type Project,
  type ScreenplayDoc,
  type ScreenplaySpread,
  type StoryBrief,
} from "../../books-frontend/src/core/types";

const resolveText = resolveTextAction;

function withTextModel(config: BookConfig, model: ModelSelection): BookConfig {
  return { ...config, textModel: model };
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
  if (err instanceof ImageTierRequired) {
    // 400 — the client's tier gate should have caught this; say so plainly
    // rather than silently rendering at a quality the user never chose.
    res.status(400).json({ error: { message: err.message, code: "image_tier_required" } });
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
      const brief = parsed.data as StoryBrief;
      if (brief.mode === "own") {
        res.status(400).json({ error: { message: "This mode writes its own story." } });
        return;
      }
      if (!isBriefReady(brief)) {
        res.status(400).json({
          error: { message: briefBlockers(brief)[0] ?? "The story brief is incomplete." },
        });
        return;
      }
      const [model, prompts] = await Promise.all([resolveText("storyDraft"), loadPromptContext()]);
      const { value, events, stats } = await withUsage(() =>
        generateStoryDraft({
          brief,
          config: withTextModel(project.config, model),
          creds: { apiKey: apiKeyFor(model.provider) },
          model: model.id,
          prompts,
        }),
      );
      await recordUsage(req.uid!, "storyDraft", events, undefined, {
        projectId: project.id,
        stats,
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
      const { value, events, stats } = await withUsage(() =>
        checkStoryFit({
          story,
          config: withTextModel(project.config, model),
          creds: { apiKey: apiKeyFor(model.provider) },
          model: model.id,
          prompts,
        }),
      );
      await recordUsage(req.uid!, "storyCheck", events, undefined, {
        projectId: project.id,
        stats,
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
      const { value, events, stats } = await withUsage(() =>
        analyzeStory({
          story: project.config.storyText,
          config: withTextModel(project.config, model),
          creds: { apiKey: apiKeyFor(model.provider) },
          model: model.id,
          prompts,
        }),
      );
      await recordUsage(req.uid!, "storyAnalysis", events, undefined, {
        projectId: project.id,
        stats,
      });
      res.json({ ...value, model: model.id });
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
        }),
      );
      await recordUsage(req.uid!, "anchorDescription", events, undefined, {
        projectId: project.id,
        stats,
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
      const { value, events, stats } = await withUsage(() =>
        generateScreenplay({
          config: withTextModel(project.config, model),
          anchors: project.anchors ?? [],
          creds: { apiKey: apiKeyFor(model.provider) },
          model: model.id,
          edit,
          previous,
          prompts,
        }),
      );
      await recordUsage(req.uid!, "screenplay", events, undefined, {
        projectId: project.id,
        stats,
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
      // Guests render on the cheap tier only and get no negative buffer.
      const guest = isAnonymousToken(req.authToken);
      const tier = requireTier(rawTier, guest);
      await ensureAffordAction(req.uid!, "anchorImage", tier, { noNegativeBuffer: guest });
      const [models, prompts, caps] = await Promise.all([
        resolveImageModels("anchorImage", tier),
        loadPromptContext(),
        loadModelCapabilities(),
      ]);
      const env = backendPipelineEnv(req.uid!, models, prompts, caps);
      const startedAt = Date.now();
      const { value, events, stats } = await withUsage(() =>
        renderAnchor(project, anchor, options ?? {}, env),
      );
      const isAnchorEdit = typeof options?.edit === "string" && options.edit.trim().length > 0;
      await recordUsage(req.uid!, "anchorImage", events, tier, {
        projectId: project.id,
        isEdit: isAnchorEdit,
        stats,
      });
      await settleActionCost(req.uid!, "anchorImage", events, { projectId: project.id });
      // Feed the rolling latency window that powers client time estimates.
      await recordTaskLatency(
        "anchorImage",
        tier,
        latencyKindOf(options),
        containedAnchorsFor(anchor, project.anchors ?? []).length,
        Date.now() - startedAt,
      );
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
      // Guests render on the cheap tier only and get no negative buffer.
      const guest = isAnonymousToken(req.authToken);
      // A genuinely continuous back cover needs a mask-capable model, which
      // only the premium tier offers (see `renderCoverContinuation`) — force
      // it regardless of what the client asked for. Guests still get their
      // usual tier from `requireTier`; the render then fails with a clear
      // message rather than silently falling back to a lesser result.
      const tier =
        coverContinuationBlobId && !guest ? "premium" : requireTier(rawTier, guest);
      // An "edit" is a re-roll carrying an instruction. These count against the
      // per-book edit quota (scoped to the project); fresh generations don't.
      const isEdit = typeof options?.edit === "string" && options.edit.trim().length > 0;
      if (isEdit) await ensureWithinQuota(req.uid!, "editsPerBook", project.id);
      await ensureAffordAction(req.uid!, action, tier, { noNegativeBuffer: guest });
      const [models, prompts, caps] = await Promise.all([
        resolveImageModels(cover ? "coverIllustration" : "pageIllustration", tier),
        loadPromptContext(),
        loadModelCapabilities(),
      ]);
      const env = backendPipelineEnv(req.uid!, models, prompts, caps);
      const startedAt = Date.now();
      const { value, events, stats } = await withUsage(async () => {
        if (coverContinuationBlobId) {
          const front = await env.loadBlob(coverContinuationBlobId);
          if (!front) throw new Error("The front cover couldn't be loaded for continuation.");
          return renderCoverContinuation(project, spread, front, env, {
            signal: undefined,
          });
        }
        return renderIllustration(project, spread, options ?? {}, env);
      });
      await recordUsage(req.uid!, action, events, tier, {
        projectId: project.id,
        isEdit: isEdit || Boolean(options?.mask),
        stats,
      });
      await settleActionCost(req.uid!, action, events, { projectId: project.id });
      if (isEdit) await incrementQuota(req.uid!, "editsPerBook", project.id);
      // Feed the rolling latency window that powers client time estimates.
      // A manual mask is an edit for bucketing purposes.
      if (value) {
        await recordTaskLatency(
          action,
          tier,
          options?.mask ? "edit" : latencyKindOf(options),
          effectiveAnchorIds(project.anchors, spread).length,
          Date.now() - startedAt,
        );
        res.json(stampImageProvenance(value, tier, models.imageModel));
        return;
      }
      res.json(value);
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
    // The project title is the single source of truth for the front-cover title.
    return coverSpread(spreadId, doc.frontCover, project.title);
  }
  if (spreadId === COVER_BACK_ID && doc.backCover) {
    return coverSpread(spreadId, doc.backCover);
  }
  return undefined;
}

function coverSpread(
  id: string,
  cover: NonNullable<ScreenplayDoc["frontCover"]>,
  frontTitleOverride?: string,
): ScreenplaySpread {
  // Front covers show the book's real title; back covers use their blurb.
  const title = (frontTitleOverride ?? cover.title ?? "").trim();
  const bake = Boolean(cover.bakeText && title);
  return {
    id,
    kind: "single",
    text: cover.title ?? "",
    illustration: cover.illustration,
    layoutNote: bake
      ? "Cover art with the title typography integrated into the artwork."
      : "",
    anchorIds: cover.anchorIds,
    anchorNames: cover.anchorNames,
    textMode: bake ? "in-image" : undefined,
    ...(bake
      ? {
          bakeText: true,
          coverTitle: title,
          coverSubtitle: cover.subtitle,
          coverAuthor: cover.author,
        }
      : {}),
  };
}

function currentScreenplay(project: Project): ScreenplayDoc | undefined {
  const tree = project.screenplay;
  if (!tree) return undefined;
  const node = tree.nodes[tree.cursorId];
  return node?.content;
}
