/**
 * Generation worker — a Firestore-triggered function that runs image-render
 * jobs created under `users/{uid}/jobs/{jobId}`.
 *
 * For each task it downloads the referenced blobs from the user's Storage space
 * (Admin SDK), calls the image provider directly with the server-held key,
 * optionally composites the result back over the original through a mask, then
 * uploads the result and reports progress on the job document. Because this runs
 * server-side, generation continues even if the browser closes.
 *
 * v1 dispatch: a single triggered invocation processes the whole batch with
 * bounded concurrency (fine for per-book batches). Cloud Tasks fan-out can
 * replace this later for higher scale without changing the data model.
 */
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import type { DocumentReference } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import "./providerHttp";
import { serverConfig } from "./config";
import { compositeMaskedRegion } from "./imaging";
import { backendPipelineEnv } from "./pipelineEnv";
import { resolveImageModels } from "./modelResolve";
import { recordUsage, withUsage } from "./usage";
import { ensureAfford, estimateForUser, settleActionCost } from "./sparks";
import { ALL_SECRETS } from "./secrets";
import { downloadBlob, ensureAdmin, uploadBlob } from "./storage";
import type { ResolvedModels } from "../../books-frontend/src/core/models/registry";
import { orderAnchorsByDependency } from "../../books-frontend/src/core/book/anchorGraph";
import { spreadsById } from "../../books-frontend/src/core/book/units";
import { applyAnchorRender, renderAnchor } from "../../books-frontend/src/core/pipeline/anchorRun";
import { renderIllustration } from "../../books-frontend/src/core/pipeline/illustrationRun";
import { getImageProvider } from "../../books-frontend/src/core/providers";
import type {
  ImageRequest,
  ReferenceImage,
} from "../../books-frontend/src/core/providers/types";
import type { ProviderId } from "../../books-frontend/src/core/config/options";
import type { Anchor } from "../../books-frontend/src/core/types";
import type {
  AnchorsJob,
  AnchorTask,
  AnyJob,
  GenerationJob,
  ImageRenderRequest,
  JobTask,
  PipelineRefreshJob,
  RefreshTask,
} from "../../books-frontend/src/core/jobs/types";

const TASK_CONCURRENCY = 3;

/** Minimal bounded-concurrency pool (avoids pulling an ESM-only dep into CJS). */
async function runPool<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const idx = next++;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}

function apiKeyFor(provider: ProviderId): string {
  const cfg = serverConfig();
  const key = provider === "openai" ? cfg.openaiApiKey : cfg.googleApiKey;
  if (!key) throw new Error(`The ${provider} provider is not configured on the server.`);
  return key;
}

function bufToBase64(buf: Buffer): string {
  return buf.toString("base64");
}

/**
 * Run one image-render task and return the stored result. The model/provider
 * are resolved server-side (the client-supplied values on the request are
 * ignored) so generation can't be escalated to a costlier model.
 */
async function runTask(
  uid: string,
  req: ImageRenderRequest,
  model: ResolvedModels["imageModel"],
): Promise<{ blobId: string; mimeType: string }> {
  // Resolve reference images from the user's stored blobs.
  const references: ReferenceImage[] = await Promise.all(
    (req.references ?? []).map(async (r): Promise<ReferenceImage> => {
      const buf = await downloadBlob(uid, r.blobId);
      return {
        base64: bufToBase64(buf),
        mimeType: r.mimeType || "image/png",
        label: r.label,
        role: r.role,
      };
    }),
  );

  let mask: ReferenceImage | undefined;
  if (req.maskBlobId) {
    const buf = await downloadBlob(uid, req.maskBlobId);
    mask = { base64: bufToBase64(buf), mimeType: "image/png" };
  }

  const imageReq: ImageRequest = {
    model: model.id,
    prompt: req.prompt,
    size: req.size,
    quality: req.quality,
    references: references.length ? references : undefined,
    mask,
  };

  const { value: result, events } = await withUsage(() =>
    getImageProvider(model.provider).generateImage({ apiKey: apiKeyFor(model.provider) }, imageReq),
  );
  await recordUsage(uid, "pageIllustration", events);
  await settleActionCost(uid, "pageIllustration", events);

  let finalBuf: Buffer = Buffer.from(result.base64, "base64");
  let mimeType = result.mimeType;

  // Optional masked composite: keep everything outside the mask byte-identical.
  if (req.composite) {
    const [original, maskBuf] = await Promise.all([
      downloadBlob(uid, req.composite.originalBlobId),
      downloadBlob(uid, req.composite.maskBlobId),
    ]);
    finalBuf = await compositeMaskedRegion({ original, edited: finalBuf, mask: maskBuf });
    mimeType = "image/png";
  }

  const blobId = await uploadBlob(uid, finalBuf, mimeType);
  return { blobId, mimeType };
}

/** Persist the current job state (status/tasks/progress) back to its document. */
function makeWriter(ref: DocumentReference, job: AnyJob): () => Promise<unknown> {
  return () =>
    ref.update({
      status: job.status,
      tasks: job.tasks,
      progress: job.progress,
      updatedAt: Date.now(),
      ...(job.error ? { error: job.error } : {}),
    });
}

/** Render a batch of pre-assembled image requests (bulk generation). */
async function runImageJob(ref: DocumentReference, uid: string, job: GenerationJob): Promise<void> {
  const tasks = job.tasks ?? [];
  const writeState = makeWriter(ref, job);
  // Pre-check the whole batch can be afforded (within the negative buffer) so we
  // don't start a book we can't finish; per-task cost is settled as each renders.
  await ensureAfford(uid, (await estimateForUser(uid, "pageIllustration")) * tasks.length);
  // Bulk page generation always uses the configured page-illustration model.
  const models = await resolveImageModels("pageIllustration");

  job.status = "running";
  job.progress = { total: tasks.length, completed: 0, failed: 0 };
  await writeState();

  await runPool(tasks, TASK_CONCURRENCY, async (task: JobTask) => {
    try {
      task.result = await runTask(uid, task.request, models.imageModel);
      task.status = "done";
      job.progress.completed += 1;
    } catch (err) {
      task.status = "error";
      task.error = (err as Error)?.message ?? "Generation failed.";
      job.progress.failed += 1;
    }
    await writeState();
  });

  job.status = job.progress.failed > 0 && job.progress.completed === 0 ? "error" : "done";
  await writeState();
}

/**
 * Run the full illustration pipeline server-side for each named spread (e.g.
 * bulk refresh of stale pages), reusing the shared core orchestration. Results
 * are written to each task for the client to fold into its version trees.
 */
async function runRefreshJob(
  ref: DocumentReference,
  uid: string,
  job: PipelineRefreshJob,
): Promise<void> {
  const tasks = job.tasks ?? [];
  await ensureAfford(uid, (await estimateForUser(uid, "pageIllustration")) * tasks.length);
  const env = backendPipelineEnv(uid, await resolveImageModels("pageIllustration"));
  const byId = spreadsById(job.project);
  const writeState = makeWriter(ref, job);

  job.status = "running";
  job.progress = { total: tasks.length, completed: 0, failed: 0 };
  await writeState();

  await runPool(tasks, TASK_CONCURRENCY, async (task: RefreshTask) => {
    try {
      const spread = byId.get(task.id);
      if (!spread) throw new Error("Spread not found in the project snapshot.");
      const { value: render, events } = await withUsage(() =>
        renderIllustration(job.project, spread, task.options ?? {}, env),
      );
      await recordUsage(uid, "pageIllustration", events);
      await settleActionCost(uid, "pageIllustration", events);
      if (!render) throw new Error("Nothing to render for this spread.");
      task.result = render;
      task.status = "done";
      job.progress.completed += 1;
    } catch (err) {
      task.status = "error";
      task.error = (err as Error)?.message ?? "Refresh failed.";
      job.progress.failed += 1;
    }
    await writeState();
  });

  job.status = job.progress.failed > 0 && job.progress.completed === 0 ? "error" : "done";
  await writeState();
}

/**
 * Render anchor reference images server-side, honoring the dependency graph: a
 * contained anchor (e.g. a bed) is rendered before the anchor that references it
 * (the room), and each render is folded into the in-memory snapshot so later
 * layers pick up the new image. Results are folded into the version trees by the
 * client on reconcile.
 */
async function runAnchorsJob(ref: DocumentReference, uid: string, job: AnchorsJob): Promise<void> {
  const tasks = job.tasks ?? [];
  await ensureAfford(uid, (await estimateForUser(uid, "anchorImage")) * tasks.length);
  const env = backendPipelineEnv(uid, await resolveImageModels("anchorImage"));
  const writeState = makeWriter(ref, job);

  job.status = "running";
  job.progress = { total: tasks.length, completed: 0, failed: 0 };
  await writeState();

  const tasksById = new Map(tasks.map((t) => [t.id, t]));
  const byId = new Map((job.project.anchors ?? []).map((a) => [a.id, a]));
  const targets = tasks
    .map((t) => byId.get(t.id))
    .filter((a): a is Anchor => Boolean(a));

  for (const layer of orderAnchorsByDependency(targets)) {
    await runPool(layer, TASK_CONCURRENCY, async (anchor: Anchor) => {
      const task = tasksById.get(anchor.id);
      if (!task) return;
      try {
        const { value: render, events } = await withUsage(() =>
          renderAnchor(job.project, anchor, task.options ?? {}, env),
        );
        await recordUsage(uid, "anchorImage", events);
        await settleActionCost(uid, "anchorImage", events);
        task.result = render;
        task.status = "done";
        job.progress.completed += 1;
        // Update the snapshot in place so dependents in later layers see it.
        anchor.versions = applyAnchorRender(anchor.versions, render);
      } catch (err) {
        task.status = "error";
        task.error = (err as Error)?.message ?? "Anchor generation failed.";
        job.progress.failed += 1;
      }
      await writeState();
    });
  }

  job.status = job.progress.failed > 0 && job.progress.completed === 0 ? "error" : "done";
  await writeState();
}

export const onGenerationJob = onDocumentCreated(
  {
    document: "users/{uid}/jobs/{jobId}",
    secrets: ALL_SECRETS,
    timeoutSeconds: 540,
    memory: "1GiB",
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    ensureAdmin();

    const uid = event.params.uid as string;
    const job = snap.data() as AnyJob;
    if (job.status !== "pending") return;

    // Generation spends provider credits, so only verified, non-anonymous
    // accounts may run it — mirrors `requireVerified` on the HTTP proxy. Skipped
    // under the emulator, which can't send verification emails (dev testing).
    if (process.env.FUNCTIONS_EMULATOR !== "true") {
      try {
        const user = await getAuth().getUser(uid);
        const isAnonymous = user.providerData.length === 0;
        if (isAnonymous || !user.emailVerified) {
          await snap.ref.update({
            status: "error",
            error: "Please verify your email to generate.",
            updatedAt: Date.now(),
          });
          return;
        }
      } catch {
        await snap.ref.update({
          status: "error",
          error: "Could not verify the account for this job.",
          updatedAt: Date.now(),
        });
        return;
      }
    }

    // Always drive the job to a terminal state. Work that runs before a handler
    // sets `running` (e.g. model resolution) — or any unexpected crash — would
    // otherwise leave the document stuck at "pending"/"running" forever, so the
    // client's progress subscription never resolves and the UI hangs.
    try {
      if (job.kind === "image") await runImageJob(snap.ref, uid, job);
      else if (job.kind === "refresh") await runRefreshJob(snap.ref, uid, job);
      else if (job.kind === "anchors") await runAnchorsJob(snap.ref, uid, job);
    } catch (err) {
      await snap.ref.update({
        status: "error",
        error: (err as Error)?.message ?? "Generation failed.",
        updatedAt: Date.now(),
      });
    }
  },
);
