/**
 * Upscaling one picture for print — a chain of providers, each result checked.
 *
 *   1. AI super-resolution (Real-ESRGAN behind `settings.upscaler.url`): real
 *      detail, a few seconds on a GPU. Optional, and allowed to be down.
 *   2. Lanczos resampling with `sharp`: no new detail, but always available,
 *      deterministic and local. It is the floor the chain can never fall through.
 *
 * Whatever comes back is decoded and verified before anyone uses it: exact
 * size, not blank, and still recognisably the source picture. A provider that
 * returns the wrong image, a truncated file or a blank frame is treated exactly
 * like one that timed out — the next tier runs.
 *
 * Health of the AI tier is shared across instances in
 * `printPrepHealth/upscaler`, so after a run of failures every worker stops
 * waiting on it for a minute at a time (one probe per minute keeps checking),
 * and the sweep can tell an outage from a bad picture.
 */
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import sharp from "sharp";
import {
  UPSCALE_BLANK_STDEV,
  UPSCALE_MAX_MEAN_DIFF,
  type PrintPrepSettings,
  type UpscaleTarget,
} from "../../books-frontend/src/core/print/printPrep";
import { ensureAdmin } from "./storage";

export type UpscaleTier = "esrgan" | "lanczos";

export interface UpscaleResult {
  bytes: Buffer;
  contentType: "image/jpeg" | "image/png";
  width: number;
  height: number;
  tier: UpscaleTier;
  /** Time spent in the AI service (0 for Lanczos). */
  aiMs: number;
  costUsd: number;
  /** Why earlier tiers were skipped or rejected, in order. */
  fallbacks: string[];
}

/** Largest source we send to the AI tier; anything bigger already has the pixels. */
const MAX_AI_SOURCE_PIXELS = 4_000_000;
/** After this many AI failures in a row, workers skip the tier between probes. */
const BREAKER_FAILURES = 5;
const BREAKER_PROBE_MS = 60_000;

// ---- Verification -------------------------------------------------------------

async function fingerprint64(bytes: Buffer): Promise<Buffer> {
  return sharp(bytes).flatten({ background: "#ffffff" }).resize(64, 64, { fit: "fill" }).greyscale().raw().toBuffer();
}

async function isBlank(bytes: Buffer): Promise<boolean> {
  const { channels } = await sharp(bytes).flatten({ background: "#ffffff" }).resize(64, 64, { fit: "fill" }).stats();
  return channels.every((c) => c.stdev < UPSCALE_BLANK_STDEV);
}

/**
 * Throws with a plain reason when `output` can't stand in for `source` at
 * `target`. A blank source is allowed a blank result — that's faithful.
 */
export async function verifyUpscale(source: Buffer, output: Buffer, target: Pick<UpscaleTarget, "width" | "height">): Promise<void> {
  const meta = await sharp(output).metadata();
  if (meta.width !== target.width || meta.height !== target.height) {
    throw new Error(`wrong size ${meta.width ?? "?"}×${meta.height ?? "?"} (wanted ${target.width}×${target.height})`);
  }
  if ((await isBlank(output)) && !(await isBlank(source))) throw new Error("came back blank");
  const [a, b] = await Promise.all([fingerprint64(source), fingerprint64(output)]);
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  const diff = sum / a.length;
  if (diff > UPSCALE_MAX_MEAN_DIFF) throw new Error(`no longer matches its source (difference ${diff.toFixed(1)})`);
}

// ---- AI tier ------------------------------------------------------------------

let tokenCache: { audience: string; token: string; expiresAt: number } | null = null;

/** A Google identity token for this function's service account, for a Cloud Run audience. */
async function identityToken(audience: string): Promise<string> {
  if (tokenCache && tokenCache.audience === audience && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token;
  }
  const res = await fetch(
    `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(audience)}&format=full`,
    { headers: { "Metadata-Flavor": "Google" }, signal: AbortSignal.timeout(5_000) },
  );
  if (!res.ok) throw new Error(`identity token unavailable (HTTP ${res.status})`);
  const token = (await res.text()).trim();
  // Google identity tokens live an hour; refresh well before.
  tokenCache = { audience, token, expiresAt: Date.now() + 50 * 60_000 };
  return token;
}

interface HealthDoc {
  consecutiveFailures?: number;
  lastFailureAt?: number;
  lastSuccessAt?: number;
  firstFailureAt?: number | null;
  lastError?: string;
}

let healthCache: { at: number; doc: HealthDoc } | null = null;

function healthRef() {
  ensureAdmin();
  return getFirestore().doc("printPrepHealth/upscaler");
}

export async function readUpscalerHealth(): Promise<HealthDoc> {
  if (healthCache && Date.now() - healthCache.at < 15_000) return healthCache.doc;
  try {
    const doc = ((await healthRef().get()).data() ?? {}) as HealthDoc;
    healthCache = { at: Date.now(), doc };
    return doc;
  } catch {
    return healthCache?.doc ?? {};
  }
}

async function recordAiOutcome(ok: boolean, error?: string): Promise<void> {
  try {
    const now = Date.now();
    if (ok) {
      await healthRef().set(
        { consecutiveFailures: 0, lastSuccessAt: now, firstFailureAt: null, successes: FieldValue.increment(1) },
        { merge: true },
      );
      healthCache = null;
      return;
    }
    await getFirestore().runTransaction(async (tx) => {
      const ref = healthRef();
      const cur = ((await tx.get(ref)).data() ?? {}) as HealthDoc;
      tx.set(
        ref,
        {
          consecutiveFailures: (cur.consecutiveFailures ?? 0) + 1,
          lastFailureAt: now,
          firstFailureAt: cur.firstFailureAt ?? now,
          lastError: (error ?? "unknown").slice(0, 300),
          failures: FieldValue.increment(1),
        },
        { merge: true },
      );
    });
    healthCache = null;
  } catch (err) {
    logger.warn("[upscaler] couldn't record health", { err: String(err) });
  }
}

/** Whether to skip the AI tier right now (open breaker, and not this minute's probe). */
async function breakerOpen(): Promise<boolean> {
  const h = await readUpscalerHealth();
  if ((h.consecutiveFailures ?? 0) < BREAKER_FAILURES) return false;
  return Date.now() - (h.lastFailureAt ?? 0) < BREAKER_PROBE_MS;
}

async function aiUpscale(
  source: Buffer,
  scale: 2 | 4,
  settings: PrintPrepSettings["upscaler"],
): Promise<{ bytes: Buffer; ms: number }> {
  const started = Date.now();
  const png = await sharp(source).png().toBuffer();
  const headers: Record<string, string> = { "Content-Type": "image/png", Accept: "image/png, image/jpeg" };
  if (settings.auth === "iam") headers.Authorization = `Bearer ${await identityToken(settings.url)}`;
  const res = await fetch(`${settings.url}/upscale?scale=${scale}`, {
    method: "POST",
    headers,
    body: new Uint8Array(png),
    signal: AbortSignal.timeout(settings.timeoutSeconds * 1000),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.byteLength === 0) throw new Error("empty response");
  return { bytes, ms: Date.now() - started };
}

// ---- The chain ----------------------------------------------------------------

async function encode(image: ReturnType<typeof sharp>, alpha: boolean): Promise<{ bytes: Buffer; contentType: "image/jpeg" | "image/png" }> {
  if (alpha) return { bytes: await image.png({ compressionLevel: 6 }).toBuffer(), contentType: "image/png" };
  return {
    bytes: await image.flatten({ background: "#ffffff" }).jpeg({ quality: 95, chromaSubsampling: "4:4:4", mozjpeg: true }).toBuffer(),
    contentType: "image/jpeg",
  };
}

/**
 * Upscale one picture to exactly `target`. Never returns an unverified image;
 * throws only if even Lanczos can't produce one (a source that won't decode).
 */
export async function upscaleImage(
  source: Buffer,
  target: UpscaleTarget,
  settings: PrintPrepSettings,
): Promise<UpscaleResult> {
  const meta = await sharp(source).metadata();
  if (!meta.width || !meta.height) throw new Error("the source picture can't be decoded");
  const alpha = Boolean(meta.hasAlpha);
  const fallbacks: string[] = [];

  if (!settings.upscaler.url) {
    fallbacks.push("esrgan: not configured");
  } else if (meta.width * meta.height > MAX_AI_SOURCE_PIXELS) {
    fallbacks.push("esrgan: source already large");
  } else if (await breakerOpen()) {
    fallbacks.push("esrgan: skipped (service failing, probing once a minute)");
  } else {
    let aiMs = 0;
    const aiStarted = Date.now();
    try {
      const ai = await aiUpscale(source, target.modelScale, settings.upscaler);
      aiMs = ai.ms;
      const aiMeta = await sharp(ai.bytes).metadata();
      const wantW = meta.width * target.modelScale;
      const wantH = meta.height * target.modelScale;
      if (!aiMeta.width || !aiMeta.height || Math.abs(aiMeta.width - wantW) > 2 || Math.abs(aiMeta.height - wantH) > 2) {
        throw new Error(`returned ${aiMeta.width ?? "?"}×${aiMeta.height ?? "?"} for a ${target.modelScale}× pass (wanted ${wantW}×${wantH})`);
      }
      const { bytes, contentType } = await encode(
        sharp(ai.bytes).resize(target.width, target.height, { kernel: "lanczos3", fit: "fill" }),
        alpha,
      );
      await verifyUpscale(source, bytes, target);
      await recordAiOutcome(true);
      return {
        bytes,
        contentType,
        width: target.width,
        height: target.height,
        tier: "esrgan",
        aiMs,
        costUsd: (aiMs / 1000) * settings.upscaler.costPerSecondUsd + settings.baseCostPerImageUsd,
        fallbacks,
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      fallbacks.push(`esrgan: ${reason}`);
      await recordAiOutcome(false, reason);
      // The seconds a failed call spent are still billed by the service.
      const spent = aiMs || Date.now() - aiStarted;
      settings = {
        ...settings,
        baseCostPerImageUsd: settings.baseCostPerImageUsd + (spent / 1000) * settings.upscaler.costPerSecondUsd,
      };
    }
  }

  let pipeline = sharp(source).resize(target.width, target.height, { kernel: "lanczos3", fit: "fill" });
  // Resampling softens; a light unsharp mask restores edge contrast without halos.
  if (target.ratio >= 1.5) pipeline = pipeline.sharpen({ sigma: 0.6 });
  const { bytes, contentType } = await encode(pipeline, alpha);
  await verifyUpscale(source, bytes, target);
  return {
    bytes,
    contentType,
    width: target.width,
    height: target.height,
    tier: "lanczos",
    aiMs: 0,
    costUsd: settings.baseCostPerImageUsd,
    fallbacks,
  };
}
