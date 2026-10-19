/**
 * Print-resolution preparation — the pipeline.
 *
 * Pictures are generated at screen resolution, which prints at 120–220 DPI.
 * After an order is PAID, and before it goes to the printer, this module
 * upscales the book's pictures to what their place on the page needs and
 * re-renders the book with them:
 *
 *   planning   → which pictures, how big (measured by the render page; a
 *                measuring-only render if the order's render didn't record it)
 *   upscaling  → one Cloud Task per picture (AI service → Lanczos, verified)
 *   rendering  → the same render worker, serving the upscaled pictures
 *   verifying  → the same preflight the checkout ran on the standard files
 *   ready      → the order is placed with the print-resolution files
 *
 * The rule everything here serves: the customer never waits on it and never
 * sees it fail. They were sold a book whose standard files passed preflight at
 * checkout, so every failure, timeout, edit, outage or bug ends in `fallback`
 * — the order is placed with those files, exactly as it would have been before
 * this existed. Concretely:
 *
 *   - a hard DEADLINE after payment (settings), enforced in three places: every
 *     step, the placement gate, and the stranded-order sweep (via
 *     `payments.printPrepUntil`) — so even if every task here died, the order
 *     still goes out;
 *   - every unit of work is idempotent and resumable: per-picture docs, a step
 *     lease, a cache of finished upscales keyed by picture and size;
 *   - lost wake-ups are covered by a five-minute sweep, whose heartbeat is
 *     itself watched by the order watchdog;
 *   - anything a person must act on is a critical alert (Slack #ops); anything
 *     the system handled is a warning in the admin inbox and a log line.
 *
 * Storage:
 *   printPrep/{paymentId}                 the run (see `PrintPrepDoc`)
 *   printPrep/{paymentId}/images/{id}     one picture's upscale
 *   printPrepUpscales/{key}               finished upscales, reused across orders
 *   users/{uid}/upscaled/{key}.jpg|png    the upscaled pictures
 *   adminSettings/printPrep               settings (private)
 */
import crypto from "node:crypto";
import express, { type Express, type Request, type Response } from "express";
import { getFirestore, type DocumentData } from "firebase-admin/firestore";
import { getFunctions } from "firebase-admin/functions";
import { logger } from "firebase-functions/v2";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onTaskDispatched } from "firebase-functions/v2/tasks";
import sharp from "sharp";
import type { AuthedRequest } from "./auth";
import { raiseAlert, resolveAlert } from "./alerts";
import { isEmulator } from "./browser";
import { serverConfig } from "./config";
import { recordFinanceEvent } from "./finance";
import { log, withLogContext } from "./logs";
import { getAdminPayment, type AdminPaymentRecord } from "./payments";
import { padInteriorToPages, preflightPrintFiles } from "./printPreflight";
import {
  JOB_HEARTBEATS,
  getPrintOrder,
  readHeartbeats,
  recordHeartbeat,
  recordOrderEvent,
  syncOrderFromPayment,
  type OrderEventType,
} from "./printOrders";
import { readPrintPrepDays, recordPrintPrepSpend } from "./printPrepStats";
import { readPrintRenderJob, startPrintRenderJob } from "./renderJobs";
import { cachedDocumentUrl, readRenderIndex, type DocumentRequest } from "./renders";
import { ALL_SECRETS } from "./secrets";
import { blobBucket, downloadBlob, ensureAdmin } from "./storage";
import { readUpscalerHealth, upscaleImage, type UpscaleTier } from "./upscaler";
import {
  createDefaultPrintPrepSettings,
  normalizePrintPrepSettings,
  printPrepDeadline,
  printPrepSettingsSchema,
  upscaleTargetFor,
  type PrintPrepSettings,
  type UpscaleTarget,
} from "../../books-frontend/src/core/print/printPrep";
import {
  ACTIVE_PRINT_PREP_STATUSES,
  type PrintOrderPrintPrep,
  type PrintPrepStatus,
} from "../../books-frontend/src/core/orders/lifecycle";

const PREP = "printPrep";
const UPSCALES = "printPrepUpscales";
const SETTINGS_DOC = "adminSettings/printPrep";

/** Executions of one picture's upscale before it is given up (the book keeps its original). */
const MAX_IMAGE_ATTEMPTS = 3;
const MAX_PROBE_ATTEMPTS = 2;
const MAX_RENDER_ATTEMPTS = 2;
/** Consecutive unexpected step errors before the run falls back rather than retrying. */
const MAX_STEP_ERRORS = 3;
/** One step holds the run this long at most; a crashed step frees it by expiry. */
const STEP_LEASE_MS = 4 * 60_000;
/** A picture's task unheard-from this long is presumed lost and dispatched again. */
const IMAGE_REDISPATCH_MS = 6 * 60_000;
/** A render job unchanged this long is presumed dead (renders report progress per page). */
const RENDER_STALL_MS = 15 * 60_000;
/** The payment stays out of the stranded-order sweep this long past the deadline. */
const STRANDED_GRACE_MS = 5 * 60_000;
const TIMELINE_MAX = 40;

function db() {
  ensureAdmin();
  return getFirestore();
}

const prepRef = (paymentId: string) => db().doc(`${PREP}/${paymentId}`);
const imagesRef = (paymentId: string) => prepRef(paymentId).collection("images");
const imageDocId = (blobId: string) => crypto.createHash("sha1").update(blobId).digest("hex");
const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Drop `undefined` (Firestore rejects it) while keeping `null`. */
function clean<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Sandbox runs are rehearsals: they log and show in the dashboard, but never page anyone. */
function liveEnv(): boolean {
  return serverConfig().fulfillment.lulu.env === "live";
}

// ---- Settings -----------------------------------------------------------------

let settingsCache: { at: number; value: PrintPrepSettings } | null = null;

/**
 * The current settings (cached 30s). A read failure answers with the last good
 * value, else the dormant default — "off" means standard files, which is the
 * behaviour every order had before this existed, so failing towards it is safe.
 */
export async function getPrintPrepSettings(fresh = false): Promise<PrintPrepSettings> {
  if (!fresh && settingsCache && Date.now() - settingsCache.at < 30_000) return settingsCache.value;
  try {
    const snap = await db().doc(SETTINGS_DOC).get();
    const value = snap.exists ? normalizePrintPrepSettings(snap.data()) : createDefaultPrintPrepSettings();
    settingsCache = { at: Date.now(), value };
    return value;
  } catch (err) {
    logger.warn("[printPrep] settings unreadable; using the last known", { err: errText(err) });
    return settingsCache?.value ?? createDefaultPrintPrepSettings();
  }
}

export async function savePrintPrepSettings(input: unknown, uid?: string): Promise<PrintPrepSettings> {
  const parsed = printPrepSettingsSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`Invalid print preparation settings: ${parsed.error.issues[0]?.message ?? "unknown"}`);
  }
  const value = normalizePrintPrepSettings({ ...parsed.data, updatedAt: Date.now(), updatedBy: uid ?? "" });
  await db().doc(SETTINGS_DOC).set(clean(value) as unknown as DocumentData, { merge: false });
  settingsCache = { at: Date.now(), value };
  return value;
}

// ---- Documents ----------------------------------------------------------------

type ImageStatus = "pending" | "done" | "failed";

export interface PrintPrepImageDoc {
  blobId: string;
  /** Key of the finished upscale in `printPrepUpscales` (picture × size). */
  cacheKey: string;
  naturalWidth: number;
  naturalHeight: number;
  /** How much the page enlarges the original. */
  demand: number;
  target: UpscaleTarget;
  status: ImageStatus;
  attempts: number;
  dispatches: number;
  dispatchedAt: number;
  path: string | null;
  tier: UpscaleTier | null;
  /** Served from an earlier order's upscale. */
  cached: boolean;
  costUsd: number;
  durationMs: number;
  fallbacks: string[];
  error: string | null;
  updatedAt: number;
}

export interface PrintPrepDoc {
  paymentId: string;
  uid: string;
  projectId: string;
  env: string;
  fingerprint: string;
  interiorKey: string;
  coverKey: string;
  pages: number;
  printSku: string;
  baseSku: string;
  status: PrintPrepStatus;
  /** Indexed: the sweep's query. */
  active: boolean;
  startedAt: number;
  deadlineAt: number;
  updatedAt: number;
  finishedAt: number | null;
  reason: string | null;
  documents: DocumentRequest[] | null;
  probeJobId: string | null;
  probeAttempts: number;
  renderJobId: string | null;
  renderAttempts: number;
  hiresFingerprint: string | null;
  images: { total: number; done: number; failed: number };
  tiers: Record<string, number>;
  costUsd: number;
  files: { interior: string; cover: string } | null;
  stepErrors: number;
  leaseUntil: number;
  /** A wake-up arrived while a step held the lease; run again when it releases. */
  wakeAgain: boolean;
  timeline: { at: number; message: string }[];
}

/** The run was settled by someone else mid-step; stop quietly. */
class PrepSettled extends Error {}

function summaryOf(doc: PrintPrepDoc): PrintOrderPrintPrep {
  return {
    status: doc.status,
    startedAt: doc.startedAt,
    deadlineAt: doc.deadlineAt,
    finishedAt: doc.finishedAt,
    reason: doc.reason,
    images: doc.images,
    tiers: doc.tiers,
    costUsd: Math.round(doc.costUsd * 10_000) / 10_000,
  };
}

async function readPrep(paymentId: string): Promise<PrintPrepDoc | null> {
  const snap = await prepRef(paymentId).get();
  return snap.exists ? (snap.data() as PrintPrepDoc) : null;
}

async function loadImages(paymentId: string): Promise<PrintPrepImageDoc[]> {
  const snap = await imagesRef(paymentId).get();
  return snap.docs.map((d) => d.data() as PrintPrepImageDoc);
}

/**
 * Write to a run that is still active, atomically — so a step can never
 * resurrect a run the placement gate settled while it was working.
 */
async function patchPrep(paymentId: string, patch: Partial<PrintPrepDoc>, note?: string): Promise<PrintPrepDoc> {
  return db().runTransaction(async (tx) => {
    const ref = prepRef(paymentId);
    const cur = (await tx.get(ref)).data() as PrintPrepDoc | undefined;
    if (!cur || !cur.active) throw new PrepSettled();
    const now = Date.now();
    const timeline = note
      ? [...(cur.timeline ?? []), { at: now, message: note.slice(0, 300) }].slice(-TIMELINE_MAX)
      : cur.timeline ?? [];
    const update = { ...patch, timeline, updatedAt: now };
    tx.set(ref, clean(update), { merge: true });
    return { ...cur, ...update };
  });
}

/** Mirror the run onto the order record, so the queue and the order page show it. */
async function syncOrder(
  doc: PrintPrepDoc,
  type: OrderEventType,
  message: string,
  opts: { onlyIfChanged?: boolean; data?: Record<string, unknown> } = {},
): Promise<void> {
  try {
    const payment = await getAdminPayment(doc.paymentId);
    await syncOrderFromPayment(
      payment,
      { type, source: "print_prep", message, data: opts.data },
      { printPrep: summaryOf(doc) },
      { onlyIfChanged: opts.onlyIfChanged, silent: opts.onlyIfChanged },
    );
  } catch (err) {
    logger.warn("[printPrep] couldn't update the order record", { paymentId: doc.paymentId, err: errText(err) });
  }
}

// ---- Scheduling -----------------------------------------------------------------

/**
 * Wake the run for `paymentId` after `delaySeconds`. In the emulator (no task
 * queue) it runs in-process. Never throws: the sweep is the backstop.
 */
export async function schedulePrintPrepStep(paymentId: string, delaySeconds = 0): Promise<void> {
  try {
    if (isEmulator()) {
      setTimeout(() => void advancePrintPrep(paymentId), Math.max(0, delaySeconds) * 1000);
      return;
    }
    await getFunctions()
      .taskQueue("runPrintPrepStep")
      .enqueue({ paymentId }, delaySeconds > 0 ? { scheduleDelaySeconds: Math.round(delaySeconds) } : {});
  } catch (err) {
    logger.warn("[printPrep] couldn't schedule a step; the sweep will", { paymentId, err: errText(err) });
  }
}

async function dispatchImage(paymentId: string, imageId: string): Promise<void> {
  try {
    if (isEmulator()) {
      void upscaleOne(paymentId, imageId).catch((err) =>
        logger.warn("[printPrep] emulator upscale failed", { paymentId, imageId, err: errText(err) }),
      );
      return;
    }
    await getFunctions().taskQueue("runUpscaleImage").enqueue({ paymentId, imageId });
  } catch (err) {
    // Redispatched by the upscaling step once it's overdue.
    logger.warn("[printPrep] couldn't dispatch an upscale", { paymentId, imageId, err: errText(err) });
  }
}

/** Take the run for one step, or note that it should run again when it's free. */
async function claimStep(paymentId: string): Promise<PrintPrepDoc | null> {
  return db().runTransaction(async (tx) => {
    const ref = prepRef(paymentId);
    const cur = (await tx.get(ref)).data() as PrintPrepDoc | undefined;
    if (!cur || !cur.active) return null;
    const now = Date.now();
    if ((cur.leaseUntil ?? 0) > now) {
      if (!cur.wakeAgain) tx.set(ref, { wakeAgain: true }, { merge: true });
      return null;
    }
    tx.set(ref, { leaseUntil: now + STEP_LEASE_MS, wakeAgain: false }, { merge: true });
    return { ...cur, leaseUntil: now + STEP_LEASE_MS, wakeAgain: false };
  });
}

async function releaseStep(paymentId: string): Promise<void> {
  try {
    const again = await db().runTransaction(async (tx) => {
      const ref = prepRef(paymentId);
      const cur = (await tx.get(ref)).data() as PrintPrepDoc | undefined;
      if (!cur) return false;
      tx.set(ref, { leaseUntil: 0, wakeAgain: false }, { merge: true });
      return Boolean(cur.active && cur.wakeAgain);
    });
    if (again) await schedulePrintPrepStep(paymentId, 2);
  } catch (err) {
    // The lease expires on its own.
    logger.warn("[printPrep] couldn't release the step lease", { paymentId, err: errText(err) });
  }
}

// ---- Settling ---------------------------------------------------------------------

type Outcome = "ready" | "fallback" | "skipped";

/**
 * End the run. Exactly one caller wins (transaction on `active`); the winner
 * records the outcome and, when asked, places the order. Placing is skipped by
 * the placement gate itself, whose caller is about to place anyway.
 */
async function settlePrintPrep(
  paymentId: string,
  outcome: Outcome,
  reason: string | null,
  opts: { place: boolean; files?: { interior: string; cover: string }; by?: string },
): Promise<boolean> {
  const now = Date.now();
  const doc = await db().runTransaction(async (tx) => {
    const ref = prepRef(paymentId);
    const cur = (await tx.get(ref)).data() as PrintPrepDoc | undefined;
    if (!cur || !cur.active) return null;
    const message =
      outcome === "ready"
        ? "Print-resolution files ready"
        : `${outcome === "fallback" ? "Falling back to the standard files" : "Standard files"}${reason ? `: ${reason}` : ""}`;
    const next: PrintPrepDoc = {
      ...cur,
      status: outcome,
      active: false,
      finishedAt: now,
      updatedAt: now,
      reason: reason ? reason.slice(0, 500) : null,
      files: opts.files ?? null,
      leaseUntil: 0,
      wakeAgain: false,
      timeline: [...(cur.timeline ?? []), { at: now, message: message.slice(0, 300) }].slice(-TIMELINE_MAX),
    };
    tx.set(ref, clean(next));
    return next;
  });
  if (!doc) return false;

  await withLogContext({ paymentId, uid: doc.uid, projectId: doc.projectId }, async () => {
    // Back in the stranded-order sweep's view right away.
    await db()
      .doc(`payments/${paymentId}`)
      .set({ printPrepUntil: 0 }, { merge: true })
      .catch(() => undefined);

    // Refresh image totals for the record.
    const images = await loadImages(paymentId).catch(() => [] as PrintPrepImageDoc[]);
    if (images.length > 0) {
      doc.images = {
        total: images.length,
        done: images.filter((i) => i.status === "done").length,
        failed: images.filter((i) => i.status === "failed").length,
      };
      doc.tiers = countTiers(images);
      doc.costUsd = images.reduce((s, i) => s + (i.costUsd || 0), 0);
      await prepRef(paymentId)
        .set(clean({ images: doc.images, tiers: doc.tiers, costUsd: doc.costUsd }), { merge: true })
        .catch(() => undefined);
    }
    const minutes = Math.max(1, Math.round((now - doc.startedAt) / 60_000));
    const context = {
      outcome,
      reason,
      minutes,
      images: doc.images,
      tiers: doc.tiers,
      costUsd: doc.costUsd,
      ...(opts.by ? { by: opts.by } : {}),
    };

    if (outcome === "ready") {
      void log.info({
        source: "worker",
        domain: "print",
        event: "print.prep.ready",
        message: `Print-resolution files ready in ${minutes} min (${doc.images.done} picture(s) upscaled).`,
        context,
      });
      await syncOrder(doc, "files_ready", `Print-resolution files ready (${doc.images.done} picture(s) upscaled)`, { data: context });
    } else if (outcome === "fallback") {
      void log.warn({
        source: "worker",
        domain: "print",
        event: "print.prep.fallback",
        message: `Order placed with standard files: ${reason ?? "unknown reason"}.`,
        context,
      });
      // One fallback is handled — the book prints as it would have before. It goes to the
      // inbox so a pattern can be spotted; a burst of them pages (see the sweep).
      await raiseAlert({
        severity: "warning",
        kind: "print.prep.fallback",
        ref: paymentId,
        message: `Order ${paymentId} goes to print with its standard files: ${reason ?? "unknown reason"}.`,
        meta: { paymentId, uid: doc.uid, projectId: doc.projectId, ...context },
      }).catch(() => undefined);
      await syncOrder(doc, "files_fallback", `Standard files: ${reason ?? "unknown reason"}`, { data: context });
    } else {
      void log.info({
        source: "worker",
        domain: "print",
        event: "print.prep.skipped",
        message: `Print preparation not needed: ${reason ?? "no reason given"}.`,
        context,
      });
      await syncOrder(doc, "files_fallback", `Standard files: ${reason ?? "not needed"}`, { data: context });
    }

    if (opts.place) await placeNow(paymentId);
  });
  return true;
}

/** Hand the order to placement. Loaded lazily: placement imports this module. */
async function placeNow(paymentId: string): Promise<void> {
  try {
    const { fulfillPaidOrder, sendConfirmationIfPlaced } = await import("./stripe");
    await fulfillPaidOrder(paymentId);
    await sendConfirmationIfPlaced(paymentId);
  } catch (err) {
    // `fulfillPaidOrder` records its own failures; this is only the import or an
    // unexpected throw. The stranded-order sweep re-drives it either way.
    void log.error({
      source: "worker",
      domain: "print",
      event: "print.prep.place_failed",
      message: `Couldn't hand order ${paymentId} to placement after print preparation.`,
      paymentId,
      error: err,
    });
  }
}

function countTiers(images: PrintPrepImageDoc[]): Record<string, number> {
  const tiers: Record<string, number> = {};
  for (const i of images) {
    if (i.status !== "done" || !i.tier) continue;
    const key = i.cached ? `${i.tier}:cached` : i.tier;
    tiers[key] = (tiers[key] ?? 0) + 1;
  }
  return tiers;
}

// ---- The placement gate -------------------------------------------------------------

export type PlacementFiles =
  | { wait: true }
  | { wait: false; files: { interior?: string; cover?: string }; printResolution: boolean };

/**
 * Which files to place an order with — or to wait, because print-resolution
 * files are being prepared and the deadline hasn't passed. Called by
 * `fulfillPaidOrder` before it claims the order. NEVER throws: any doubt
 * answers with the standard files.
 */
export async function printFilesForPlacement(payment: AdminPaymentRecord): Promise<PlacementFiles> {
  const plan = payment.fulfillment;
  const standard: PlacementFiles = { wait: false, files: plan?.sourceFileUrls ?? {}, printResolution: false };
  try {
    if (!plan?.printPrep) return standard;
    // A replacement job goes out with the files that were verified at checkout.
    if (payment.rejectedOrderIds.length > 0) return standard;

    const existing = await readPrep(payment.id);
    if (existing) return gateOn(existing, standard);

    if (payment.status !== "paid") return standard;
    const settings = await getPrintPrepSettings();
    if (!settings.enabled) return standard;

    const created = await startPrintPrep(payment, settings);
    if (created) return { wait: true };
    // Lost a creation race: someone else started it a moment ago.
    const raced = await readPrep(payment.id);
    return raced ? gateOn(raced, standard) : standard;
  } catch (err) {
    void log.warn({
      source: "worker",
      domain: "print",
      event: "print.prep.gate_failed",
      message: `Print preparation couldn't be consulted for order ${payment.id}; placing with the standard files.`,
      paymentId: payment.id,
      error: err,
    });
    return standard;
  }
}

async function gateOn(doc: PrintPrepDoc, standard: PlacementFiles): Promise<PlacementFiles> {
  if (doc.status === "ready" && doc.files) {
    return { wait: false, files: doc.files, printResolution: true };
  }
  if (!doc.active) return standard;
  if (Date.now() >= doc.deadlineAt) {
    const minutes = Math.round((doc.deadlineAt - doc.startedAt) / 60_000);
    await settlePrintPrep(doc.paymentId, "fallback", `not ready within ${minutes} minutes (stopped while ${doc.status})`, {
      place: false,
    });
    return standard;
  }
  await schedulePrintPrepStep(doc.paymentId, 0);
  return { wait: true };
}

async function startPrintPrep(payment: AdminPaymentRecord, settings: PrintPrepSettings): Promise<boolean> {
  const recipe = payment.fulfillment!.printPrep!;
  const now = Date.now();
  const startedAt = Math.min(now, payment.paidAt ?? now);
  // The deadline counts from payment: a webhook that arrives late must not buy extra time.
  const deadlineAt = Math.max(now + 5 * 60_000, printPrepDeadline(startedAt, settings));
  const doc: PrintPrepDoc = {
    paymentId: payment.id,
    uid: payment.ownerUid,
    projectId: payment.fulfillment!.merchantReference ?? "",
    env: serverConfig().fulfillment.lulu.env,
    fingerprint: recipe.fingerprint,
    interiorKey: recipe.interiorKey,
    coverKey: recipe.coverKey,
    pages: recipe.pages,
    printSku: recipe.printSku,
    baseSku: recipe.baseSku,
    status: "planning",
    active: true,
    startedAt,
    deadlineAt,
    updatedAt: now,
    finishedAt: null,
    reason: null,
    documents: null,
    probeJobId: null,
    probeAttempts: 0,
    renderJobId: null,
    renderAttempts: 0,
    hiresFingerprint: null,
    images: { total: 0, done: 0, failed: 0 },
    tiers: {},
    costUsd: 0,
    files: null,
    stepErrors: 0,
    leaseUntil: 0,
    wakeAgain: false,
    timeline: [{ at: now, message: "Preparing print-resolution files" }],
  };
  if (!doc.projectId) return false;
  try {
    await prepRef(payment.id).create(clean(doc));
  } catch (err) {
    if ((err as { code?: number }).code === 6) return false; // ALREADY_EXISTS
    throw err;
  }
  await db()
    .doc(`payments/${payment.id}`)
    .set({ printPrepUntil: deadlineAt + STRANDED_GRACE_MS }, { merge: true })
    .catch(() => undefined);
  void log.info({
    source: "worker",
    domain: "print",
    event: "print.prep.started",
    message: `Preparing print-resolution files for order ${payment.id} (deadline in ${Math.round((deadlineAt - now) / 60_000)} min).`,
    uid: doc.uid,
    projectId: doc.projectId,
    paymentId: payment.id,
  });
  await syncOrder(doc, "files_preparing", "Preparing print-resolution files");
  await schedulePrintPrepStep(payment.id, 0);
  return true;
}

// ---- The step machine ---------------------------------------------------------------

/**
 * Move the run forward as far as it can go right now. Idempotent; safe to call
 * any number of times from anywhere (tasks, the sweep, the gate, admin).
 */
export async function advancePrintPrep(paymentId: string): Promise<void> {
  const doc = await claimStep(paymentId);
  if (!doc) return;
  await withLogContext({ paymentId, uid: doc.uid, projectId: doc.projectId }, async () => {
    try {
      await step(doc);
      if (doc.stepErrors > 0) await prepRef(paymentId).set({ stepErrors: 0 }, { merge: true }).catch(() => undefined);
    } catch (err) {
      if (err instanceof PrepSettled) return;
      const errors = (doc.stepErrors ?? 0) + 1;
      void log.error({
        source: "worker",
        domain: "print",
        event: "print.prep.step_failed",
        message: `Print preparation step "${doc.status}" failed (${errors}/${MAX_STEP_ERRORS}).`,
        error: err,
        context: { status: doc.status, errors },
      });
      if (errors >= MAX_STEP_ERRORS) {
        await settlePrintPrep(paymentId, "fallback", `preparation kept failing while ${doc.status}: ${errText(err)}`, {
          place: true,
        });
      } else {
        await prepRef(paymentId).set({ stepErrors: errors }, { merge: true }).catch(() => undefined);
        await schedulePrintPrepStep(paymentId, 30 * errors);
      }
    } finally {
      await releaseStep(paymentId);
    }
  });
}

async function step(doc: PrintPrepDoc): Promise<void> {
  if (Date.now() >= doc.deadlineAt) {
    const minutes = Math.round((doc.deadlineAt - doc.startedAt) / 60_000);
    await settlePrintPrep(doc.paymentId, "fallback", `not ready within ${minutes} minutes (stopped while ${doc.status})`, {
      place: true,
    });
    return;
  }
  const payment = await getAdminPayment(doc.paymentId);
  if (!payment) {
    await settlePrintPrep(doc.paymentId, "skipped", "the payment record is gone", { place: false });
    return;
  }
  if (payment.status === "refunded") {
    await settlePrintPrep(doc.paymentId, "skipped", "the order was refunded", { place: false });
    return;
  }
  if (payment.orderId) {
    await settlePrintPrep(doc.paymentId, "skipped", "the order was already placed", { place: false });
    return;
  }
  const settings = await getPrintPrepSettings();
  if (!settings.enabled) {
    await settlePrintPrep(doc.paymentId, "skipped", "print preparation was switched off", { place: true });
    return;
  }
  switch (doc.status) {
    case "planning":
      return planStep(doc, settings);
    case "upscaling":
      return upscalingStep(doc);
    case "rendering":
      return renderingStep(doc);
    case "verifying":
      return verifyingStep(doc);
    default:
      return;
  }
}

function documentsFor(doc: PrintPrepDoc, requests: Record<string, DocumentRequest>): DocumentRequest[] | null {
  const cover = requests[doc.coverKey];
  if (!cover) return null;
  const interior: DocumentRequest = requests[doc.interiorKey] ?? { kind: "interior", padToPages: doc.pages };
  return [interior, cover];
}

async function planStep(doc: PrintPrepDoc, settings: PrintPrepSettings): Promise<void> {
  const index = await readRenderIndex(doc.uid, doc.fingerprint);
  if (!index) {
    // Expected for a reorder of an old book (renders expire); nothing is wrong.
    await settlePrintPrep(doc.paymentId, "skipped", "the render this order was checked against is no longer cached", {
      place: true,
    });
    return;
  }
  const documents = documentsFor(doc, index.requests);
  if (!documents) {
    await settlePrintPrep(
      doc.paymentId,
      "skipped",
      "this book was rendered before print preparation existed, so its cover layout isn't on record",
      { place: true },
    );
    return;
  }

  if (!index.artwork) {
    if (doc.probeJobId) {
      const job = await readPrintRenderJob(doc.uid, doc.probeJobId);
      const alive = job && (job.status === "pending" || job.status === "running") && Date.now() - job.updatedAt < RENDER_STALL_MS;
      if (alive) return;
      const why = job?.error ?? (!job ? "the measuring render disappeared" : job.status === "done" ? "the measurement wasn't recorded" : "the measuring render stalled");
      if (/changed while/i.test(why)) {
        await settlePrintPrep(doc.paymentId, "fallback", "the book was edited after ordering; printing the files that were ordered", { place: true });
        return;
      }
      if (doc.probeAttempts >= MAX_PROBE_ATTEMPTS) {
        await settlePrintPrep(doc.paymentId, "fallback", `couldn't measure the pictures: ${why}`, { place: true });
        return;
      }
    }
    const jobId = await startPrintRenderJob(doc.uid, {
      projectId: doc.projectId,
      fingerprint: doc.fingerprint,
      documents,
      printPrepId: doc.paymentId,
      probeOnly: true,
    });
    await patchPrep(
      doc.paymentId,
      { probeJobId: jobId, probeAttempts: doc.probeAttempts + 1, documents },
      `Measuring how the pictures are drawn (attempt ${doc.probeAttempts + 1})`,
    );
    return;
  }

  const targets = Object.entries(index.artwork)
    .map(([blobId, demand]) => ({ blobId, demand, target: upscaleTargetFor(demand, settings) }))
    .filter((t): t is typeof t & { target: UpscaleTarget } => t.target !== null);
  if (targets.length === 0) {
    await settlePrintPrep(doc.paymentId, "skipped", "every picture is already sharp enough to print", { place: true });
    return;
  }

  const now = Date.now();
  const writes = db().batch();
  for (const t of targets) {
    const image: PrintPrepImageDoc = {
      blobId: t.blobId,
      cacheKey: crypto
        .createHash("sha256")
        .update(`${doc.uid}:${t.blobId}:${t.target.width}x${t.target.height}`)
        .digest("hex")
        .slice(0, 40),
      naturalWidth: t.demand.naturalWidth,
      naturalHeight: t.demand.naturalHeight,
      demand: Math.round(t.demand.scale * 1000) / 1000,
      target: t.target,
      status: "pending",
      attempts: 0,
      dispatches: 1,
      dispatchedAt: now,
      path: null,
      tier: null,
      cached: false,
      costUsd: 0,
      durationMs: 0,
      fallbacks: [],
      error: null,
      updatedAt: now,
    };
    writes.set(imagesRef(doc.paymentId).doc(imageDocId(t.blobId)), clean(image));
  }
  await writes.commit();
  const next = await patchPrep(
    doc.paymentId,
    { status: "upscaling", documents, images: { total: targets.length, done: 0, failed: 0 } },
    `Upscaling ${targets.length} picture(s)`,
  );
  await syncOrder(next, "files_progress", `Upscaling ${targets.length} picture(s)`, { onlyIfChanged: true });
  await Promise.all(targets.map((t) => dispatchImage(doc.paymentId, imageDocId(t.blobId))));
}

async function upscalingStep(doc: PrintPrepDoc): Promise<void> {
  let images = await loadImages(doc.paymentId);
  const now = Date.now();
  let changed = false;
  for (const img of images) {
    if (img.status !== "pending" || now - img.dispatchedAt < IMAGE_REDISPATCH_MS) continue;
    const ref = imagesRef(doc.paymentId).doc(imageDocId(img.blobId));
    if (img.dispatches > MAX_IMAGE_ATTEMPTS) {
      await ref.set({ status: "failed", error: "the upscale never finished", updatedAt: now }, { merge: true });
    } else {
      await ref.set({ dispatches: img.dispatches + 1, dispatchedAt: now }, { merge: true });
      await dispatchImage(doc.paymentId, imageDocId(img.blobId));
    }
    changed = true;
  }
  if (changed) images = await loadImages(doc.paymentId);
  if (images.some((i) => i.status === "pending")) return;

  const done = images.filter((i) => i.status === "done" && i.path);
  if (done.length === 0) {
    await settlePrintPrep(doc.paymentId, "fallback", "no picture could be upscaled", { place: true });
    return;
  }
  const failed = images.length - done.length;
  await startRender(
    doc,
    done,
    {
      images: { total: images.length, done: done.length, failed },
      tiers: countTiers(images),
      costUsd: images.reduce((s, i) => s + (i.costUsd || 0), 0),
    },
    failed > 0 ? `${failed} picture(s) keep their original resolution` : undefined,
  );
}

async function startRender(
  doc: PrintPrepDoc,
  done: PrintPrepImageDoc[],
  extra: Partial<PrintPrepDoc>,
  note?: string,
): Promise<void> {
  if (!doc.documents) throw new Error("the run has no documents to render");
  const attempt = doc.renderAttempts + 1;
  // A fresh fingerprint per attempt: a half-finished earlier attempt's pages can't mix in.
  const hiresFingerprint = crypto
    .createHash("sha256")
    .update(`${doc.paymentId}:${doc.fingerprint}:print:${attempt}`)
    .digest("hex");
  const jobId = await startPrintRenderJob(doc.uid, {
    projectId: doc.projectId,
    fingerprint: doc.fingerprint,
    documents: doc.documents,
    printPrepId: doc.paymentId,
    blobOverrides: Object.fromEntries(done.map((i) => [i.blobId, i.path!])),
    storeAs: hiresFingerprint,
  });
  const next = await patchPrep(
    doc.paymentId,
    { ...extra, status: "rendering", renderJobId: jobId, renderAttempts: attempt, hiresFingerprint },
    `${note ? `${note}. ` : ""}Rendering the book at print resolution (attempt ${attempt})`,
  );
  await syncOrder(next, "files_progress", "Rendering at print resolution", { onlyIfChanged: true });
}

async function renderingStep(doc: PrintPrepDoc): Promise<void> {
  const job = doc.renderJobId ? await readPrintRenderJob(doc.uid, doc.renderJobId) : null;
  if (job && (job.status === "pending" || job.status === "running") && Date.now() - job.updatedAt < RENDER_STALL_MS) return;
  if (job?.status === "done") {
    const next = await patchPrep(doc.paymentId, { status: "verifying" }, "Checking the print files");
    await verifyingStep(next);
    return;
  }
  const why = job?.error ?? (job ? "the render stalled" : "the render job disappeared");
  if (/changed while/i.test(why)) {
    await settlePrintPrep(doc.paymentId, "fallback", "the book was edited after ordering; printing the files that were ordered", {
      place: true,
    });
    return;
  }
  if (doc.renderAttempts >= MAX_RENDER_ATTEMPTS) {
    await settlePrintPrep(doc.paymentId, "fallback", `the print-resolution render failed: ${why}`, { place: true });
    return;
  }
  const done = (await loadImages(doc.paymentId)).filter((i) => i.status === "done" && i.path);
  await startRender(doc, done, {}, `Render failed (${why.slice(0, 120)})`);
}

async function verifyingStep(doc: PrintPrepDoc): Promise<void> {
  const fp = doc.hiresFingerprint;
  if (!fp) throw new Error("the run has no print-resolution render");
  const [interiorRaw, cover] = await Promise.all([
    cachedDocumentUrl(doc.uid, fp, doc.interiorKey),
    cachedDocumentUrl(doc.uid, fp, doc.coverKey),
  ]);
  if (!interiorRaw || !cover) {
    await settlePrintPrep(doc.paymentId, "fallback", "the print-resolution render finished without its documents", {
      place: true,
    });
    return;
  }
  // The same two calls the checkout made on the standard files.
  const interior = await padInteriorToPages(interiorRaw, doc.pages);
  const problems = await preflightPrintFiles({
    interiorUrl: interior,
    coverUrl: cover,
    printSku: doc.printSku,
    baseSku: doc.baseSku,
    pages: doc.pages,
  });
  if (problems.length > 0) {
    await settlePrintPrep(doc.paymentId, "fallback", `the print-resolution files failed the print check: ${problems.join("; ")}`, {
      place: true,
    });
    return;
  }
  await settlePrintPrep(doc.paymentId, "ready", null, { place: true, files: { interior, cover } });
}

// ---- One picture ----------------------------------------------------------------------

interface CachedUpscale {
  uid: string;
  blobId: string;
  path: string;
  tier: UpscaleTier;
  width: number;
  height: number;
  costUsd: number;
  at: number;
}

/**
 * Upscale one picture of a run. Throws only to ask the task queue for a retry;
 * the last attempt records a failure instead (the book keeps that original).
 */
async function upscaleOne(paymentId: string, imageId: string): Promise<void> {
  const ref = imagesRef(paymentId).doc(imageId);
  const [prep, img] = await Promise.all([readPrep(paymentId), ref.get().then((s) => s.data() as PrintPrepImageDoc | undefined)]);
  if (!prep || prep.status !== "upscaling" || !img || img.status !== "pending") return;

  await withLogContext({ paymentId, uid: prep.uid, projectId: prep.projectId }, async () => {
    const started = Date.now();
    try {
      const cacheRef = db().doc(`${UPSCALES}/${img.cacheKey}`);
      const cached = (await cacheRef.get()).data() as CachedUpscale | undefined;
      if (cached && cached.uid === prep.uid) {
        const [exists] = await blobBucket().file(cached.path).exists();
        if (exists) {
          await ref.set(
            clean({ status: "done", path: cached.path, tier: cached.tier, cached: true, costUsd: 0, durationMs: Date.now() - started, error: null, updatedAt: Date.now() }),
            { merge: true },
          );
          return;
        }
      }

      const settings = await getPrintPrepSettings();
      const source = await downloadBlob(prep.uid, img.blobId);
      const result = await upscaleImage(source, img.target, settings);
      const ext = result.contentType === "image/png" ? "png" : "jpg";
      const path = `users/${prep.uid}/upscaled/${img.cacheKey}.${ext}`;
      await blobBucket().file(path).save(result.bytes, { contentType: result.contentType, resumable: false });
      await cacheRef.set(
        clean<CachedUpscale>({
          uid: prep.uid,
          blobId: img.blobId,
          path,
          tier: result.tier,
          width: result.width,
          height: result.height,
          costUsd: result.costUsd,
          at: Date.now(),
        }),
      );
      await ref.set(
        clean({
          status: "done",
          path,
          tier: result.tier,
          cached: false,
          costUsd: result.costUsd,
          durationMs: Date.now() - started,
          fallbacks: result.fallbacks,
          error: null,
          updatedAt: Date.now(),
        }),
        { merge: true },
      );
      await recordPrintPrepSpend(result.costUsd, result.tier);
      await recordFinanceEvent({
        category: "books",
        kind: "printPrepCost",
        amountUsd: -result.costUsd,
        uid: prep.uid,
        projectId: prep.projectId,
        ref: img.cacheKey,
        meta: { paymentId, tier: result.tier, width: result.width, height: result.height },
      }).catch(() => undefined);
      if (result.tier === "lanczos" && settings.upscaler.url) {
        void log.info({
          source: "worker",
          domain: "print",
          event: "print.prep.tier_fallback",
          message: `Picture upscaled with Lanczos instead of the AI service: ${result.fallbacks.join("; ")}.`,
          context: { blobId: img.blobId, fallbacks: result.fallbacks },
        });
      }
    } catch (err) {
      const attempts = (img.attempts ?? 0) + 1;
      const final = attempts >= MAX_IMAGE_ATTEMPTS;
      await ref.set(
        clean({ attempts, error: errText(err).slice(0, 300), updatedAt: Date.now(), ...(final ? { status: "failed" } : {}) }),
        { merge: true },
      );
      void (final ? log.warn : log.info)({
        source: "worker",
        domain: "print",
        event: final ? "print.prep.image_failed" : "print.prep.image_retry",
        message: final
          ? `A picture couldn't be upscaled after ${attempts} attempts; it prints at its original resolution.`
          : `Upscaling a picture failed (attempt ${attempts}); retrying.`,
        error: err,
        context: { blobId: img.blobId, attempts },
      });
      if (!final) throw err;
    }
  });
  await schedulePrintPrepStep(paymentId, 0);
}

// ---- Functions -------------------------------------------------------------------------

export const runPrintPrepStep = onTaskDispatched<{ paymentId: string }>(
  {
    memory: "1GiB",
    timeoutSeconds: 300,
    secrets: ALL_SECRETS,
    retryConfig: { maxAttempts: 3, minBackoffSeconds: 20 },
    rateLimits: { maxConcurrentDispatches: 10 },
  },
  async (req) => {
    if (typeof req.data?.paymentId !== "string") return;
    await advancePrintPrep(req.data.paymentId);
  },
);

export const runUpscaleImage = onTaskDispatched<{ paymentId: string; imageId: string }>(
  {
    memory: "2GiB",
    cpu: 2,
    timeoutSeconds: 540,
    // Large pictures decode to hundreds of MB; one at a time per instance.
    concurrency: 1,
    secrets: ALL_SECRETS,
    retryConfig: { maxAttempts: MAX_IMAGE_ATTEMPTS, minBackoffSeconds: 15 },
    rateLimits: { maxConcurrentDispatches: 12 },
  },
  async (req) => {
    const { paymentId, imageId } = req.data ?? ({} as { paymentId?: string; imageId?: string });
    if (typeof paymentId !== "string" || typeof imageId !== "string") return;
    await upscaleOne(paymentId, imageId);
  },
);

/**
 * The backstop. Every five minutes: wake each active run (which enforces its
 * deadline), then look at the system as a whole for what a person must know.
 */
export const sweepPrintPrep = onSchedule(
  { schedule: "every 5 minutes", timeZone: "UTC", memory: "512MiB", timeoutSeconds: 300, secrets: ALL_SECRETS },
  async () => {
    try {
      const summary = await runPrintPrepSweep();
      await recordHeartbeat("sweepPrintPrep", true, summary);
    } catch (err) {
      await recordHeartbeat("sweepPrintPrep", false, errText(err));
      void log.error({ source: "cron", domain: "print", event: "print.prep.sweep_failed", message: "The print preparation sweep failed.", error: err });
    }
  },
);

export async function runPrintPrepSweep(): Promise<string> {
  const active = await db().collection(PREP).where("active", "==", true).limit(200).get();
  for (const snap of active.docs) {
    try {
      await advancePrintPrep(snap.id);
    } catch (err) {
      logger.warn("[printPrep] sweep couldn't advance a run", { paymentId: snap.id, err: errText(err) });
    }
  }
  const settings = await getPrintPrepSettings(true);
  const notes = [`${active.size} active`];
  notes.push(...(await checkUpscalerOutage(settings)));
  notes.push(...(await checkFallbackRate(settings)));
  notes.push(...(await checkDailyCost(settings)));
  return notes.join(" · ");
}

async function checkUpscalerOutage(settings: PrintPrepSettings): Promise<string[]> {
  if (!settings.enabled || !settings.upscaler.url) return [];
  const health = (await readUpscalerHealth()) as Record<string, unknown>;
  const first = typeof health.firstFailureAt === "number" ? health.firstFailureAt : null;
  const openRef = typeof health.outageAlertRef === "string" ? health.outageAlertRef : null;
  const kind = "print.prep.upscaler_outage";
  if (first && Date.now() - first >= settings.alerts.outageMinutes * 60_000) {
    const ref = String(first);
    if (openRef !== ref) {
      await raiseAlert({
        severity: liveEnv() ? "critical" : "warning",
        kind,
        ref,
        message:
          `The AI upscaler has failed every call for ${Math.round((Date.now() - first) / 60_000)} minutes ` +
          `(last error: ${String(health.lastError ?? "unknown")}). Orders still go out — pictures are enlarged with ` +
          "Lanczos instead, which is softer. Check the Cloud Run service's logs and that this project's service account " +
          "may invoke it; Admin → Orders → Print files has a test button.",
        meta: { firstFailureAt: first, consecutiveFailures: health.consecutiveFailures, url: settings.upscaler.url },
      }).catch(() => undefined);
      await db().doc("printPrepHealth/upscaler").set({ outageAlertRef: ref }, { merge: true });
    }
    return ["upscaler down"];
  }
  if (!first && openRef) {
    await resolveAlert(`${kind}_${openRef}`).catch(() => undefined);
    await db().doc("printPrepHealth/upscaler").set({ outageAlertRef: null }, { merge: true });
    void log.info({ source: "worker", domain: "print", event: "print.prep.upscaler_recovered", message: "The AI upscaler is answering again." });
  }
  return [];
}

async function checkFallbackRate(settings: PrintPrepSettings): Promise<string[]> {
  const since = Date.now() - 3_600_000;
  const recent = await db().collection(PREP).where("finishedAt", ">=", since).get();
  const fallbacks = recent.docs
    .map((d) => d.data() as PrintPrepDoc)
    .filter((d) => d.status === "fallback" && d.env === serverConfig().fulfillment.lulu.env);
  if (fallbacks.length >= settings.alerts.fallbacksPerHour) {
    const reasons = new Map<string, number>();
    for (const f of fallbacks) {
      const r = (f.reason ?? "unknown").replace(/\d+/g, "#").slice(0, 120);
      reasons.set(r, (reasons.get(r) ?? 0) + 1);
    }
    const lines = [...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([r, n]) => `• ${n}× ${r}`);
    await raiseAlert({
      severity: liveEnv() ? "critical" : "warning",
      kind: "print.prep.fallback_burst",
      ref: String(Math.floor(Date.now() / 3_600_000)),
      message:
        `${fallbacks.length} orders in the last hour went to print with standard (lower-resolution) files instead of ` +
        `print-resolution ones:\n${lines.join("\n")}\nThe books still print. Fix the cause, or switch print preparation ` +
        "off in Admin → Orders → Print files until it's fixed.",
      meta: { count: fallbacks.length, paymentIds: fallbacks.map((f) => f.paymentId).slice(0, 20) },
    }).catch(() => undefined);
  }
  return fallbacks.length > 0 ? [`${fallbacks.length} fallback(s)/h`] : [];
}

async function checkDailyCost(settings: PrintPrepSettings): Promise<string[]> {
  const [today] = await readPrintPrepDays(1);
  if (settings.alerts.dailyCostUsd > 0 && today.costUsd > settings.alerts.dailyCostUsd) {
    await raiseAlert({
      severity: liveEnv() ? "critical" : "warning",
      kind: "print.prep.cost",
      ref: today.day,
      message:
        `Upscaling has cost $${today.costUsd.toFixed(2)} today (${today.images} pictures), above the ` +
        `$${settings.alerts.dailyCostUsd.toFixed(2)} alert line. Check for a run that keeps re-upscaling, or raise the line ` +
        "in Admin → Orders → Print files if the volume is real.",
      meta: { day: today.day, costUsd: today.costUsd, images: today.images, tiers: today.tiers },
    }).catch(() => undefined);
  }
  return [`$${today.costUsd.toFixed(2)} today`];
}

// ---- Admin ---------------------------------------------------------------------------

/** What the order page shows about one order's print files. */
export async function readPrintPrepForAdmin(paymentId: string): Promise<{
  run: Omit<PrintPrepDoc, "leaseUntil" | "wakeAgain">;
  images: PrintPrepImageDoc[];
} | null> {
  const run = await readPrep(paymentId);
  if (!run) return null;
  const images = await loadImages(paymentId);
  images.sort((a, b) => b.demand - a.demand);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { leaseUntil, wakeAgain, ...rest } = run;
  return { run: rest, images };
}

function fail(res: Response, status: number, message: string): void {
  res.status(status).json({ error: { message } });
}

async function actorOf(req: Request): Promise<string> {
  const r = req as AuthedRequest;
  return r.authToken?.email ?? r.uid ?? "admin";
}

/**
 *   GET  /admin/orders/print-prep/status         health, active runs, spend vs collected
 *   PUT  /admin/orders/print-prep/settings       save settings
 *   POST /admin/orders/print-prep/test           run one synthetic picture through the chain
 *   POST /admin/orders/:key/rerun-print-prep     start over (order not yet placed)
 *   POST /admin/orders/:key/use-standard-files   stop waiting and place now
 */
export function registerPrintPrepAdminRoutes(app: Express): void {
  const json = express.json({ limit: "50kb" });

  app.get("/admin/orders/print-prep/status", async (_req: Request, res: Response) => {
    try {
      const [settings, health, days, activeSnap, recentSnap, beats] = await Promise.all([
        getPrintPrepSettings(true),
        readUpscalerHealth(),
        readPrintPrepDays(30),
        db().collection(PREP).where("active", "==", true).limit(100).get(),
        db().collection(PREP).where("finishedAt", ">=", Date.now() - 86_400_000).limit(1000).get(),
        readHeartbeats(),
      ]);
      const recent = recentSnap.docs.map((d) => d.data() as PrintPrepDoc);
      const count = (s: PrintPrepStatus) => recent.filter((r) => r.status === s).length;
      const sum = (pick: (d: (typeof days)[number]) => number, n: number) =>
        days.slice(-n).reduce((s, d) => s + pick(d), 0);
      const beat = beats.find((b) => b.job === "sweepPrintPrep");
      const spec = JOB_HEARTBEATS.sweepPrintPrep;
      res.json({
        settings,
        upscaler: {
          configured: Boolean(settings.upscaler.url),
          ...health,
        },
        sweep: {
          lastRunAt: beat?.at ?? null,
          ok: beat ? beat.ok : null,
          summary: beat?.summary ?? null,
          stale: beat ? Date.now() - beat.at > spec.maxSilenceMs : true,
        },
        active: activeSnap.docs.map((d) => {
          const r = d.data() as PrintPrepDoc;
          return {
            paymentId: r.paymentId,
            status: r.status,
            startedAt: r.startedAt,
            deadlineAt: r.deadlineAt,
            images: r.images,
            note: r.timeline?.[r.timeline.length - 1]?.message ?? null,
          };
        }),
        last24h: {
          finished: recent.length,
          ready: count("ready"),
          fallback: count("fallback"),
          skipped: count("skipped"),
          fallbacks: recent
            .filter((r) => r.status === "fallback")
            .slice(0, 10)
            .map((r) => ({ paymentId: r.paymentId, reason: r.reason, finishedAt: r.finishedAt })),
        },
        money: {
          days,
          spend7dUsd: sum((d) => d.costUsd, 7),
          spend30dUsd: sum((d) => d.costUsd, 30),
          collected7dUsd: sum((d) => d.collectedUsd, 7),
          collected30dUsd: sum((d) => d.collectedUsd, 30),
          images30d: sum((d) => d.images, 30),
          slots30d: sum((d) => d.slots, 30),
        },
      });
    } catch (err) {
      logger.error("[printPrep] status failed", err);
      fail(res, 500, errText(err));
    }
  });

  app.put("/admin/orders/print-prep/settings", json, async (req: Request, res: Response) => {
    try {
      const before = await getPrintPrepSettings(true);
      const saved = await savePrintPrepSettings(req.body, (req as AuthedRequest).uid);
      if (before.enabled !== saved.enabled) {
        void log.warn({
          source: "backend",
          domain: "print",
          event: saved.enabled ? "print.prep.enabled" : "print.prep.disabled",
          message: `${await actorOf(req)} switched print preparation ${saved.enabled ? "on" : "off"}.`,
        });
      }
      res.json({ settings: saved });
    } catch (err) {
      fail(res, 400, errText(err));
    }
  });

  app.post("/admin/orders/print-prep/test", json, async (_req: Request, res: Response) => {
    try {
      const settings = await getPrintPrepSettings(true);
      // A soft gradient with a few shapes: enough structure for the similarity check.
      const svg = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="192">
          <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f6c28b"/><stop offset="1" stop-color="#5b8bd9"/></linearGradient></defs>
          <rect width="256" height="192" fill="url(#g)"/><circle cx="80" cy="90" r="42" fill="#fff6"/><rect x="150" y="40" width="70" height="110" rx="12" fill="#2d3a5a"/>
        </svg>`,
      );
      const source = await sharp(svg).png().toBuffer();
      const target = upscaleTargetFor({ scale: 3, naturalWidth: 256, naturalHeight: 192 }, { ...settings, minUpscaleRatio: 1 });
      if (!target) return fail(res, 500, "Couldn't build a test target.");
      const started = Date.now();
      const result = await upscaleImage(source, target, settings);
      res.json({
        tier: result.tier,
        width: result.width,
        height: result.height,
        ms: Date.now() - started,
        aiMs: result.aiMs,
        costUsd: result.costUsd,
        fallbacks: result.fallbacks,
      });
    } catch (err) {
      fail(res, 500, errText(err));
    }
  });

  async function orderFor(req: Request, res: Response) {
    const record = await getPrintOrder(req.params.key);
    if (!record?.paymentId) {
      fail(res, 404, "That order doesn't exist.");
      return null;
    }
    const payment = await getAdminPayment(record.paymentId);
    if (!payment) {
      fail(res, 404, "That order has no payment.");
      return null;
    }
    if (payment.orderId) {
      fail(res, 409, "This order is already at the printer; its files can't change any more.");
      return null;
    }
    return { record, payment };
  }

  app.post("/admin/orders/:key/rerun-print-prep", json, async (req: Request, res: Response) => {
    try {
      const ctx = await orderFor(req, res);
      if (!ctx) return;
      const { record, payment } = ctx;
      if (!payment.fulfillment?.printPrep) return fail(res, 409, "This order's files didn't come from a server render, so they can't be prepared.");
      if (payment.status !== "paid") return fail(res, 409, "Only a paid, unrefunded order can be prepared.");
      const settings = await getPrintPrepSettings(true);
      if (!settings.enabled) return fail(res, 409, "Print preparation is switched off.");
      const by = await actorOf(req);
      const current = await readPrep(payment.id);
      if (current?.active) return fail(res, 409, "Preparation is already running for this order.");
      await prepRef(payment.id).delete();
      // Old picture docs would otherwise be read as this run's.
      const old = await imagesRef(payment.id).get();
      const batch = db().batch();
      old.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      // A fresh deadline from now, not from the original payment.
      const started = await startPrintPrep({ ...payment, paidAt: Date.now() }, settings);
      await recordOrderEvent({
        key: record.key,
        type: "admin_action",
        source: `admin:${by}`,
        message: `${by} restarted print preparation`,
        silent: true,
      });
      res.json({ ok: started, record: await getPrintOrder(record.key) });
    } catch (err) {
      logger.error("[printPrep] rerun failed", err);
      fail(res, 500, errText(err));
    }
  });

  app.post("/admin/orders/:key/use-standard-files", json, async (req: Request, res: Response) => {
    try {
      const ctx = await orderFor(req, res);
      if (!ctx) return;
      const { record, payment } = ctx;
      const by = await actorOf(req);
      const settled = await settlePrintPrep(payment.id, "fallback", `${by} chose the standard files`, { place: false, by });
      if (!settled) {
        const current = await readPrep(payment.id);
        if (current?.status === "ready") return fail(res, 409, "Print-resolution files are ready; the order is being placed with them.");
      }
      await recordOrderEvent({
        key: record.key,
        type: "admin_action",
        source: `admin:${by}`,
        message: `${by} placed the order with the standard files`,
        silent: true,
      });
      await placeNow(payment.id);
      res.json({ record: await getPrintOrder(record.key) });
    } catch (err) {
      logger.error("[printPrep] use-standard-files failed", err);
      fail(res, 500, errText(err));
    }
  });
}
