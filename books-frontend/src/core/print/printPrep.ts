/**
 * Print-resolution preparation — the pure half.
 *
 * Books are drawn at screen resolution (about 1–2 megapixels a picture), which
 * lands at 120–220 DPI on a printed page. Drawing every picture at 300 DPI up
 * front would cost several times as much for the many books that are never
 * printed, so the pictures of an ORDERED book are upscaled after payment and the
 * book is re-rendered with them before it goes to the printer.
 *
 * This module owns the decisions that must agree between the backend (which
 * does the work) and the admin dashboard (which shows and edits it): the
 * settings, how much a picture has to grow, and when a result is trusted.
 * The customer never waits for any of it and never sees it fail — the worst
 * outcome is the book printing with the files it would have printed with anyway.
 */
import { z } from "zod";

// ---- Settings (`adminSettings/printPrep`, private) --------------------------------

export interface PrintPrepUpscalerSettings {
  /**
   * Base URL of the AI upscaler service (`POST {url}/upscale?scale=2|4`). Empty
   * means no AI tier: pictures are enlarged with Lanczos resampling only.
   */
  url: string;
  /**
   * `iam`: the call carries a Google identity token for the function's own
   * service account (a Cloud Run service with IAM auth). `none`: no credentials.
   */
  auth: "iam" | "none";
  /** One call's ceiling. A 4× pass on a GPU takes seconds; this is for cold starts. */
  timeoutSeconds: number;
  /** What one second of the service costs, for cost tracking (GPU price ÷ 3600). */
  costPerSecondUsd: number;
}

export interface PrintPrepAlertSettings {
  /** Every AI upscale failing for this long is an outage (critical). */
  outageMinutes: number;
  /** This many orders falling back to standard files within an hour (critical). */
  fallbacksPerHour: number;
  /** Upscale spend in one UTC day above this (critical). 0 disables. */
  dailyCostUsd: number;
}

export interface PrintPrepSettings {
  version: 1;
  /** Master switch. Off means every order is placed with the standard files, as before. */
  enabled: boolean;
  /**
   * How long after payment the order may wait for print-resolution files. Past
   * it the order is placed with the standard files — the book is printable
   * either way, and the customer never waits on an upscaler.
   */
  deadlineMinutes: number;
  /** A picture that needs less enlargement than this is left alone. */
  minUpscaleRatio: number;
  /** Never enlarge a picture by more than this (past it, upscaling invents detail). */
  maxUpscaleRatio: number;
  /** Ceiling on one upscaled picture, so a full-bleed spread can't exhaust memory. */
  maxOutputMegapixels: number;
  upscaler: PrintPrepUpscalerSettings;
  /** Compute cost per picture outside the AI call (resampling, storage, re-render share). */
  baseCostPerImageUsd: number;
  alerts: PrintPrepAlertSettings;
  updatedAt: number;
  updatedBy: string;
}

export function createDefaultPrintPrepSettings(): PrintPrepSettings {
  return {
    version: 1,
    // Ships dormant: turning it on is a deliberate step after the upscaler is
    // deployed and one sandbox order has gone through.
    enabled: false,
    deadlineMinutes: 45,
    minUpscaleRatio: 1.15,
    maxUpscaleRatio: 6,
    // A full-bleed 17×11" spread at 300 DPI is ~17.5 MP.
    maxOutputMegapixels: 24,
    upscaler: { url: "", auth: "iam", timeoutSeconds: 120, costPerSecondUsd: 0.0002 },
    baseCostPerImageUsd: 0.0005,
    alerts: { outageMinutes: 30, fallbacksPerHour: 3, dailyCostUsd: 25 },
    updatedAt: 0,
    updatedBy: "",
  };
}

const clamp = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

/** Merge a stored (possibly partial or older) document onto the defaults. */
export function normalizePrintPrepSettings(input: unknown): PrintPrepSettings {
  const def = createDefaultPrintPrepSettings();
  const p = (input ?? {}) as Partial<PrintPrepSettings>;
  const u = (p.upscaler ?? {}) as Partial<PrintPrepUpscalerSettings>;
  const a = (p.alerts ?? {}) as Partial<PrintPrepAlertSettings>;
  const minRatio = clamp(p.minUpscaleRatio, 1, 3, def.minUpscaleRatio);
  return {
    version: 1,
    enabled: p.enabled === true,
    deadlineMinutes: clamp(p.deadlineMinutes, 5, 24 * 60, def.deadlineMinutes),
    minUpscaleRatio: minRatio,
    maxUpscaleRatio: Math.max(minRatio, clamp(p.maxUpscaleRatio, 1, 8, def.maxUpscaleRatio)),
    maxOutputMegapixels: clamp(p.maxOutputMegapixels, 4, 48, def.maxOutputMegapixels),
    upscaler: {
      url: typeof u.url === "string" ? u.url.trim().replace(/\/+$/, "") : def.upscaler.url,
      auth: u.auth === "none" ? "none" : "iam",
      timeoutSeconds: clamp(u.timeoutSeconds, 10, 540, def.upscaler.timeoutSeconds),
      costPerSecondUsd: clamp(u.costPerSecondUsd, 0, 1, def.upscaler.costPerSecondUsd),
    },
    baseCostPerImageUsd: clamp(p.baseCostPerImageUsd, 0, 1, def.baseCostPerImageUsd),
    alerts: {
      outageMinutes: clamp(a.outageMinutes, 5, 24 * 60, def.alerts.outageMinutes),
      fallbacksPerHour: clamp(a.fallbacksPerHour, 1, 1000, def.alerts.fallbacksPerHour),
      dailyCostUsd: clamp(a.dailyCostUsd, 0, 100_000, def.alerts.dailyCostUsd),
    },
    updatedAt: typeof p.updatedAt === "number" ? p.updatedAt : 0,
    updatedBy: typeof p.updatedBy === "string" ? p.updatedBy : "",
  };
}

export const printPrepSettingsSchema = z.object({
  enabled: z.boolean(),
  deadlineMinutes: z.number().min(5).max(24 * 60),
  minUpscaleRatio: z.number().min(1).max(3),
  maxUpscaleRatio: z.number().min(1).max(8),
  maxOutputMegapixels: z.number().min(4).max(48),
  upscaler: z.object({
    url: z
      .string()
      .max(500)
      .refine((v) => v === "" || /^https:\/\/[^\s]+$/.test(v) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(v), {
        message: "The upscaler URL must be https:// (or http://localhost for local testing).",
      }),
    auth: z.enum(["iam", "none"]),
    timeoutSeconds: z.number().min(10).max(540),
    costPerSecondUsd: z.number().min(0).max(1),
  }),
  baseCostPerImageUsd: z.number().min(0).max(1),
  alerts: z.object({
    outageMinutes: z.number().min(5).max(24 * 60),
    fallbacksPerHour: z.number().min(1).max(1000),
    dailyCostUsd: z.number().min(0).max(100_000),
  }),
});

// ---- How much a picture has to grow ------------------------------------------------

/**
 * How a picture is used in the book, measured on the render page: the largest
 * factor it is drawn at relative to its own pixels. The page is laid out at the
 * print DPI, so a factor of 2 means "half the pixels print needs".
 */
export interface ArtworkDemand {
  blobId: string;
  scale: number;
  naturalWidth: number;
  naturalHeight: number;
}

/** Keep the most demanding use of each picture (it may appear on several pages). */
export function mergeArtworkDemand(
  existing: Record<string, Omit<ArtworkDemand, "blobId">> | undefined,
  incoming: readonly ArtworkDemand[],
): Record<string, Omit<ArtworkDemand, "blobId">> {
  const out: Record<string, Omit<ArtworkDemand, "blobId">> = { ...(existing ?? {}) };
  for (const d of incoming) {
    if (!d.blobId || !(d.scale > 0) || !(d.naturalWidth > 0) || !(d.naturalHeight > 0)) continue;
    const prev = out[d.blobId];
    if (!prev || d.scale > prev.scale) {
      out[d.blobId] = { scale: d.scale, naturalWidth: d.naturalWidth, naturalHeight: d.naturalHeight };
    }
  }
  return out;
}

export interface UpscaleTarget {
  /** Enlargement actually applied (≤ the demand, within the settings' bounds). */
  ratio: number;
  width: number;
  height: number;
  /** The AI model pass that covers the ratio; the rest is exact resampling. */
  modelScale: 2 | 4;
}

/**
 * The size one picture should be upscaled to, or null when it is already sharp
 * enough to print (or so small a growth isn't worth a re-render).
 */
export function upscaleTargetFor(
  demand: Omit<ArtworkDemand, "blobId">,
  settings: Pick<PrintPrepSettings, "minUpscaleRatio" | "maxUpscaleRatio" | "maxOutputMegapixels">,
): UpscaleTarget | null {
  if (!(demand.scale > 0) || !(demand.naturalWidth > 0) || !(demand.naturalHeight > 0)) return null;
  if (demand.scale < settings.minUpscaleRatio) return null;
  let ratio = Math.min(demand.scale, settings.maxUpscaleRatio);
  const pixels = demand.naturalWidth * demand.naturalHeight;
  const budget = settings.maxOutputMegapixels * 1_000_000;
  if (pixels * ratio * ratio > budget) ratio = Math.sqrt(budget / pixels);
  if (ratio < settings.minUpscaleRatio) return null;
  return {
    ratio,
    width: Math.max(1, Math.round(demand.naturalWidth * ratio)),
    height: Math.max(1, Math.round(demand.naturalHeight * ratio)),
    modelScale: ratio <= 2 ? 2 : 4,
  };
}

// ---- Trusting a result ------------------------------------------------------------

/**
 * Mean absolute difference (0–255, 64×64 greyscale) above which an upscaled
 * picture no longer looks like its source. Real super-resolution moves this by a
 * few levels; a wrong image, a colour-channel swap or a corrupted decode moves it
 * by tens.
 */
export const UPSCALE_MAX_MEAN_DIFF = 14;

/** Mean and spread under which a picture counts as blank (all one colour). */
export const UPSCALE_BLANK_STDEV = 2;

// ---- Deadline ---------------------------------------------------------------------

export function printPrepDeadline(paidAt: number, settings: Pick<PrintPrepSettings, "deadlineMinutes">): number {
  return paidAt + settings.deadlineMinutes * 60_000;
}
