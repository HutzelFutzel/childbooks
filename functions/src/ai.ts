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
 * Mounted under `/ai`, guarded by `requireVerified` in `app.ts`.
 */
import express, { type Express, type Response } from "express";
import type { AuthedRequest } from "./auth";
import { backendPipelineEnv } from "./pipelineEnv";
import { recordUsage, withUsage } from "./usage";
import { ensureAffordAction, InsufficientSparks, settleActionCost } from "./sparks";
import { ensureWithinQuota, incrementQuota, QuotaExceeded } from "./quotas";
import {
  apiKeyFor,
  resolveImageModels,
  resolveTextAction,
  ServiceUnavailable,
} from "./modelResolve";
import { normalizeImageTier } from "../../books-frontend/src/core/config/modelConfig";
import { analyzeStory, generateAnchorDescription } from "../../books-frontend/src/core/pipeline/analysis";
import { generateScreenplay } from "../../books-frontend/src/core/pipeline/screenplay";
import { renderAnchor, type AnchorRunOptions } from "../../books-frontend/src/core/pipeline/anchorRun";
import {
  renderIllustration,
  type IllustrationRunOptions,
} from "../../books-frontend/src/core/pipeline/illustrationRun";
import { IntentAmbiguousError } from "../../books-frontend/src/core/pipeline/intentResolve";
import { loadPromptContext } from "./appConfig";
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
      const tier = normalizeImageTier(rawTier);
      await ensureAffordAction(req.uid!, "anchorImage", tier);
      const [models, prompts] = await Promise.all([
        resolveImageModels("anchorImage", tier),
        loadPromptContext(),
      ]);
      const env = backendPipelineEnv(req.uid!, models, prompts);
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
      res.json(value);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/ai/illustration", json, async (req: AuthedRequest, res: Response) => {
    try {
      const { project, spreadId, options, tier: rawTier } = req.body as {
        project: Project;
        spreadId: string;
        options?: IllustrationRunOptions;
        tier?: string;
      };
      const spread = findSpread(project, spreadId);
      if (!spread) {
        res.status(400).json({ error: { message: "Spread not found." } });
        return;
      }
      const cover = isCoverId(spreadId);
      const action = cover ? "coverIllustration" : "pageIllustration";
      const tier = normalizeImageTier(rawTier);
      // An "edit" is a re-roll carrying an instruction. These count against the
      // per-book edit quota (scoped to the project); fresh generations don't.
      const isEdit = typeof options?.edit === "string" && options.edit.trim().length > 0;
      if (isEdit) await ensureWithinQuota(req.uid!, "editsPerBook", project.id);
      await ensureAffordAction(req.uid!, action, tier);
      const [models, prompts] = await Promise.all([
        resolveImageModels(cover ? "coverIllustration" : "pageIllustration", tier),
        loadPromptContext(),
      ]);
      const env = backendPipelineEnv(req.uid!, models, prompts);
      const startedAt = Date.now();
      const { value, events, stats } = await withUsage(() =>
        renderIllustration(project, spread, options ?? {}, env),
      );
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
    return coverSpread(spreadId, doc.frontCover);
  }
  if (spreadId === COVER_BACK_ID && doc.backCover) {
    return coverSpread(spreadId, doc.backCover);
  }
  return undefined;
}

function coverSpread(
  id: string,
  cover: NonNullable<ScreenplayDoc["frontCover"]>,
): ScreenplaySpread {
  return {
    id,
    kind: "single",
    text: cover.title ?? "",
    illustration: cover.illustration,
    layoutNote: "",
    anchorIds: cover.anchorIds,
    anchorNames: cover.anchorNames,
  };
}

function currentScreenplay(project: Project): ScreenplayDoc | undefined {
  const tree = project.screenplay;
  if (!tree) return undefined;
  const node = tree.nodes[tree.cursorId];
  return node?.content;
}
