import { randomUUID } from "node:crypto";
import express, { type Express, type Request, type Response } from "express";
import { getFirestore } from "firebase-admin/firestore";
import { z } from "zod";
import { GUIDE_SLOT_IDS } from "../../books-frontend/src/core/guide/slots";
import type { AuthedRequest } from "./auth";
import { interpretGuideTurn } from "../../books-frontend/src/core/pipeline/guideInterpret";
import { guidePatchContext } from "../../books-frontend/src/core/guide/patch";
import { resolveGuidePlaylist } from "../../books-frontend/src/core/guide/playlist";
import type { Project } from "../../books-frontend/src/core/types";
import {
  getArtStylesConfig,
  getAudienceConfig,
  getGuideConfig,
  getStoryCraftConfig,
  loadPromptContext,
} from "./appConfig";
import { apiKeyFor, resolveTextAction } from "./modelResolve";

const exampleSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  componentId: z.string().trim().min(1).max(80).nullable().optional(),
  expectedClaims: z.array(z.object({
    slot: z.enum(GUIDE_SLOT_IDS),
    value: z.unknown(),
  })).max(24),
  note: z.string().trim().max(1000).optional(),
  sourceUid: z.string().min(1).max(128),
  projectId: z.string().min(1).max(200),
});

const dryRunSchema = z.object({
  uid: z.string().min(1).max(128),
  projectId: z.string().min(1).max(200),
  message: z.string().trim().min(1).max(50_000),
});

type Population = "all" | "low-confidence" | "rejected" | "unhandled" | "self-repeat";

function inPopulation(row: Record<string, unknown>, population: Population): boolean {
  if (population === "all") return true;
  if (population === "low-confidence") return Number(row.confidence ?? 1) < 0.7;
  if (population === "rejected") {
    return Array.isArray(row.refused) && row.refused.length > 0 ||
      Array.isArray((row.outcome as { rejected?: unknown[] } | undefined)?.rejected) &&
      ((row.outcome as { rejected?: unknown[] }).rejected?.length ?? 0) > 0;
  }
  if (population === "unhandled") return Array.isArray(row.unhandled) && row.unhandled.length > 0;
  const outcome = row.outcome as { applied?: unknown[]; unchanged?: unknown[] } | undefined;
  return Boolean(
    outcome &&
      (outcome.applied?.length ?? 0) === 0 &&
      (outcome.unchanged?.length ?? 0) > 0,
  );
}

export function registerGuideAnalysisRoutes(app: Express): void {
  app.get("/admin/analytics/guide-turns", async (req: Request, res: Response) => {
    const requested = String(req.query.population ?? "all");
    const population: Population = [
      "all",
      "low-confidence",
      "rejected",
      "unhandled",
      "self-repeat",
    ].includes(requested) ? requested as Population : "all";
    const snapshot = await getFirestore()
      .collectionGroup("guideTurns")
      .orderBy("createdAt", "desc")
      .limit(250)
      .get();
    const rows = snapshot.docs
      .map((doc) => ({
        id: doc.id,
        uid: doc.ref.parent.parent?.id ?? null,
        ...doc.data(),
      }))
      .filter((row) => inPopulation(row, population))
      .slice(0, 100);
    res.json({ population, rows });
  });

  app.post("/admin/analytics/guide-examples", express.json({ limit: "64kb" }), async (req: AuthedRequest, res: Response) => {
    const parsed = exampleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { message: "The reviewed Guide example is invalid." } });
      return;
    }
    const id = randomUUID();
    await getFirestore().doc(`appConfig/guideEval/examples/${id}`).set({
      ...parsed.data,
      id,
      reviewed: true,
      createdAt: Date.now(),
      createdBy: req.uid,
    });
    res.status(201).json({ id });
  });

  app.post("/admin/analytics/guide-dry-run", express.json({ limit: "128kb" }), async (req: Request, res: Response) => {
    const parsed = dryRunSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { message: "The dry-run request is invalid." } });
      return;
    }
    const snapshot = await getFirestore()
      .doc(`users/${parsed.data.uid}/projects/${parsed.data.projectId}`)
      .get();
    if (!snapshot.exists) {
      res.status(404).json({ error: { message: "The source book no longer exists." } });
      return;
    }
    const project = snapshot.data() as Project;
    const [guide, model, prompts, audience, artStyles, storyCraft] =
      await Promise.all([
        getGuideConfig(),
        resolveTextAction("guideInterpret"),
        loadPromptContext(),
        getAudienceConfig(),
        getArtStylesConfig(),
        getStoryCraftConfig(),
      ]);
    const value = await interpretGuideTurn({
      project,
      message: parsed.data.message,
      playlist: resolveGuidePlaylist(guide.playlist),
      patchContext: guidePatchContext({ audience, artStyles, storyCraft }),
      creds: { apiKey: apiKeyFor(model.provider) },
      model: model.id,
      providerId: model.provider,
      prompts,
      thresholds: guide.extraction.thresholds,
      repairAttempts: guide.extraction.repairAttempts,
      temperature: guide.extraction.temperature,
    });
    res.json(value);
  });
}
