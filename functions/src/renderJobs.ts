/**
 * Rendering a book, server-side.
 *
 * The pages of a book used to be rasterized on the buyer's own machine, by
 * serializing the DOM into an SVG image and drawing it to a canvas. That made
 * the product's central artifact depend on which browser the buyer happened to
 * use: WebKit refuses to load subresources inside an SVG image, so every book
 * rendered in Safari came out with the illustrations silently missing — pages
 * of text over white, no error raised anywhere, all the way through to a paid
 * download and a printed copy.
 *
 * So the browser moved here. A private page in the web app mounts the SAME
 * `PrintBook` components the editor draws with, headless Chrome loads it and
 * photographs each page element, and those pixels go into the existing render
 * cache — where `saveRasters` and `assembleDocument` turn them into the very
 * same PDFs as before. What changed is only WHOSE browser paints, and that it
 * is now one browser we control instead of every browser there is.
 *
 * The shape of a job:
 *   1. the client asks for the documents it needs (ebook, or interior+cover)
 *      against a fingerprint it already computed;
 *   2. a job doc is written with a single-use token, and a Cloud Task picks it
 *      up (the emulator has no task queue, so it runs inline there);
 *   3. the worker drives Chrome, writing progress onto the job as it goes —
 *      the client polls that, the way it used to watch its own render;
 *   4. every page is checked for ink before it's kept, so a render that loses
 *      its artwork fails loudly instead of shipping a blank book.
 *
 * The render page is reachable without a session, so its token is the whole
 * guard: 32 random bytes, one job, minutes long, and it authorizes nothing
 * beyond reading that job's project and the blobs the project references.
 */
import crypto from "node:crypto";
import express, { type Express, type Response } from "express";
import { getFirestore } from "firebase-admin/firestore";
import { getFunctions } from "firebase-admin/functions";
import { logger } from "firebase-functions/v2";
import { onTaskDispatched } from "firebase-functions/v2/tasks";
import sharp from "sharp";
import type { Browser, Page } from "puppeteer-core";
import type { AuthedRequest } from "./auth";
import { isEmulator, launchBrowser } from "./browser";
import { downloadBlob, ensureAdmin } from "./storage";
import { appBaseUrl } from "./stripeClient";
import {
  assembleDocument,
  saveRasters,
  validFingerprint,
  type DocumentRequest,
  type RasterRole,
} from "./renders";

/** How long a job's page token stays usable. Renders take a minute, not an hour. */
const TOKEN_TTL_MS = 30 * 60_000;

/** Ceiling on one render pass, after which something is wrong, not slow. */
const RENDER_TIMEOUT_MS = 8 * 60_000;

/** How long to wait for the render page to say it's laid out and loaded. */
const PAGE_READY_TIMEOUT_MS = 4 * 60_000;

/** A page bigger than this in either direction isn't a book page. */
const MAX_VIEWPORT_PX = 4000;

interface RenderJobDoc {
  projectId: string;
  fingerprint: string;
  /** What to build once the pages are captured. */
  documents: DocumentRequest[];
  token: string;
  status: "pending" | "running" | "done" | "error";
  /** Human-readable progress, shown to the person waiting. */
  step: string;
  done: number;
  total: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * One page the render page wants photographed.
 *
 * Which pages exist, what they're called and where they belong in a document
 * is decided in the browser, by the same plan code the editor uses. The worker
 * stays deliberately ignorant of book structure: it photographs what it's
 * handed, in the order it's handed it.
 */
interface CaptureSpec {
  id: string;
  role: RasterRole;
  index: number;
  label: string;
  widthIn: number;
  heightIn: number;
  /** Whether a blank result means a failed render rather than a blank page. */
  mustHaveInk: boolean;
}

interface RenderPageState {
  ready?: boolean;
  error?: string;
  captures?: CaptureSpec[];
  /** Largest page in CSS pixels, so the viewport can hold one whole page. */
  viewport?: { width: number; height: number };
}

function jobRef(uid: string, jobId: string) {
  return getFirestore().doc(`users/${uid}/renderJobs/${jobId}`);
}

function projectRef(uid: string, projectId: string) {
  // Projects are one JSON KV doc each: `users/{uid}/store/project%3A{id}`.
  return getFirestore().doc(`users/${uid}/store/${encodeURIComponent(`project:${projectId}`)}`);
}

function clientError(res: Response, message: string, status = 400): void {
  res.status(status).json({ error: { message } });
}

/** Constant-time token check — a render token is a credential like any other. */
function tokenMatches(expected: string, given: unknown): boolean {
  if (typeof given !== "string" || given.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given));
}

/** Load a job for the render page, refusing anything but a live, valid token. */
async function jobForToken(
  uid: string,
  jobId: string,
  token: unknown,
): Promise<RenderJobDoc | null> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(jobId)) return null;
  const snap = await jobRef(uid, jobId).get();
  const job = snap.data() as RenderJobDoc | undefined;
  if (!job) return null;
  if (!tokenMatches(job.token, token)) return null;
  if (Date.now() - job.createdAt > TOKEN_TTL_MS) return null;
  return job;
}

// ---- Routes -----------------------------------------------------------------

export function registerRenderJobRoutes(app: Express): void {
  const json = express.json({ limit: "1mb" });

  /**
   * Ask the server to render this book.
   *
   * Returns as soon as the job exists — rendering a book takes a minute or two
   * and nothing good comes of holding an HTTP request open that long. The
   * caller watches the job instead.
   */
  app.post(
    "/account/renders/:fingerprint/render",
    json,
    async (req: AuthedRequest, res: Response) => {
      try {
        ensureAdmin();
        const uid = req.uid!;
        const { fingerprint } = req.params;
        if (!validFingerprint(fingerprint)) {
          clientError(res, "Unknown render.", 404);
          return;
        }
        const body = (req.body ?? {}) as { projectId?: string; documents?: DocumentRequest[] };
        const projectId = (body.projectId ?? "").trim();
        const documents = parseDocuments(body.documents);
        if (!projectId || documents.length === 0) {
          clientError(res, "Nothing to render.");
          return;
        }
        if (!(await projectRef(uid, projectId).get()).exists) {
          clientError(res, "We couldn't find that book.", 404);
          return;
        }

        const jobId = crypto.randomUUID();
        const now = Date.now();
        const job: RenderJobDoc = {
          projectId,
          fingerprint,
          documents,
          token: crypto.randomBytes(32).toString("hex"),
          status: "pending",
          step: "Getting ready…",
          done: 0,
          total: 0,
          createdAt: now,
          updatedAt: now,
        };
        await jobRef(uid, jobId).set(job);
        await dispatchRender(uid, jobId);
        res.json({ jobId });
      } catch (err) {
        logger.error("[render] could not start", err);
        clientError(res, "We couldn't start rendering your book.", 500);
      }
    },
  );

  /** Progress for a render the caller started. */
  app.get("/account/render-jobs/:jobId", async (req: AuthedRequest, res: Response) => {
    try {
      ensureAdmin();
      const snap = await jobRef(req.uid!, req.params.jobId).get();
      const job = snap.data() as RenderJobDoc | undefined;
      if (!job) {
        clientError(res, "Unknown render.", 404);
        return;
      }
      res.json({
        status: job.status,
        step: job.step,
        done: job.done,
        total: job.total,
        error: job.error ?? null,
      });
    } catch (err) {
      logger.error("[render] status failed", err);
      clientError(res, "We couldn't check on your book.", 500);
    }
  });

  /**
   * The render page's own data. Token-authenticated: headless Chrome has no
   * session, and giving it one would mean minting real credentials for a
   * screenshot.
   */
  app.get("/internal/render/:uid/:jobId", async (req, res: Response) => {
    try {
      ensureAdmin();
      const { uid, jobId } = req.params;
      const job = await jobForToken(uid, jobId, req.query.token);
      if (!job) {
        clientError(res, "Unknown render.", 404);
        return;
      }
      const snap = await projectRef(uid, job.projectId).get();
      const raw = (snap.data() as { json?: string } | undefined)?.json;
      if (!raw) {
        clientError(res, "We couldn't find that book.", 404);
        return;
      }
      res.json({
        fingerprint: job.fingerprint,
        documents: job.documents,
        project: JSON.parse(raw),
      });
    } catch (err) {
      logger.error("[render] payload failed", err);
      clientError(res, "We couldn't load the book.", 500);
    }
  });

  /**
   * An illustration, for the render page only.
   *
   * The page can't read Storage directly (no session, and user blobs are
   * private), so the bytes come back through the same token that got it the
   * project — and only for blob ids, which are opaque and per-user anyway.
   */
  app.get("/internal/render/:uid/:jobId/blob/:blobId", async (req, res: Response) => {
    try {
      ensureAdmin();
      const { uid, jobId, blobId } = req.params;
      const job = await jobForToken(uid, jobId, req.query.token);
      if (!job) {
        clientError(res, "Unknown render.", 404);
        return;
      }
      const bytes = await downloadBlob(uid, blobId);
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "private, max-age=600");
      res.send(bytes);
    } catch (err) {
      logger.warn("[render] blob fetch failed", err);
      clientError(res, "We couldn't load an illustration.", 404);
    }
  });
}

/** Keep only document requests we recognise, with the numbers they need. */
function parseDocuments(input: unknown): DocumentRequest[] {
  if (!Array.isArray(input)) return [];
  const out: DocumentRequest[] = [];
  for (const raw of input.slice(0, 4)) {
    const d = raw as Record<string, unknown>;
    if (d?.kind === "ebook") out.push({ kind: "ebook" });
    else if (d?.kind === "interior") {
      out.push({ kind: "interior", padToPages: Math.max(1, Math.floor(Number(d.padToPages) || 0)) });
    } else if (d?.kind === "cover") {
      const c = (d.cover ?? {}) as Record<string, unknown>;
      const cover = {
        widthIn: Number(c.widthIn),
        heightIn: Number(c.heightIn),
        panelWidthIn: Number(c.panelWidthIn),
      };
      if (!Number.isFinite(cover.widthIn) || !Number.isFinite(cover.heightIn)) continue;
      out.push({
        kind: "cover",
        sku: typeof d.sku === "string" ? d.sku : undefined,
        padToPages: Number.isFinite(Number(d.padToPages)) ? Number(d.padToPages) : undefined,
        cover,
      });
    }
  }
  return out;
}

// ---- Worker -----------------------------------------------------------------

/**
 * Hand the job to a worker.
 *
 * Cloud Tasks in the cloud; inline in the emulator, which has no task queue.
 * Inline means the dev server does the rendering in the background of the
 * request that asked for it — same code, same progress writes, no queue.
 */
async function dispatchRender(uid: string, jobId: string): Promise<void> {
  if (isEmulator()) {
    void renderJob(uid, jobId).catch((err) => logger.error("[render] inline job failed", err));
    return;
  }
  await getFunctions().taskQueue("runRenderJob").enqueue({ uid, jobId });
}

export const runRenderJob = onTaskDispatched<{ uid: string; jobId: string }>(
  {
    // Chrome plus a page-sized bitmap or two. Rendering is the heaviest thing
    // the backend does and the least tolerant of being squeezed.
    memory: "2GiB",
    cpu: 2,
    timeoutSeconds: 540,
    // ONE book per container. The default lets a 2nd-gen instance serve dozens
    // of requests at once, which here would mean dozens of Chromes sharing
    // 2GiB — and an out-of-memory kill mid-render looks to the buyer exactly
    // like the silent blank-page failure this whole move was meant to end.
    concurrency: 1,
    retryConfig: { maxAttempts: 2, minBackoffSeconds: 10 },
    rateLimits: { maxConcurrentDispatches: 6 },
  },
  async (req) => {
    await renderJob(req.data.uid, req.data.jobId);
  },
);

/** Render one job end to end: pages out of Chrome, documents into the cache. */
async function renderJob(uid: string, jobId: string): Promise<void> {
  const ref = jobRef(uid, jobId);
  const job = (await ref.get()).data() as RenderJobDoc | undefined;
  if (!job || job.status === "done") return;

  const started = Date.now();
  const progress = async (step: string, done?: number, total?: number) => {
    await ref.set(
      {
        step,
        ...(done !== undefined ? { done } : {}),
        ...(total !== undefined ? { total } : {}),
        updatedAt: Date.now(),
      },
      { merge: true },
    );
  };

  let browser: Browser | undefined;
  try {
    await ref.set({ status: "running", step: "Starting the renderer…", updatedAt: Date.now() }, { merge: true });
    browser = await launchBrowser();
    const page = await browser.newPage();
    page.on("pageerror", (err) => logger.warn("[render] page error", { jobId, err: String(err) }));

    const url = `${appBaseUrl()}/internal/render?uid=${encodeURIComponent(uid)}&job=${encodeURIComponent(jobId)}&token=${encodeURIComponent(job.token)}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });

    await progress("Loading your artwork…");
    const state = await waitForRenderPage(page);
    if (state.error) throw new Error(state.error);
    const captures = state.captures ?? [];
    if (captures.length === 0) throw new Error("This book has no pages to render.");

    // One whole page has to fit on screen: Chrome photographs what it can lay
    // out, and a page taller than the viewport would otherwise be captured in
    // pieces or scaled.
    await page.setViewport({
      width: Math.min(MAX_VIEWPORT_PX, Math.ceil(state.viewport?.width ?? 1200)),
      height: Math.min(MAX_VIEWPORT_PX, Math.ceil(state.viewport?.height ?? 1200)),
      deviceScaleFactor: 1,
    });

    await progress(`Rendering 1 of ${captures.length}…`, 0, captures.length);
    for (let i = 0; i < captures.length; i++) {
      if (Date.now() - started > RENDER_TIMEOUT_MS) {
        throw new Error("Rendering this book took too long.");
      }
      const spec = captures[i];
      const bytes = await capturePage(page, spec);
      await saveRasters(uid, job.fingerprint, job.projectId, [
        {
          id: spec.id,
          role: spec.role,
          index: spec.index,
          label: spec.label,
          widthIn: spec.widthIn,
          heightIn: spec.heightIn,
          base64: bytes.toString("base64"),
          mimeType: "image/jpeg",
        },
      ]);
      await progress(`Rendering ${Math.min(i + 2, captures.length)} of ${captures.length}…`, i + 1);
    }

    await browser.close();
    browser = undefined;

    await progress("Assembling your book…");
    for (const doc of job.documents) {
      await assembleDocument(uid, job.fingerprint, doc);
    }

    await ref.set(
      { status: "done", step: "Your book is ready.", done: captures.length, updatedAt: Date.now() },
      { merge: true },
    );
    logger.info("[render] finished", { jobId, pages: captures.length, ms: Date.now() - started });
  } catch (err) {
    const message = (err as Error)?.message ?? "We couldn't render your book.";
    logger.error("[render] failed", { jobId, err: message });
    await ref.set({ status: "error", error: message, updatedAt: Date.now() }, { merge: true });
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

/** Wait for the render page to report itself laid out — or to say why it isn't. */
async function waitForRenderPage(page: Page): Promise<RenderPageState> {
  await page.waitForFunction(
    "window.__bookRender && (window.__bookRender.ready === true || !!window.__bookRender.error)",
    { timeout: PAGE_READY_TIMEOUT_MS, polling: 500 },
  );
  return (await page.evaluate("window.__bookRender")) as RenderPageState;
}

/**
 * Photograph one page element.
 *
 * A page that should have artwork on it and comes back white is a failed
 * render, not a design: that exact failure shipped books with no pictures in
 * them, because the only check was whether the WHOLE page was white and a page
 * with text on it never is. Here the page says up front whether it expects
 * ink, and a page that expected ink and produced none stops the job.
 */
async function capturePage(page: Page, spec: CaptureSpec): Promise<Buffer> {
  const handle = await page.$(`[data-export-page="${cssEscape(spec.id)}"]`);
  if (!handle) throw new Error(`The book's ${spec.label} could not be prepared for printing.`);
  try {
    const shot = (await handle.screenshot({
      type: "jpeg",
      quality: 92,
      captureBeyondViewport: true,
    })) as Buffer;
    if (spec.mustHaveInk && (await looksBlank(shot))) {
      throw new Error(`${spec.label} rendered without its illustration.`);
    }
    return shot;
  } finally {
    await handle.dispose();
  }
}

/** True when a captured page is white enough to be nothing at all. */
async function looksBlank(bytes: Buffer): Promise<boolean> {
  try {
    // Downsampled: the question is "did anything paint", not "what is it".
    const { channels } = await sharp(bytes).resize(64, 64, { fit: "fill" }).stats();
    return channels.every((c) => c.mean > 250 && c.stdev < 3);
  } catch {
    // If it can't be inspected, don't fail a render over the inspection.
    return false;
  }
}

/** Escape an id for an attribute selector (Node has no `CSS.escape`). */
function cssEscape(value: string): string {
  return value.replace(/["\\\]]/g, "\\$&");
}
