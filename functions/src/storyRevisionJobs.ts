import crypto from "node:crypto";
import express, { type Express, type Response } from "express";
import { getFirestore, type DocumentReference } from "firebase-admin/firestore";
import { getFunctions } from "firebase-admin/functions";
import { logger } from "firebase-functions/v2";
import { onTaskDispatched } from "firebase-functions/v2/tasks";
import type { AuthedRequest } from "./auth";
import { isAnonymousToken } from "./auth";
import { loadPromptContext } from "./appConfig";
import { meterAndSettle } from "./actionRun";
import { apiKeyFor, resolveTextAction } from "./modelResolve";
import { ensureAffordAction, InsufficientSparks } from "./sparks";
import { ensureAdmin } from "./storage";
import { ALL_SECRETS } from "./secrets";
import { withUsage } from "./usage";
import {
  reviseStory,
  StoryRevisionFormatError,
} from "../../books-frontend/src/core/pipeline/storyRevision";
import {
  storyTextHash,
  type StoryRevisionDecision,
  type StoryRevisionJob,
  type StoryRevisionSelection,
} from "../../books-frontend/src/core/story/revision";
import type { Project } from "../../books-frontend/src/core/types";

const QUEUE = "runStoryRevisionJob";
const CLAIM_MS = 210_000;
const ACTIVE = new Set<StoryRevisionJob["status"]>(["pending", "running", "ready"]);
const TERMINAL = new Set<StoryRevisionJob["status"]>(["ready", "error", "applied", "discarded"]);

function revisions(uid: string) {
  return getFirestore().collection(`users/${uid}/storyRevisions`);
}

function revisionRef(uid: string, id: string): DocumentReference {
  return revisions(uid).doc(id);
}

function clientError(res: Response, message: string, status = 400, extra?: object): void {
  res.status(status).json({ error: { message, ...extra } });
}

function parseSelection(story: string, value: unknown): StoryRevisionSelection | undefined {
  if (value == null) return undefined;
  const raw = value as Partial<StoryRevisionSelection>;
  if (!Number.isInteger(raw.start) || !Number.isInteger(raw.end)) {
    throw new Error("The selected passage is invalid.");
  }
  const start = Number(raw.start);
  const end = Number(raw.end);
  if (start < 0 || end <= start || end > story.length || story.slice(start, end) !== raw.text) {
    throw new Error("The selected passage no longer matches the manuscript.");
  }
  return { start, end, text: story.slice(start, end) };
}

async function dispatch(uid: string, jobId: string): Promise<void> {
  if (process.env.FUNCTIONS_EMULATOR === "true") {
    void runRevision(uid, jobId).catch((err) =>
      logger.error("[story-revision] inline job failed", { jobId, err: String(err) }),
    );
    return;
  }
  await getFunctions().taskQueue(QUEUE).enqueue({ uid, jobId });
}

export function registerStoryRevisionRoutes(app: Express): void {
  const json = express.json({ limit: "2mb" });

  app.post("/ai/story-revisions", json, async (req: AuthedRequest, res: Response) => {
    try {
      ensureAdmin();
      const uid = req.uid!;
      const body = (req.body ?? {}) as {
        project?: Project;
        instruction?: string;
        selection?: StoryRevisionSelection;
      };
      const project = body.project;
      const instruction = body.instruction?.trim() ?? "";
      const story = project?.config?.storyText ?? "";
      if (!project?.id || !project.config || story.trim().length < 20) {
        clientError(res, "Write a story before asking for a revision.");
        return;
      }
      if (!instruction || instruction.length > 1200) {
        clientError(res, "Describe the change in 1–1,200 characters.");
        return;
      }
      const selection = parseSelection(story, body.selection);

      const existing = await revisions(uid).where("projectId", "==", project.id).get();
      const active = existing.docs
        .map((doc) => ({ id: doc.id, ...(doc.data() as StoryRevisionJob) }))
        .filter((job) => ACTIVE.has(job.status))
        .sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (active) {
        clientError(res, "Finish the current revision before starting another.", 409, {
          revisionId: active.id,
        });
        return;
      }

      const quotedSparks = await ensureAffordAction(uid, "storyEdit", "quick", {
        noNegativeBuffer: isAnonymousToken(req.authToken),
      });
      const id = crypto.randomUUID();
      const now = Date.now();
      const job: StoryRevisionJob = {
        projectId: project.id,
        config: project.config,
        baseStory: story,
        baseHash: storyTextHash(story),
        instruction,
        ...(selection ? { selection } : {}),
        status: "pending",
        quotedSparks,
        createdAt: now,
        updatedAt: now,
      };
      await revisionRef(uid, id).set(job);
      try {
        await dispatch(uid, id);
      } catch (err) {
        await revisionRef(uid, id).update({
          status: "error",
          error: "The revision could not be queued. Please try again.",
          updatedAt: Date.now(),
        });
        throw err;
      }
      res.json({ revisionId: id });
    } catch (err) {
      logger.error("[story-revision] start failed", err);
      const message = (err as Error)?.message ?? "The revision could not be started.";
      if (err instanceof InsufficientSparks) {
        res.status(402).json({
          error: {
            message,
            code: "insufficient_sparks",
            balance: err.balance,
            needed: err.needed,
          },
        });
        return;
      }
      clientError(res, message, 500);
    }
  });

  app.patch("/ai/story-revisions/:id", json, async (req: AuthedRequest, res: Response) => {
    try {
      ensureAdmin();
      const ref = revisionRef(req.uid!, req.params.id);
      const snap = await ref.get();
      const job = snap.data() as StoryRevisionJob | undefined;
      if (!job) {
        clientError(res, "Unknown story revision.", 404);
        return;
      }
      const body = (req.body ?? {}) as {
        decisions?: Record<string, StoryRevisionDecision>;
        decisionContexts?: Record<string, string>;
        status?: "applied" | "discarded";
        resultHash?: string;
      };
      const patch: Partial<StoryRevisionJob> = { updatedAt: Date.now() };

      if (body.decisions) {
        if (job.status !== "ready" || !job.proposal) {
          clientError(res, "This revision is not ready to review.", 409);
          return;
        }
        const ids = new Set(job.proposal.changes.map((change) => change.id));
        const decisions: Record<string, StoryRevisionDecision> = {};
        for (const [id, decision] of Object.entries(body.decisions)) {
          if (!ids.has(id) || (decision !== "accepted" && decision !== "rejected")) {
            clientError(res, "A review decision is invalid.");
            return;
          }
          decisions[id] = decision;
        }
        patch.decisions = { ...(job.decisions ?? {}), ...decisions };
        if (body.decisionContexts) {
          const contexts: Record<string, string> = {};
          for (const [id, context] of Object.entries(body.decisionContexts)) {
            if (!ids.has(id) || typeof context !== "string" || context.length > 64) {
              clientError(res, "A review decision context is invalid.");
              return;
            }
            contexts[id] = context;
          }
          patch.decisionContexts = {
            ...(job.decisionContexts ?? {}),
            ...contexts,
          };
        }
      }

      if (body.status) {
        if (!ACTIVE.has(job.status) && job.status !== "error") {
          clientError(res, "This revision is already finished.", 409);
          return;
        }
        if (body.status === "applied" && (job.status !== "ready" || !body.resultHash)) {
          clientError(res, "A revision can only be applied after review.", 409);
          return;
        }
        patch.status = body.status;
        if (body.status === "applied") patch.resultHash = body.resultHash;
      }

      if (!body.decisions && !body.status) {
        clientError(res, "Nothing to update.");
        return;
      }
      await ref.update(patch);
      res.json({ ok: true });
    } catch (err) {
      logger.error("[story-revision] update failed", err);
      clientError(res, "The revision state could not be saved.", 500);
    }
  });
}

class RevisionBusy extends Error {}

async function claim(ref: DocumentReference): Promise<StoryRevisionJob | null> {
  return getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const job = snap.data() as StoryRevisionJob | undefined;
    if (!job || TERMINAL.has(job.status)) return null;
    const now = Date.now();
    if (job.status === "running" && (job.claimedUntil ?? 0) > now) {
      throw new RevisionBusy("Story revision is already running.");
    }
    tx.update(ref, { status: "running", claimedUntil: now + CLAIM_MS, updatedAt: now });
    return { ...job, status: "running", claimedUntil: now + CLAIM_MS };
  });
}

async function runRevision(uid: string, jobId: string): Promise<void> {
  ensureAdmin();
  const ref = revisionRef(uid, jobId);
  let job: StoryRevisionJob | null;
  try {
    job = await claim(ref);
  } catch (err) {
    if (err instanceof RevisionBusy) throw err;
    throw err;
  }
  if (!job) return;

  const startedAt = Date.now();
  try {
    const [model, prompts] = await Promise.all([resolveTextAction("storyEdit"), loadPromptContext()]);
    const { value: proposal, events, stats } = await withUsage(() =>
      reviseStory({
        config: { ...job!.config, textModel: model },
        story: job!.baseStory,
        instruction: job!.instruction,
        selection: job!.selection,
        provider: model.provider,
        model: model.id,
        creds: { apiKey: apiKeyFor(model.provider) },
        prompts,
      }),
    );
    await meterAndSettle({
      uid,
      action: "storyEdit",
      events,
      stats,
      projectId: job.projectId,
      kind: "edit",
      jobId,
      targetId: "story",
      source: "worker",
      quotedSparks: job.quotedSparks,
      startedAt,
      models: { text: model },
    });
    await ref.update({
      status: "ready",
      proposal,
      decisions: {},
      claimedUntil: 0,
      updatedAt: Date.now(),
    });
  } catch (err) {
    const message = (err as Error)?.message ?? "The story could not be revised.";
    logger.error("[story-revision] generation failed", {
      uid,
      jobId,
      err: message,
      ...(err instanceof StoryRevisionFormatError && err.details
        ? { details: err.details }
        : {}),
    });
    await ref.update({
      status: "error",
      error: message,
      claimedUntil: 0,
      updatedAt: Date.now(),
    });
  }
}

export const runStoryRevisionJob = onTaskDispatched<{ uid: string; jobId: string }>(
  {
    secrets: ALL_SECRETS,
    memory: "512MiB",
    timeoutSeconds: 240,
    concurrency: 10,
    retryConfig: { maxAttempts: 8, minBackoffSeconds: 5, maxBackoffSeconds: 60 },
    rateLimits: { maxConcurrentDispatches: 20, maxDispatchesPerSecond: 10 },
  },
  async (req) => {
    await runRevision(req.data.uid, req.data.jobId);
  },
);
